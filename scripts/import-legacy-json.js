import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
const source=path.resolve(process.argv[2]||'data/quizforge.json');
if(!fs.existsSync(source))throw new Error(`找不到旧数据文件：${source}`);
const legacy=JSON.parse(fs.readFileSync(source,'utf8'));
const {store}=await import('../src/db.js');
if(store.storageMode()!=='mysql')throw new Error('旧数据导入只能在 MySQL 模式执行');
const counts=store.importLegacy(legacy);await store.flush();console.log(JSON.stringify({ok:true,source,counts}));process.exit(0);
