import fs from 'node:fs/promises';
import path from 'node:path';
export async function cleanupExpiredUploads(directory,now=Date.now()){
  // Only Multer temporary file names; never user-named files or subdirectories.
  const root=path.resolve(directory);let names;try{names=await fs.readdir(root);}catch(e){if(e.code==='ENOENT')return 0;throw e;}
  let deleted=0;for(const name of names){if(!/^[a-f0-9]{32}$/.test(name))continue;const filename=path.join(root,name);try{const info=await fs.lstat(filename);if(info.isFile()&&!info.isSymbolicLink()&&info.mtimeMs<now-24*3600000){await fs.unlink(filename);deleted++;}}catch(e){if(e.code!=='ENOENT')throw e;}}
  return deleted;
}
export async function cleanupFlightTrashFolder(directory,now=Date.now()){
  const trash=path.resolve(directory);let files;
  try{const info=await fs.lstat(trash);if(!info.isDirectory()||info.isSymbolicLink())return 0;files=await fs.readdir(trash);}catch(e){if(e.code==='ENOENT')return 0;throw e;}
  let removed=0;
  for(const name of files){
    if(!/^[a-f0-9-]{36}\.json$/.test(name))continue;
    try{const filename=path.join(trash,name),info=await fs.lstat(filename);if(!info.isFile()||info.isSymbolicLink())continue;const draft=JSON.parse(await fs.readFile(filename,'utf8'));if(draft.deletedAt&&Date.parse(draft.deletedAt)<now-7*86400000){await fs.unlink(filename);removed++;}}catch(e){if(e.code!=='ENOENT')throw e;}
  }
  return removed;
}
export async function cleanupExpiredFlightTrash(directory,now=Date.now()){
  const root=path.resolve(directory);let accounts;try{accounts=await fs.readdir(root);}catch(e){if(e.code==='ENOENT')return 0;throw e;}let removed=0;
  for(const account of accounts){if(!/^[a-f0-9]{64}$/.test(account))continue;const owner=path.join(root,account),info=await fs.lstat(owner);if(!info.isDirectory()||info.isSymbolicLink())continue;removed+=await cleanupFlightTrashFolder(path.join(owner,'trash'),now);}
  return removed;
}
