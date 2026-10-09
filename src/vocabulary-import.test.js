import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseVocabularyFile, vocabularyTemplate } from './vocabulary-import.js';

test('词库模板可回读中文和英文',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'quizforge-vocab-')),file=path.join(dir,'template.xlsx');
  try{await fs.writeFile(file,await vocabularyTemplate());const parsed=await parseVocabularyFile({path:file,originalname:'template.xlsx'});assert.equal(parsed.entries.length,1);assert.equal(parsed.entries[0].zh,'放弃');assert.equal(parsed.entries[0].en,'abandon');assert.equal(parsed.entries[0].track,'postgraduate');assert.equal(parsed.incomplete.length,0);}finally{await fs.rm(dir,{recursive:true,force:true});}
});
