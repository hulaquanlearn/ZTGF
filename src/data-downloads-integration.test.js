import test, {after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import request from 'supertest';
import ExcelJS from 'exceljs';
import mammoth from 'mammoth';

const temporary=await fs.mkdtemp(path.join(os.tmpdir(),'quizforge-managed-integration-'));
Object.assign(process.env,{DATA_DIR:path.join(temporary,'data'),UPLOAD_DIR:path.join(temporary,'uploads'),APP_USERNAME:'managed-review',APP_PASSWORD:'managed-test-password',ADMIN_USERNAME:'',ADMIN_PASSWORD:'',AUTO_SEED_VOCABULARY:'0',DB_HOST:'',DB_NAME:'',DB_USER:'',TRANSLATION_PROVIDER:''});
const {app,dataFiles}=await import('./server.js');
const {store}=await import('./db.js');
const token=(req,owner)=>req.set('x-session-token',owner.token);
const binary=req=>req.buffer(true).parse((res,done)=>{const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>done(null,Buffer.concat(chunks)));});
const managed=(req,owner,name)=>token(req,owner).set('x-download-mode','managed').set('x-download-name',encodeURIComponent(name));
function flightPdf(lines){
  const escape=line=>line.replace(/[\\()]/g,'\\$&');
  const content='BT\n/F1 10 Tf\n20 760 Td\n14 TL\n'+lines.map((line,i)=>(i?'T* ':'')+'('+escape(line)+') Tj').join('\n')+'\nET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>','<< /Length '+Buffer.byteLength(content,'latin1')+' >>\nstream\n'+content+'\nendstream'];
  let pdf='%PDF-1.4\n',offsets=[0];objects.forEach((object,i)=>{offsets.push(Buffer.byteLength(pdf,'latin1'));pdf+=(i+1)+' 0 obj\n'+object+'\nendobj\n';});
  const start=Buffer.byteLength(pdf,'latin1');pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(offset=>String(offset).padStart(10,'0')+' 00000 n \n').join('')+'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n'+start+'\n%%EOF';return Buffer.from(pdf,'latin1');
}
async function account(){const name='managed-'+crypto.randomUUID().slice(0,8),password='isolated-test-password';const row=store.createCandidate(name,password);assert.equal(row.ok,true);const session=await request(app).post('/api/account/login').send({username:name,password});assert.equal(session.status,200);return {id:row.candidate.id,token:session.body.token};}
after(async()=>{await store.flush();await dataFiles.flush();await fs.rm(temporary,{recursive:true,force:true});});

