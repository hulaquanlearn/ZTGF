import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const categories = new Set(['banks', 'english', 'postgraduate', 'ielts', 'corpus', 'flights']);
const fileCategories=row=>{
  const linked=(row.links||[]).flatMap(link=>{try{const url=new URL(link.url,'http://local');return url.pathname==='/english/dictionary'?[url.searchParams.get('track')]:[];}catch{return [];}});
  return [...new Set([row.category,...(Array.isArray(row.categories)?row.categories:[]),...linked])].filter(category=>categories.has(category));
};
export const fileCategory = req => req.originalUrl.includes('/flights') ? 'flights' : req.originalUrl.includes('/vocabulary') ? (categories.has(req.body?.track)?req.body.track:'postgraduate') : categories.has(req.body?.track) ? req.body.track : 'banks';
const mime = name => ({ pdf:'application/pdf', doc:'application/msword', docx:'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', csv:'text/csv; charset=utf-8', txt:'text/plain; charset=utf-8', md:'text/plain; charset=utf-8', markdown:'text/plain; charset=utf-8' })[name.split('.').at(-1).toLowerCase()] || 'application/octet-stream';
const safeName = name => {
  const clean=path.basename(String(name || '未命名文件').replaceAll('\\','/')).replace(/[\u0000-\u001f<>:"|?*]/g, '_').trim();
  if(!clean)return '未命名文件';
  const extension=path.extname(clean).slice(0,20);
  return clean.length<=180?clean:clean.slice(0,180-extension.length)+extension;
};
const fail = (message,status=400) => Object.assign(new Error(message),{status});
const importType = req => req.originalUrl.includes('/flights/standby/import') ? 'standby' : req.originalUrl.includes('/flights/extract') ? 'flights' : req.originalUrl.includes('/vocabulary/') ? 'vocabulary' : 'bank';
const originalName = value => {
  const name=String(value||'');
  if(!/[\u0080-\u00ff]/.test(name))return name;
  const decoded=Buffer.from(name,'latin1').toString('utf8');
  return decoded.includes('\ufffd')?name:decoded;
};

export function createDataFiles(root) {
  root=path.resolve(root);
  const folder=owner=>path.join(root,crypto.createHash('sha256').update(String(owner)).digest('hex'));
  const recordPath=(owner,id)=>{if(!uuid.test(id))throw fail('文件不存在',404);return path.join(folder(owner),id+'.json');};
  let queue=Promise.resolve();
  const serial=fn=>{const job=queue.then(fn);queue=job.catch(()=>{});return job;};
  async function read(owner,id){try{return JSON.parse(await fs.readFile(recordPath(owner,id),'utf8'));}catch(e){if(e.code==='ENOENT')throw fail('文件不存在',404);throw e;}}
  async function write(owner,row){const target=recordPath(owner,row.id),temp=target+'.tmp';await fs.writeFile(temp,JSON.stringify(row));await fs.rename(temp,target);}
  async function list(owner){await queue;let names;try{names=await fs.readdir(folder(owner));}catch(e){if(e.code==='ENOENT')return [];throw e;}return (await Promise.all(names.filter(n=>uuid.test(n.slice(0,-5))&&n.endsWith('.json')).map(n=>read(owner,n.slice(0,-5))))).map(row=>({...row,categories:fileCategories(row)})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
  async function add(owner,bytes,{name,category='banks',kind='import',contentType,status='已导入',links=[],importer,sourceOptions}={}){
    await queue;
    const buffer=Buffer.from(bytes),hash=crypto.createHash('sha256').update(buffer).digest('hex');
    return serial(async()=>{
      await fs.mkdir(folder(owner),{recursive:true});
      const names=await fs.readdir(folder(owner));let duplicateOf=null;
      for(const n of names.filter(n=>n.endsWith('.json'))){const previous=await read(owner,n.slice(0,-5));if(!previous.deletedAt&&previous.hash===hash){duplicateOf=previous.id;break;}}
      const row={id:crypto.randomUUID(),name:safeName(name),category:categories.has(category)?category:'banks',kind,size:buffer.length,hash,contentType:contentType||mime(safeName(name)),status,links,duplicateOf,createdAt:new Date().toISOString(),...(importer?{importer,sourceOptions}: {})};
      await fs.writeFile(path.join(folder(owner),row.id+'.bin'),buffer);await write(owner,row);return row;
    });
  }
  async function update(owner,id,changes){return serial(async()=>{const row=await read(owner,id);const next={...row,...changes,updatedAt:new Date().toISOString()};await write(owner,next);return next;});}
  async function purge(owner,ids){
    if(!Array.isArray(ids)||!ids.length||ids.some(id=>typeof id!=='string'||!uuid.test(id)))throw fail('请选择回收站中的文件');
    return serial(async()=>{
      const selected=[...new Set(ids)];
      for(const id of selected){const row=await read(owner,id);if(!row.deletedAt)throw fail('只能彻底删除回收站中的文件',409);}
      for(const id of selected){await fs.unlink(path.join(folder(owner),id+'.bin')).catch(error=>{if(error.code!=='ENOENT')throw error;});await fs.unlink(recordPath(owner,id));}
      const tickets=path.join(root,'tickets'),names=await fs.readdir(tickets).catch(error=>{if(error.code==='ENOENT')return [];throw error;});
      for(const name of names.filter(name=>/^[a-f0-9]{64}\.json$/.test(name))){const grant=JSON.parse(await fs.readFile(path.join(tickets,name),'utf8'));if(grant.owner===owner&&selected.includes(grant.id))await fs.unlink(path.join(tickets,name));}
      return {deleted:selected.length};
    });
  }
  async function link(owner,id,link,{includeDeleted=false}={}){if(!id)return;return serial(async()=>{const row=await read(owner,id);if(row.deletedAt&&!includeDeleted)throw fail('原文件已移入回收站，请恢复后关联');if(!row.links.some(x=>x.url===link.url))row.links.push(link);row.status='已关联';await write(owner,row);return row;});}
  async function ticket(owner,id){await queue;const row=await read(owner,id);if(row.deletedAt)throw fail('文件已移入回收站',404);const secret=crypto.randomBytes(32).toString('hex'),digest=crypto.createHash('sha256').update(secret).digest('hex'),dir=path.join(root,'tickets');await fs.mkdir(dir,{recursive:true});const expiresAt=new Date(Date.now()+86400000).toISOString();await fs.writeFile(path.join(dir,digest+'.json'),JSON.stringify({owner,id,expiresAt}));return {url:'/downloads/'+secret,name:row.name,expiresAt,id};}
  async function serve(req,res,next){try{const secret=req.params.ticket;if(!/^[a-f0-9]{64}$/.test(secret))throw fail('下载链接无效',404);const digest=crypto.createHash('sha256').update(secret).digest('hex');let grant;try{grant=JSON.parse(await fs.readFile(path.join(root,'tickets',digest+'.json'),'utf8'));}catch(e){if(e.code==='ENOENT')throw fail('下载链接已失效，请返回数据管理重新下载',404);throw e;}if(Date.parse(grant.expiresAt)<Date.now())throw fail('下载链接已过期，请返回数据管理重新下载',410);await queue;const row=await read(grant.owner,grant.id);if(row.deletedAt)throw fail('文件已移入回收站',404);res.set({'Cache-Control':'private, no-store','Referrer-Policy':'no-referrer','Content-Type':row.contentType});res.download(path.join(folder(grant.owner),row.id+'.bin'),row.name,e=>{if(e&&!res.headersSent)next(e);});}catch(e){next(e);}}
  const wrap=fn=>(req,res,next)=>Promise.resolve(fn(req,res)).catch(next);
  const router=express.Router();
  router.get('/',wrap(async(req,res)=>res.json(await list(req.account.id))));
  router.delete('/trash',wrap(async(req,res)=>res.json(await purge(req.account.id,req.body.ids))));
  router.delete('/:id/permanent',wrap(async(req,res)=>res.json(await purge(req.account.id,[req.params.id]))));
  router.patch('/:id',wrap(async(req,res)=>{await queue;const row=await read(req.account.id,req.params.id);if(row.deletedAt)throw fail('请先恢复文件');if(!String(req.body.name||'').trim())throw fail('请输入文件名');const extension=path.extname(row.name);let name=safeName(req.body.name);if(path.extname(name).toLowerCase()!==extension.toLowerCase())name+=extension;res.json(await update(req.account.id,row.id,{name}));}));
  router.delete('/:id',wrap(async(req,res)=>res.json(await update(req.account.id,req.params.id,{deletedAt:new Date().toISOString()}))));
  router.post('/:id/restore',wrap(async(req,res)=>res.json(await update(req.account.id,req.params.id,{deletedAt:null}))));
  router.post('/:id/download',wrap(async(req,res)=>res.json(await ticket(req.account.id,req.params.id))));
  router.get('/:id/preview',wrap(async(req,res)=>{await queue;const row=await read(req.account.id,req.params.id);if(row.deletedAt)throw fail('文件不存在',404);if(!/\.(txt|md|markdown|csv)$/i.test(row.name))throw fail('此格式请下载后预览');const bytes=await fs.readFile(path.join(folder(req.account.id),row.id+'.bin'));res.json({name:row.name,text:bytes.subarray(0,256*1024).toString('utf8'),truncated:bytes.length>256*1024});}));
  router.post('/:id/reimport',wrap(async(req,res)=>{await queue;const row=await read(req.account.id,req.params.id);if(row.deletedAt||row.kind!=='import')throw fail('请选择导入资料');const {extractText}=await import('./extract.js'),{parseExistingQuestions}=await import('./parser.js'),{parseVocabularyFile}=await import('./vocabulary-import.js'),{parseFlightText}=await import('./flights.js'),{importStandbyWorkbook}=await import('./standby.js');const file={path:path.join(folder(req.account.id),row.id+'.bin'),originalname:row.name};let result;
    const importer=row.importer||(row.category==='flights'?(/\.xlsx$/i.test(row.name)?'standby':'flights'):/\.(xlsx|csv)$/i.test(row.name)?'vocabulary':'bank');
    try{
      if(importer==='standby')result=await importStandbyWorkbook(await fs.readFile(file.path));
      else if(importer==='flights')result=parseFlightText(await extractText(file));
      else if(importer==='vocabulary')result=await parseVocabularyFile(file);
      else {result=parseExistingQuestions(await extractText(file));if(!result.questions.length&&!result.incomplete.length)throw fail('没有识别到题号、题干与答案结构，请检查原文件',422);}
    }catch(error){await update(req.account.id,row.id,{status:'解析失败'});error.status=Number(error.status)||400;throw error;}
    await update(req.account.id,row.id,{status:'已重新解析'});res.json({dataFileId:row.id,category:row.category,name:row.name,sourceName:row.name,sourceOptions:row.sourceOptions||{},...result});
  }));
  return {add,list,update,link,ticket,serve,router,get:async(owner,id)=>{await queue;const row=await read(owner,id);if(row.deletedAt)throw fail('请先恢复原文件');return row;},flush:()=>queue};
}

export function managedExports(files){return (req,res,next)=>{
  if(req.get('x-download-mode')!=='managed')return next();
  const send=res.send.bind(res);
  const onError=error=>{res.removeHeader('Content-Disposition');res.removeHeader('Content-Length');res.removeHeader('Content-Type');next(error);};
  res.send=body=>{if(res.statusCode>=400||!String(res.get('Content-Disposition')||'').startsWith('attachment'))return send(body);
    let requestedName;
    try{requestedName=decodeURIComponent(req.get('x-download-name')||'');}catch{onError(fail('下载文件名无效'));return res;}
    const extension=/spreadsheet/.test(res.get('Content-Type'))?'.xlsx':'.docx';
    const base=safeName(requestedName||'导出文件'+extension);
    const name=path.extname(base).toLowerCase()===extension?base:base.replace(/\.[^.]*$/,'')+extension;
    const category=req.get('x-data-category')||fileCategory(req);
    files.add(req.account.id,body,{name,category,kind:'export',contentType:res.get('Content-Type'),status:'已生成'}).then(async row=>{
      const grant=await files.ticket(req.account.id,row.id);res.removeHeader('Content-Disposition');res.removeHeader('Content-Length');res.type('json');send(JSON.stringify(grant));
    }).catch(onError);return res;
  };next();
};}

export function trackedUploads(upload,files){return {single:field=>{
  const receive=upload.single(field);
  return (req,res,next)=>receive(req,res,async error=>{if(error)return next(error);if(!req.file)return next();try{
    const name=originalName(req.file.originalname),sourceOptions=Object.fromEntries(['title','track','module','category','mode'].filter(key=>typeof req.body?.[key]==='string').map(key=>[key,req.body[key].slice(0,200)]));
    const row=await files.add(req.account.id,await fs.readFile(req.file.path),{name,category:fileCategory(req),kind:'import',status:'待检查',importer:importType(req),sourceOptions});req.dataFileId=row.id;
    const json=res.json.bind(res);res.json=body=>{
      if(res.statusCode<400&&body&&typeof body==='object'&&!Array.isArray(body))body={...body,dataFileId:row.id,duplicateOf:row.duplicateOf};
      files.update(req.account.id,row.id,{status:res.statusCode>=400?'解析失败':'待确认'}).catch(()=>{});return json(body);
    };next();
  }catch(e){await fs.unlink(req.file.path).catch(()=>{});next(e);}});
}};}
