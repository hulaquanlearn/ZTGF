import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { cleanupFlightTrashFolder } from './upload-cleanup.js';

export function flightDraftRouter(root=path.resolve(process.env.DATA_DIR||'data','flight-drafts'),dataFiles=null){
  const router=express.Router(),locks=new Map();
  const folder=req=>path.join(root,crypto.createHash('sha256').update(req.account.id).digest('hex'));
  const file=(req,id)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Object.assign(new Error('草稿不存在'),{status:404});return path.join(folder(req),id+'.json');};
  const read=async filename=>{try{return JSON.parse(await fs.readFile(filename,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const trashFile=(req,id)=>path.join(folder(req),'trash',path.basename(file(req,id)));
  const names=async directory=>{try{return (await fs.readdir(directory)).filter(x=>/^[a-f0-9-]{36}\.json$/.test(x));}catch(e){if(e.code==='ENOENT')return [];throw e;}};
  const cleanTrash=req=>cleanupFlightTrashFolder(path.join(folder(req),'trash'));
  const locked=async(filename,action)=>{const previous=locks.get(filename)||Promise.resolve(),task=previous.catch(()=>{}).then(action);locks.set(filename,task);try{return await task;}finally{if(locks.get(filename)===task)locks.delete(filename);}};
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  router.get('/',wrap(async(req,res)=>{await cleanTrash(req);const files=await names(folder(req)),drafts=await Promise.all(files.map(x=>read(path.join(folder(req),x))));res.json(drafts.filter(Boolean).map(({id,title,updatedAt,revision,pairs,data})=>({id,title,updatedAt,revision,pairCount:pairs.length,flightCount:data.flights.length})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));}));
  router.get('/trash',wrap(async(req,res)=>{await cleanTrash(req);const drafts=await Promise.all((await names(path.join(folder(req),'trash'))).map(name=>read(path.join(folder(req),'trash',name))));res.json(drafts.filter(Boolean).map(({id,title,deletedAt})=>({id,title,deletedAt,expiresAt:new Date(Date.parse(deletedAt)+7*86400000).toISOString()})));}));
  router.delete('/:id',wrap(async(req,res)=>{const filename=file(req,req.params.id);await locked(filename,async()=>{const draft=await read(filename);if(!draft)throw Object.assign(new Error('草稿不存在'),{status:404});if(Number(req.body.revision)!==draft.revision)throw Object.assign(new Error('草稿已更新，请重新打开后删除'),{status:409});const target=trashFile(req,req.params.id);await fs.mkdir(path.dirname(target),{recursive:true});const temp=target+'.tmp';await fs.writeFile(temp,JSON.stringify({...draft,deletedAt:new Date().toISOString()}));await fs.rename(temp,target);await fs.unlink(filename);});res.json({ok:true,retentionDays:7});}));
  router.post('/:id/restore',wrap(async(req,res)=>{const filename=file(req,req.params.id);await locked(filename,async()=>{await cleanTrash(req);const target=trashFile(req,req.params.id),draft=await read(target);if(!draft)throw Object.assign(new Error('已超过恢复期限或草稿不存在'),{status:404});if(await read(filename))throw Object.assign(new Error('同名草稿已存在'),{status:409});delete draft.deletedAt;draft.revision++;draft.updatedAt=new Date().toISOString();await fs.writeFile(filename,JSON.stringify(draft));await fs.unlink(target);});res.json({ok:true});}));
  router.get('/:id',wrap(async(req,res)=>{const draft=await read(file(req,req.params.id));if(!draft)return res.status(404).json({error:'草稿不存在'});res.json(draft);}));
  router.put('/:id',wrap(async(req,res)=>{
    const filename=file(req,req.params.id),previous=locks.get(filename)||Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      const old=await read(filename),b=req.body;
      if(await read(trashFile(req,req.params.id)))throw Object.assign(new Error('此草稿已删除，请先从回收站恢复'),{status:410});
      if(!old&&(await names(folder(req))).length>=50)throw Object.assign(new Error('最多保存 50 份航班草稿，请先清理旧版本'),{status:400});
      if(!b.data||!Array.isArray(b.data.flights)||b.data.flights.length>1000||!Array.isArray(b.pairs)||b.pairs.length>500||!Array.isArray(b.excluded)||!Array.isArray(b.reviewed))throw Object.assign(new Error('草稿数据格式无效'),{status:400});
      if(Number(b.revision)!==(old?.revision||0))throw Object.assign(new Error('此草稿已在其他窗口更新。请重新打开草稿后继续，当前窗口内容未覆盖已保存版本。'),{status:409});
      if(b.standby&&JSON.stringify(b.standby).length>1000000)throw Object.assign(new Error('备份草稿过大'),{status:400});
      const sourceIds=[...new Set([b.data?.dataFileId,b.standby?.dataFileId].filter(Boolean))];
      const previousSources=new Set([old?.data?.dataFileId,old?.standby?.dataFileId].filter(Boolean));
      if(dataFiles)for(const sourceId of sourceIds)if(!previousSources.has(sourceId))await dataFiles.get(req.account.id,sourceId);
      const draft={id:req.params.id,title:String(b.title||b.data.sourceName||'航班时刻表').slice(0,100),revision:(old?.revision||0)+1,updatedAt:new Date().toISOString(),data:b.data,pairs:b.pairs,excluded:b.excluded,reviewed:b.reviewed,mode:b.mode==='daily'?'daily':'season',date:String(b.date||b.data.start),standby:b.standby||null};
      if(Buffer.byteLength(JSON.stringify(draft),'utf8')>1500000)throw Object.assign(new Error('单份草稿不能超过 1.5 MB'),{status:400});
      await fs.mkdir(folder(req),{recursive:true});const temp=filename+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(draft));await fs.rename(temp,filename);
      if(dataFiles)for(const sourceId of sourceIds)if(!previousSources.has(sourceId))await dataFiles.link(req.account.id,sourceId,{label:draft.title,url:(sourceId===b.standby?.dataFileId?'/flights/standby':'/flights')+'?draft='+draft.id},{includeDeleted:true});
      return draft;
    });locks.set(filename,task);try{const draft=await task;res.json({id:draft.id,revision:draft.revision,updatedAt:draft.updatedAt});}finally{if(locks.get(filename)===task)locks.delete(filename);}
  }));
  return router;
}