test('actual bank import keeps originals and settings, relates saved bank, and rejects another owner at every file action',async()=>{
  const owner=await account(),other=await account(),bytes=await fs.readFile(path.resolve('test-fixture.md'));
  const preview=await token(request(app).post('/api/import/preview'),owner).field('track','ielts').field('module','reading').field('category','复习').field('title','读题练习').attach('file',bytes,'原始题目.md');
  assert.equal(preview.status,200,JSON.stringify(preview.body));assert.equal(preview.body.questions.length,3);
  const id=preview.body.dataFileId;
  for(const [method,suffix] of [['get','/preview'],['post','/download'],['post','/reimport'],['post','/restore'],['patch',''],['delete',''],['delete','/permanent']])assert.equal((await token(request(app)[method]('/api/data/'+id+suffix),other).send({name:'越权'})).status,404);
  const before=(await token(request(app).get('/api/banks'),other)).body.map(x=>x.id);
  const foreign=await token(request(app).post('/api/import/confirm'),other).send({...preview.body,title:'非法引用',questions:preview.body.questions});assert.equal(foreign.status,404);assert.deepEqual((await token(request(app).get('/api/banks'),other)).body.map(x=>x.id),before);
  const saved=await token(request(app).post('/api/import/confirm'),owner).send({...preview.body,title:'读题练习',track:'ielts',module:'reading'});assert.equal(saved.status,201,JSON.stringify(saved.body));
  await dataFiles.flush();let row=(await token(request(app).get('/api/data'),owner)).body.find(x=>x.id===id);assert.equal(row.category,'ielts');assert.equal(row.status,'已关联');assert.ok(row.links.some(x=>x.url==='/bank/'+saved.body.id));
  const renamed=await token(request(app).patch('/api/data/'+id),owner).send({name:'重新命名的原件'});assert.equal(renamed.body.name,'重新命名的原件.md');
  const reparsed=await token(request(app).post('/api/data/'+id+'/reimport'),owner);assert.equal(reparsed.status,200);assert.deepEqual(reparsed.body.questions,preview.body.questions);for(const [key,value] of Object.entries({title:'读题练习',track:'ielts',module:'reading',category:'复习'}))assert.equal(reparsed.body.sourceOptions[key],value);assert.equal(reparsed.body.sourceName,'重新命名的原件.md');
  const grant=await token(request(app).post('/api/data/'+id+'/download'),owner);const downloaded=await binary(request(app).get(grant.body.url));assert.deepEqual(downloaded.body,bytes);assert.ok(!grant.body.url.includes(owner.token));assert.equal(downloaded.status,200);
  await token(request(app).delete('/api/data/'+id),owner);assert.equal((await request(app).get(grant.body.url)).status,404);assert.equal((await token(request(app).get('/api/banks/'+saved.body.id),owner)).status,200);
  await token(request(app).post('/api/data/'+id+'/restore'),owner);assert.deepEqual((await binary(request(app).get(grant.body.url))).body,bytes);
  await token(request(app).delete('/api/data/'+id),owner);assert.equal((await token(request(app).delete('/api/data/'+id+'/permanent'),owner)).status,200);assert.equal((await token(request(app).get('/api/banks/'+saved.body.id),owner)).status,200);assert.equal((await token(request(app).post('/api/data/'+id+'/restore'),owner)).status,404);
  assert.equal((await request(app).get('/data')).status,200);assert.equal((await request(app).get('/api/data')).status,401);
});

test('vocabulary XLSX upload and a failed flight PDF both remain manageable after temporary files are removed',async()=>{
  const owner=await account(),book=new ExcelJS.Workbook();const sheet=book.addWorksheet('词汇');sheet.addRow(['中文','英文','学习方向']);sheet.addRow(['测试原件','review','ielts']);const bytes=Buffer.from(await book.xlsx.writeBuffer());
  const preview=await token(request(app).post('/api/vocabulary/preview'),owner).attach('file',bytes,'复习词汇.xlsx');assert.equal(preview.status,200,JSON.stringify(preview.body));
  const imported=await token(request(app).post('/api/vocabulary/import'),owner).send({entries:preview.body.entries,dataFileId:preview.body.dataFileId});assert.equal(imported.status,201);
  const reimported=await token(request(app).post('/api/data/'+preview.body.dataFileId+'/reimport'),owner);assert.equal(reimported.status,200);assert.deepEqual(reimported.body.entries,preview.body.entries);
  let rows=(await token(request(app).get('/api/data'),owner)).body,row=rows.find(x=>x.id===preview.body.dataFileId);assert.equal(row.category,'ielts');assert.ok(row.links.some(x=>x.url.startsWith('/english/dictionary')));
  const broken=Buffer.from('%PDF-1.7\nnot a valid flight PDF');const failed=await token(request(app).post('/api/flights/extract'),owner).attach('file',broken,'待检查航班.pdf');assert.equal(failed.status,400);
  await dataFiles.flush();rows=(await token(request(app).get('/api/data'),owner)).body;row=rows.find(x=>x.name==='待检查航班.pdf');assert.equal(row.category,'flights');assert.equal(row.status,'解析失败');
  const grant=await token(request(app).post('/api/data/'+row.id+'/download'),owner);assert.deepEqual((await binary(request(app).get(grant.body.url))).body,broken);
  const retried=await token(request(app).post('/api/data/'+row.id+'/reimport'),owner);assert.equal(retried.status,400);assert.equal((await dataFiles.get(owner.id,row.id)).status,'解析失败');
  assert.deepEqual(await fs.readdir(path.join(temporary,'uploads')),[]);
});

