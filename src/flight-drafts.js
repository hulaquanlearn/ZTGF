import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export function flightDraftRouter(root=path.resolve(process.env.DATA_DIR||'data','flight-drafts')){
  const router=express.Router(),locks=new Map();
  const folder=req=>path.join(root,crypto.createHash('sha256').update(req.account.id).digest('hex'));
  const file=(req,id)=>{if(!/^[a-f0-9-]{36}$/.test(id))throw Object.assign(new Error('草稿不存在'),{status:404});return path.join(folder(req),id+'.json');};
  const read=async filename=>{try{return JSON.parse(await fs.readFile(filename,'utf8'));}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  router.get('/',wrap(async(req,res)=>{let files;try{files=await fs.readdir(folder(req));}catch(e){if(e.code==='ENOENT')return res.json([]);throw e;}const drafts=await Promise.all(files.filter(x=>/^[a-f0-9-]{36}\.json$/.test(x)).map(x=>read(path.join(folder(req),x))));res.json(drafts.filter(Boolean).map(({id,title,updatedAt,revision,pairs,data})=>({id,title,updatedAt,revision,pairCount:pairs.length,flightCount:data.flights.length})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)));}));
  router.get('/:id',wrap(async(req,res)=>{const draft=await read(file(req,req.params.id));if(!draft)return res.status(404).json({error:'草稿不存在'});res.json(draft);}));
  router.put('/:id',wrap(async(req,res)=>{
    const filename=file(req,req.params.id),previous=locks.get(filename)||Promise.resolve();
    const task=previous.catch(()=>{}).then(async()=>{
      const old=await read(filename),b=req.body;
      if(!b.data||!Array.isArray(b.data.flights)||b.data.flights.length>1000||!Array.isArray(b.pairs)||b.pairs.length>500||!Array.isArray(b.excluded)||!Array.isArray(b.reviewed))throw Object.assign(new Error('草稿数据格式无效'),{status:400});
      if(Number(b.revision)!==(old?.revision||0))throw Object.assign(new Error('此草稿已在其他窗口更新。请重新打开草稿后继续，当前窗口内容未覆盖已保存版本。'),{status:409});
      const draft={id:req.params.id,title:String(b.title||b.data.sourceName||'航班时刻表').slice(0,100),revision:(old?.revision||0)+1,updatedAt:new Date().toISOString(),data:b.data,pairs:b.pairs,excluded:b.excluded,reviewed:b.reviewed,mode:b.mode==='daily'?'daily':'season',date:String(b.date||b.data.start)};
      await fs.mkdir(folder(req),{recursive:true});const temp=filename+'.'+crypto.randomUUID()+'.tmp';await fs.writeFile(temp,JSON.stringify(draft));await fs.rename(temp,filename);return draft;
    });locks.set(filename,task);try{const draft=await task;res.json({id:draft.id,revision:draft.revision,updatedAt:draft.updatedAt});}finally{if(locks.get(filename)===task)locks.delete(filename);}
  }));
  return router;
}
