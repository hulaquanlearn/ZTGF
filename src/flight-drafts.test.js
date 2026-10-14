import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import request from 'supertest';
import crypto from 'node:crypto';
import {flightDraftRouter} from './flight-drafts.js';
import {cleanupExpiredUploads,cleanupExpiredFlightTrash} from './upload-cleanup.js';
test('draft deletion is recoverable, owner-scoped, revision-checked, and cannot be resurrected by autosave',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'quizforge-drafts-')),app=express(),id=crypto.randomUUID();app.use(express.json());app.use((req,res,next)=>{req.account={id:req.get('owner')||'alice'};next();});app.use(flightDraftRouter(root));app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
  const body={revision:0,title:'测试航班表',data:{flights:[],sourceName:'test.pdf',start:'2026-10-25'},pairs:[],excluded:[],reviewed:[],standby:{confirmed:true,duties:[]}};
  try{
    await request(app).put('/'+id).send(body).expect(200);
    await request(app).delete('/'+id).send({revision:0}).expect(409);
    await request(app).delete('/'+id).set('owner','bob').send({revision:1}).expect(404);
    await request(app).delete('/'+id).send({revision:1}).expect(200);
    assert.equal((await request(app).get('/').expect(200)).body.length,0);
    assert.equal((await request(app).get('/trash').expect(200)).body.length,1);
    await request(app).put('/'+id).send({...body,revision:1}).expect(410);
    await request(app).post('/'+id+'/restore').expect(200);
    const restored=(await request(app).get('/'+id).expect(200)).body;assert.equal(restored.revision,2);assert.equal(restored.standby.confirmed,true);
    await request(app).put('/'+id).send({...body,revision:1}).expect(409);
  }finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});}
});
test('automatic cleanup touches only expired Multer files and expired recycled drafts',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'quizforge-cleanup-')),now=Date.now(),old=now-8*86400000;
  try{
    const upload=path.join(root,'a'.repeat(32));await fs.writeFile(upload,'temp');await fs.utimes(upload,old/1000,old/1000);await fs.writeFile(path.join(root,'user.pdf'),'keep');await fs.writeFile(path.join(root,'b'.repeat(32)),'fresh');assert.equal(await cleanupExpiredUploads(root,now),1);assert.equal(await fs.readFile(path.join(root,'user.pdf'),'utf8'),'keep');
    const folder=path.join(root,'c'.repeat(64)),trash=path.join(folder,'trash');await fs.mkdir(trash,{recursive:true});const id=crypto.randomUUID();await fs.writeFile(path.join(folder,id+'.json'),JSON.stringify({deletedAt:new Date(old).toISOString()}));await fs.writeFile(path.join(trash,id+'.json'),JSON.stringify({deletedAt:new Date(old).toISOString()}));assert.equal(await cleanupExpiredFlightTrash(root,now),1);assert.ok(await fs.stat(path.join(folder,id+'.json')));
  }finally{assert.ok(path.resolve(root).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(root,{recursive:true,force:true});}
});