test('real flight XLSX, standby XLSX/Word and bank Word exports are downloadable without session headers and reopen with matching content',async()=>{
  const owner=await account(),{parseFlightText}=await import('./flights.js');
  const parsed=parseFlightText('WITH EFFECT FROM 25Oct2026 to 27Mar2027\nNX6321234567MFM0800TPE0935A321\nNX6311234567TPE1035MFM1235A321');
  const payload={flights:parsed.flights,date:'2026-10-25',pairs:[{outId:'0',backId:'1',returnDays:0,outOpening:'0650'}]};
  const flight=await managed(request(app).post('/api/flights/export'),owner,'已确认航班.xlsx').send(payload);assert.equal(flight.status,200);assert.equal(flight.body.name,'已确认航班.xlsx');
  const flightFile=await binary(request(app).get(flight.body.url));assert.equal(flightFile.status,200);const book=new ExcelJS.Workbook();await book.xlsx.load(flightFile.body);assert.equal(book.getWorksheet('航班时刻表').getCell('F2').value,'0650');
  const source=await token(request(app).post('/api/flights/standby/import'),owner).attach('file',flightFile.body,'已确认航班.xlsx');assert.equal(source.status,200,JSON.stringify(source.body));assert.equal(source.body.duties.length,1);
  const reread=await token(request(app).post('/api/data/'+source.body.dataFileId+'/reimport'),owner);assert.equal(reread.status,200);assert.deepEqual(reread.body.duties,source.body.duties);
  const report={duties:source.body.duties,title:'验收当前方案',sourceName:'已确认航班.xlsx',shifts:[{name:'S1',start:'0600',end:'1300'}],requestedCount:1,fixedShifts:[{name:'S1',start:'0600',end:'1300'}]};
  const standbyXlsx=await managed(request(app).post('/api/flights/standby/export/xlsx'),owner,'验收方案.xlsx').send(report);assert.equal(standbyXlsx.status,200,JSON.stringify(standbyXlsx.body));
  const planBook=new ExcelJS.Workbook();await planBook.xlsx.load((await binary(request(app).get(standbyXlsx.body.url))).body);assert.equal(planBook.getWorksheet('规则与时段').getCell('B12').value,360);assert.equal(planBook.getWorksheet('规则与时段').getCell('C12').value,780);assert.equal(planBook.getWorksheet('航班 FDP buffer').getCell('E2').value,'0650');
  const standbyWord=await managed(request(app).post('/api/flights/standby/export/docx'),owner,'验收方案.docx').send(report);assert.equal(standbyWord.status,200);const doc=await mammoth.extractRawText({buffer:(await binary(request(app).get(standbyWord.body.url))).body});assert.match(doc.value,/验收当前方案/);assert.match(doc.value,/0600/);assert.match(doc.value,/1300/);assert.match(doc.value,/NX632/);
  const bank=await token(request(app).post('/api/import/confirm'),owner).send({title:'本地验收题库',questions:[{type:'boolean',question:'原件题目可以下载。',answer:true}]});assert.equal(bank.status,201);
  const exported=await managed(request(app).get('/api/banks/'+bank.body.id+'/export?answers=1'),owner,'本地验收题库.docx');assert.equal(exported.status,200);const bankDoc=await mammoth.extractRawText({buffer:(await binary(request(app).get(exported.body.url))).body});assert.match(bankDoc.value,/原件题目可以下载/);assert.match(bankDoc.value,/标准答案/);
  assert.equal((await token(request(app).get('/api/data'),owner)).body.filter(x=>x.kind==='export').length,4);
});

