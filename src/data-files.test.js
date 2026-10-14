import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import {createDataFiles,managedExports,trackedUploads} from './data-files.js';

const binary=req=>req.buffer(true).parse((res,done)=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>done(null,Buffer.concat(chunks)));});

test('permanent cleanup removes stored files and download grants, protects active files and other accounts',async()=>{
  const f=await fixture();try{
    const active=await f.files.add('a',Buffer.from('keep'),{name:'保留.txt'}),trash=await f.files.add('a',Buffer.from('purge'),{name:'清理.txt'}),foreign=await f.files.add('b',Buffer.from('foreign'),{name:'他人.txt'});
    const grant=await f.files.ticket('a',trash.id);await f.files.update('a',trash.id,{deletedAt:new Date().toISOString()});await f.files.update('b',foreign.id,{deletedAt:new Date().toISOString()});
    assert.equal((await request(f.app).delete('/api/data/'+trash.id+'/permanent')).status,401);
    assert.equal((await request(f.app).delete('/api/data/'+trash.id+'/permanent').set('x-owner','b')).status,404);
    assert.equal((await request(f.app).delete('/api/data/trash').set('x-owner','a').send({ids:[trash.id,active.id]})).status,409);
    assert.equal((await f.files.list('a')).length,2);
    assert.equal((await request(f.app).delete('/api/data/trash').set('x-owner','a').send({ids:[trash.id,foreign.id]})).status,404);
    const result=await request(f.app).delete('/api/data/'+trash.id+'/permanent').set('x-owner','a');assert.equal(result.status,200);assert.equal(result.body.deleted,1);
    assert.deepEqual((await f.files.list('a')).map(x=>x.id),[active.id]);assert.equal((await f.files.list('b')).length,1);
    assert.equal((await request(f.app).post('/api/data/'+trash.id+'/restore').set('x-owner','a')).status,404);assert.equal((await request(f.app).get(grant.url)).status,404);
    const stored=(await fs.readdir(path.join(f.root,'managed'),{recursive:true})).filter(name=>String(name).includes(trash.id));assert.deepEqual(stored,[]);assert.deepEqual(await fs.readdir(path.join(f.root,'managed','tickets')),[]);
    const later=await f.files.add('a',Buffer.from('later'),{name:'稍后回收.txt'});await f.files.update('a',later.id,{deletedAt:new Date().toISOString()});
    const another=await f.files.add('a',Buffer.from('another'),{name:'同批回收.txt'});await f.files.update('a',another.id,{deletedAt:new Date().toISOString()});
    assert.equal((await request(f.app).delete('/api/data/trash').set('x-owner','a').send({ids:[later.id,another.id]})).body.deleted,2);assert.deepEqual((await f.files.list('a')).map(x=>x.id),[active.id]);
  }finally{await f.close();}
});
async function fixture(){const root=await fs.mkdtemp(path.join(os.tmpdir(),'quizforge-files-'));const files=createDataFiles(path.join(root,'managed'));const app=express();app.use(express.json());app.get('/downloads/:ticket',files.serve);app.use('/api',(req,res,next)=>{if(!req.get('x-owner'))return res.status(401).json({error:'请先登录'});req.account={id:req.get('x-owner')};next();});app.use('/api/data',files.router);app.use('/api',managedExports(files));const upload=trackedUploads(multer({dest:path.join(root,'uploads')}),files);app.post('/api/import/preview',upload.single('file'),async(req,res)=>{try{res.json({questions:[]});}finally{await fs.unlink(req.file.path);}});app.get('/api/export',(req,res)=>res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').attachment('test.docx').send(Buffer.from('PK-test-file')));app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));return {root,files,app,close:async()=>{await files.flush();await fs.rm(root,{recursive:true,force:true});}};}

test('managed export preserves binary legacy endpoints and issues durable Unicode HTTP downloads',async()=>{
  const f=await fixture();try{
    assert.equal((await request(f.app).get('/api/export')).status,401);
    const legacy=await binary(request(f.app).get('/api/export').set('x-owner','a'));assert.equal(legacy.body.toString(),'PK-test-file');
    const result=await request(f.app).get('/api/export').set('x-owner','a').set('x-download-mode','managed').set('x-download-name',encodeURIComponent('备份 当前方案.docx')).set('x-data-category','flights');
    assert.equal(result.status,200);assert.match(result.body.url,/^\/downloads\/[a-f0-9]{64}$/);assert.equal(result.body.name,'备份 当前方案.docx');
    const download=await binary(request(f.app).get(result.body.url));assert.equal(download.status,200);assert.equal(download.body.toString(),'PK-test-file');assert.match(download.headers['content-disposition'],/filename\*=UTF-8/);assert.match(download.headers['cache-control'],/no-store/);
    const head=await request(f.app).head(result.body.url);assert.equal(head.status,200);assert.equal(Number(head.headers['content-length']),12);
    const range=await binary(request(f.app).get(result.body.url).set('Range','bytes=0-1'));assert.equal(range.status,206);assert.equal(range.body.toString(),'PK');assert.equal(range.headers['content-range'],'bytes 0-1/12');
    const reopened=createDataFiles(path.join(f.root,'managed'));const afterRestart=express();afterRestart.get('/downloads/:ticket',reopened.serve);assert.equal((await binary(request(afterRestart).get(result.body.url))).body.toString(),'PK-test-file');
    assert.equal((await request(f.app).get('/api/data').set('x-owner','b')).body.length,0);
    assert.equal((await request(f.app).post('/api/data/'+result.body.id+'/download').set('x-owner','b')).status,404);
    const row=(await f.files.list('a'))[0];assert.equal(row.category,'flights');assert.equal(row.kind,'export');
  }finally{await f.close();}
});

test('import originals survive temporary upload cleanup, retain duplicates and stay owner isolated',async()=>{
  const f=await fixture();try{
    const first=await request(f.app).post('/api/import/preview').set('x-owner','a').field('track','ielts').attach('file',Buffer.from('My original notes'),'复习资料.md');assert.equal(first.status,200);assert.ok(first.body.dataFileId);
    const second=await request(f.app).post('/api/import/preview').set('x-owner','a').field('track','ielts').attach('file',Buffer.from('My original notes'),'复习资料.md');assert.equal(second.body.duplicateOf,first.body.dataFileId);
    const files=await f.files.list('a');assert.equal(files.length,2);assert.equal(files[0].category,'ielts');assert.equal(files[0].name,'复习资料.md');
    const grant=await request(f.app).post('/api/data/'+first.body.dataFileId+'/download').set('x-owner','a');assert.equal((await request(f.app).get(grant.body.url)).text,'My original notes');
    assert.equal((await request(f.app).get('/api/data/'+first.body.dataFileId+'/preview').set('x-owner','b')).status,404);
    const preview=await request(f.app).get('/api/data/'+first.body.dataFileId+'/preview').set('x-owner','a');assert.equal(preview.body.text,'My original notes');
  }finally{await f.close();}
});

test('renaming retains format, trash revokes issued downloads, restoring re-enables them, links survive',async()=>{
  const f=await fixture();try{
    const row=await f.files.add('a',Buffer.from('notes'),{name:'原件.txt'});await f.files.link('a',row.id,{label:'题库',url:'/bank/test'});const grant=await f.files.ticket('a',row.id);
    const renamed=await request(f.app).patch('/api/data/'+row.id).set('x-owner','a').send({name:'新名称'});assert.equal(renamed.body.name,'新名称.txt');
    assert.equal((await request(f.app).delete('/api/data/'+row.id).set('x-owner','b')).status,404);
    assert.equal((await request(f.app).delete('/api/data/'+row.id).set('x-owner','a')).status,200);assert.equal((await request(f.app).get(grant.url)).status,404);
    await assert.rejects(f.files.link('a',row.id,{label:'新关联',url:'/bank/new'}),/请恢复/);
    await f.files.link('a',row.id,{label:'已验证来源',url:'/bank/validated'},{includeDeleted:true});assert.equal((await request(f.app).get(grant.url)).status,404);await assert.rejects(f.files.link('b',row.id,{label:'越权关联',url:'/bank/foreign'},{includeDeleted:true}),/不存在/);
    assert.equal((await request(f.app).post('/api/data/'+row.id+'/restore').set('x-owner','a')).status,200);assert.equal((await request(f.app).get(grant.url)).text,'notes');assert.equal((await f.files.list('a'))[0].links.length,2);
    assert.equal((await request(f.app).post('/api/data/not-a-uuid/download').set('x-owner','a')).status,404);
    const secret=grant.url.split('/').at(-1),crypto=await import('node:crypto');const filename=path.join(f.root,'managed','tickets',crypto.createHash('sha256').update(secret).digest('hex')+'.json');const data=JSON.parse(await fs.readFile(filename,'utf8'));data.expiresAt='2000-01-01T00:00:00Z';await fs.writeFile(filename,JSON.stringify(data));assert.equal((await request(f.app).get(grant.url)).status,410);
  }finally{await f.close();}
});

test('managed names reject invalid encoding and retain the actual Word format',async()=>{
  const f=await fixture();try{
    const invalid=await request(f.app).get('/api/export').set('x-owner','a').set('x-download-mode','managed').set('x-download-name','%E0%A4');assert.equal(invalid.status,400);assert.match(invalid.body.error,/文件名/);
    const safe=await request(f.app).get('/api/export').set('x-owner','a').set('x-download-mode','managed').set('x-download-name',encodeURIComponent('../误命名.exe'));assert.equal(safe.status,200);assert.equal(safe.body.name,'误命名.docx');
    const row=await f.files.add('a',Buffer.from('notes'),{name:'éclair-'+ '字'.repeat(200)+'.md'});assert.ok(row.name.length<=180);assert.match(row.name,/\.md$/);
  }finally{await f.close();}
});

test('file listings derive legacy multi-track categories from dictionary links without duplicating originals',async()=>{
  const f=await fixture();try{
    const row=await f.files.add('a',Buffer.from('词汇'),{name:'混合方向.csv',category:'postgraduate'});
    await f.files.link('a',row.id,{label:'考研英语词汇',url:'/english/dictionary?track=postgraduate'});await f.files.link('a',row.id,{label:'雅思词汇',url:'/english/dictionary?track=ielts'});
    let rows=(await request(f.app).get('/api/data').set('x-owner','a')).body;assert.equal(rows.length,1);assert.deepEqual(rows[0].categories,['postgraduate','ielts']);
    await f.files.update('a',row.id,{categories:['postgraduate','ielts','ielts','unknown']});rows=await f.files.list('a');assert.deepEqual(rows[0].categories,['postgraduate','ielts']);assert.equal(rows[0].id,row.id);
  }finally{await f.close();}
});
