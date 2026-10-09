import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateV6 } from './migrate-v6.js';
import { createRelationalStorage } from './relational.js';

test('v6 upgrade adds fields once and widens tracks without deleting historical rows', async()=>{
  const columns=new Set(), widened=new Set(), mutations=[];
  const pool={
    async execute(sql,args){return [sql.includes('DATA_TYPE')?[{DATA_TYPE:widened.has(args[0])?'varchar':'enum'}]:columns.has(args.join('.'))?[{COLUMN_NAME:args[1]}]:[]];},
    async query(sql){mutations.push(sql);let m=sql.match(/ALTER TABLE (\w+) ADD COLUMN (\w+)/);if(m)columns.add(`${m[1]}.${m[2]}`);m=sql.match(/ALTER TABLE (\w+) MODIFY COLUMN track/);if(m)widened.add(m[1]);return [[]];}
  };
  await migrateV6(pool);await migrateV6(pool);
  assert.equal(mutations.filter(x=>x.includes('ADD COLUMN')).length,4);
  assert.equal(mutations.filter(x=>x.includes('MODIFY COLUMN')).length,6);
  assert.equal(mutations.some(x=>/\b(DROP|DELETE|TRUNCATE)\b/i.test(x)),false);
});

test('relational persistence binds category, private vocabulary, draft answers and study journal',async()=>{
  const calls=[];
  const connection={
    async beginTransaction(){},async commit(){},async rollback(){},release(){},
    async execute(sql,values=[]){assert.equal((sql.match(/\?/g)||[]).length,values.length,sql);calls.push({sql,values});return [[]];},
    async query(){return [[]];}
  };
  const pool={
    async query(){return [[]];},
    async execute(sql,args){return [[sql.includes('DATA_TYPE')?{DATA_TYPE:'varchar'}:{COLUMN_NAME:args[1]}]];},
    async getConnection(){return connection;}
  };
  const storage=await createRelationalStorage({}, {pool});
  const at=new Date().toISOString();
  await storage.persist({
    candidates:[{id:'user-1',name:'learner',nameKey:'learner',salt:'salt',passwordHash:'hash',starterInitialized:true,createdAt:at}],
    sessions:[],quizzes:[{id:'bank-1',ownerId:'user-1',title:'软考',category:'系统集成',track:'general',questions:[],createdAt:at}],
    exams:[{id:'exam-1',candidateId:'user-1',candidateName:'learner',title:'练习',questions:[],draftAnswers:{0:'B'},createdAt:at}],attempts:[],
    vocabulary:[{id:'word-1',ownerId:'user-1',zh:'计划',en:'plan',track:'english',createdAt:at}],collections:[],collectionItems:[],wordProgress:[],translationHistory:[],
    studyJournal:[{id:'journal-1',candidateId:'user-1',track:'ielts',module:'writing',prompt:'Describe a city.',response:'My city is small.',notes:'检查时态',createdAt:at}],
    corpus:[{id:'corpus-1',ownerId:'user-1',category:'reading',title:'Reading',content:'Example.',createdAt:at,updatedAt:at}]
  });
  const bank=calls.find(x=>x.sql.includes('INSERT INTO question_banks'));assert.match(bank.sql,/category_name/);assert.ok(bank.values.includes('系统集成'));
  const word=calls.find(x=>x.sql.includes('INSERT INTO vocabulary_entries'));assert.match(word.sql,/owner_id/);assert.equal(word.values[1],'user-1');
  const exam=calls.find(x=>x.sql.includes('INSERT INTO exams'));assert.match(exam.sql,/draft_answers_json/);assert.ok(exam.values.includes('{"0":"B"}'));
  assert.ok(calls.some(x=>x.sql.includes('INSERT INTO study_journal')));
  const corpus=calls.find(x=>x.sql.includes('INSERT INTO corpus_entries'));assert.equal(corpus.values[1],'user-1');assert.match(corpus.values[2],/Example/);
});