test('flight PDF and standby sources both link to a draft; trashing originals preserves existing draft edits but blocks new references',async()=>{
  const owner=await account(),{flightWorkbook}=await import('./flights.js');
  const pdf=flightPdf(['WITH EFFECT FROM 25Oct2026 to 27Mar2027','NX6321234567MFM0800TPE0935A321','NX6311234567TPE1035MFM1235A321']);
  const extracted=await token(request(app).post('/api/flights/extract'),owner).attach('file',pdf,'验收航班.pdf');assert.equal(extracted.status,200,JSON.stringify(extracted.body));assert.equal(extracted.body.flights.length,2);
  const payload={flights:extracted.body.flights,date:'2026-10-25',pairs:[{outId:'0',backId:'1',returnDays:0,outOpening:'0650'}]},xlsx=Buffer.from(await flightWorkbook(payload));
  const imported=await token(request(app).post('/api/flights/standby/import'),owner).attach('file',xlsx,'备份来源.xlsx');assert.equal(imported.status,200);
  const id=crypto.randomUUID(),draft={revision:0,title:'来源关联验收',data:extracted.body,standby:imported.body,pairs:payload.pairs,excluded:[],reviewed:[],date:payload.date,mode:'daily'};
  const saved=await token(request(app).put('/api/flights/drafts/'+id),owner).send(draft);assert.equal(saved.status,200,JSON.stringify(saved.body));
  const rows=(await token(request(app).get('/api/data'),owner)).body;assert.ok(rows.find(x=>x.id===extracted.body.dataFileId).links.some(x=>x.url==='/flights?draft='+id));assert.ok(rows.find(x=>x.id===imported.body.dataFileId).links.some(x=>x.url==='/flights/standby?draft='+id));
  await token(request(app).delete('/api/data/'+extracted.body.dataFileId),owner);await token(request(app).delete('/api/data/'+imported.body.dataFileId),owner);
  const changed=await token(request(app).put('/api/flights/drafts/'+id),owner).send({...draft,revision:saved.body.revision,title:'原件回收后仍可修改'});assert.equal(changed.status,200,JSON.stringify(changed.body));
  assert.equal((await token(request(app).put('/api/flights/drafts/'+crypto.randomUUID()),owner).send(draft)).status,400);
  const other=await account();assert.equal((await token(request(app).put('/api/flights/drafts/'+crypto.randomUUID()),other).send(draft)).status,404);
  assert.equal((await token(request(app).delete('/api/data/trash'),owner).send({ids:[extracted.body.dataFileId,imported.body.dataFileId]})).status,200);
  const afterPurge=await token(request(app).put('/api/flights/drafts/'+id),owner).send({...draft,revision:changed.body.revision,title:'原件彻底删除后仍可修改'});assert.equal(afterPurge.status,200,JSON.stringify(afterPurge.body));assert.equal((await token(request(app).get('/api/flights/drafts/'+id),owner)).body.title,'原件彻底删除后仍可修改');
});

test('moving an original to trash after ownership validation does not make a committed bank import report failure',async()=>{
  const owner=await account(),bytes=await fs.readFile(path.resolve('test-fixture.md'));
  const preview=await token(request(app).post('/api/import/preview'),owner).attach('file',bytes,'并发回收原件.md');assert.equal(preview.status,200);
  const id=preview.body.dataFileId,originalGet=dataFiles.get;
  dataFiles.get=async(accountId,fileId)=>{const row=await originalGet(accountId,fileId);if(accountId===owner.id&&fileId===id)await dataFiles.update(accountId,fileId,{deletedAt:new Date().toISOString()});return row;};
  try{
    const saved=await token(request(app).post('/api/import/confirm'),owner).send({...preview.body,title:'并发回收仍保留关联',questions:preview.body.questions});assert.equal(saved.status,201,JSON.stringify(saved.body));
    assert.equal((await token(request(app).get('/api/banks/'+saved.body.id),owner)).status,200);const row=(await dataFiles.list(owner.id)).find(x=>x.id===id);assert.ok(row.deletedAt);assert.ok(row.links.some(x=>x.url==='/bank/'+saved.body.id));assert.equal((await token(request(app).post('/api/data/'+id+'/download'),owner)).status,404);
  }finally{dataFiles.get=originalGet;}
});

