import 'dotenv/config';
import path from 'node:path';
import { parseVocabularyFile } from '../src/vocabulary-import.js';

const args=Object.fromEntries(process.argv.slice(2).map(value=>{const [key,...rest]=value.replace(/^--/,'').split('=');return [key,rest.join('=')||true];}));
if(!args.file)throw new Error('请提供 --file=seed-data/审核后的词库.xlsx');
const file={path:path.resolve(String(args.file)),originalname:path.basename(String(args.file))};
const preview=await parseVocabularyFile(file);if(preview.incomplete.length)throw new Error(`仍有 ${preview.incomplete.length} 行缺少中文或目标语言，请先审核补全`);
const {store}=await import('../src/db.js');const result=store.addVocabulary(preview.entries);await store.flush();
console.log(JSON.stringify({ok:true,total:preview.entries.length,added:result.added.length,duplicates:result.duplicates.length,storage:store.storageMode()},null,2));