test('one mixed-track CSV stays one original while belonging to both postgraduate and IELTS categories',async()=>{
  const owner=await account(),csv=Buffer.from('中文,英文,学习方向\n复习,review,postgraduate\n话题,topic,ielts\n');
  const preview=await token(request(app).post('/api/vocabulary/preview'),owner).attach('file',csv,'混合词汇.csv');assert.equal(preview.status,200,JSON.stringify(preview.body));
  const imported=await token(request(app).post('/api/vocabulary/import'),owner).send({entries:preview.body.entries,dataFileId:preview.body.dataFileId});assert.equal(imported.status,201,JSON.stringify(imported.body));
  const rows=(await token(request(app).get('/api/data'),owner)).body;assert.equal(rows.length,1);assert.deepEqual(rows[0].categories,['postgraduate','ielts']);assert.equal(rows[0].links.length,2);
  assert.deepEqual((await dataFiles.get(owner.id,preview.body.dataFileId)).categories,['postgraduate','ielts']);
  const grant=await token(request(app).post('/api/data/'+preview.body.dataFileId+'/download'),owner);assert.deepEqual((await binary(request(app).get(grant.body.url))).body,csv);
});

test('vocabulary import normalizes default and padded directions, and rejects invalid batches before saving any entries',async()=>{
  const owner=await account();
  const defaults=[{zh:'缺省方向甲',en:'default alpha'},{zh:'缺省方向乙',en:'default beta',track:''},{zh:'缺省方向丙',en:'default gamma',track:'   '},{zh:'基础英语',en:'trimmed english',track:' english '}];
  const accepted=await token(request(app).post('/api/vocabulary/import'),owner).send({entries:defaults});assert.equal(accepted.status,201,JSON.stringify(accepted.body));assert.equal(accepted.body.added,4);
  const words=(await token(request(app).get('/api/vocabulary?browse=1'),owner)).body;
  for(const entry of defaults){const word=words.find(x=>x.en===entry.en);assert.ok(word);assert.equal(word.track,entry.track===' english '?'english':'postgraduate');}
  const before=words.map(x=>x.id);
  for(const track of ['general','thai','invalid',5]){
    const rejected=await token(request(app).post('/api/vocabulary/import'),owner).send({entries:[{zh:'批次合法项',en:'valid in rejected batch',track:'ielts'},{zh:'批次非法项',en:'invalid in rejected batch',track}]});assert.equal(rejected.status,400,JSON.stringify(rejected.body));assert.match(rejected.body.error,/学习方向/);assert.deepEqual((await token(request(app).get('/api/vocabulary?browse=1'),owner)).body.map(x=>x.id),before);
  }
  const csv=Buffer.from('中文,英文\n按原文件默认,source default word\n');
  const preview=await token(request(app).post('/api/vocabulary/preview'),owner).field('track','english').attach('file',csv,'指定默认方向.csv');assert.equal(preview.status,200);
  const imported=await token(request(app).post('/api/vocabulary/import'),owner).send({entries:preview.body.entries,dataFileId:preview.body.dataFileId});assert.equal(imported.status,201,JSON.stringify(imported.body));
  const row=(await dataFiles.list(owner.id)).find(x=>x.id===preview.body.dataFileId);assert.deepEqual(row.categories,['english']);assert.ok(row.links.some(x=>x.url==='/english/dictionary?track=english'));assert.equal((await token(request(app).get('/api/vocabulary?browse=1&track=english'),owner)).body.find(x=>x.en==='source default word').track,'english');
});
