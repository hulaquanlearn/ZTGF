import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const testRoot=fs.mkdtempSync(path.join(os.tmpdir(),'quizforge-store-v6-'));
process.env.DATA_DIR=testRoot;
delete process.env.DB_HOST;delete process.env.DB_NAME;delete process.env.DB_USER;
const {store,publicQuiz}=await import('./db.js');
test.after(()=>fs.rmSync(testRoot,{recursive:true,force:true}));

test('one-time starter banks do not reappear after removal and bootstrap never overwrites credentials',()=>{
  const first=store.ensureBootstrapAccount('owner-test','old-secret');
  const again=store.ensureBootstrapAccount('owner-test','new-secret');
  assert.equal(first.candidate.id,again.candidate.id);
  assert.equal(store.authenticateCandidate('owner-test','new-secret').ok,false);
  const seeds=[{title:'阅读',track:'english',questions:[]}];
  assert.equal(store.ensureStarterBanks(first.candidate.id,seeds),1);
  store.deleteQuiz(store.listOwnedQuizzes(first.candidate.id)[0].id);
  assert.equal(store.ensureStarterBanks(first.candidate.id,seeds),0);
});

test('private vocabulary never enters another account search or collection',()=>{
  const owner=store.createCandidate('vocab-owner','secret-123').candidate;
  const other=store.createCandidate('vocab-other','secret-123').candidate;
  const word=store.addVocabulary([{zh:'私人练习',en:'private drill',track:'english'}],{ownerId:owner.id}).added[0];
  assert.equal(store.searchVocabulary('private',{candidateId:other.id}).length,0);
  assert.equal(store.searchVocabulary('private',{candidateId:owner.id}).length,1);
  const collection=store.createCollection(other.id,'他人的词库');
  assert.equal(store.addCollectionItem(other.id,collection.id,word.id),false);
});

test('bank deletion retains submitted results; wrong reading exercises retain distinct passages',()=>{
  const owner=store.createCandidate('reading-owner','secret-123').candidate,at=new Date().toISOString();
  store.addQuiz({id:'reading-bank',ownerId:owner.id,title:'阅读资料',status:'published',questions:[],createdAt:at});
  store.addExam({id:'reading-exam',bankId:'reading-bank',candidateId:owner.id,title:'已完成阅读',completedAt:at,questions:[],createdAt:at});
  const questions=['Passage one: blue.','Passage two: green.'].map((materialText,index)=>({type:'fill',question:'What color is it?',blanks:[{answers:[index?'green':'blue']}],language:'en',groupId:`g${index}`,materialText,materialTitle:'阅读材料'}));
  store.addAttempt({id:'reading-attempt',examId:'reading-exam',quizId:'reading-bank',candidateId:owner.id,questions,results:questions.map((q,index)=>({index,score:0,maxPoints:1,correctAnswer:q.blanks.map(b=>b.answers)})),createdAt:at});
  assert.equal(store.deleteQuizForOwner('reading-bank',owner.id),true);
  assert.equal(store.getAttemptForCandidate('reading-attempt',owner.id).title,'已完成阅读');
  assert.equal(store.getExamForCandidate('reading-exam',owner.id).bankId,null);
  const wrong=store.buildWrongExam(owner.id);assert.equal(wrong.length,2);assert.equal(wrong[0].materialText,questions[0].materialText);assert.equal(wrong[0].language,'en');
  const publicExam=publicQuiz({questions:[{...questions[0],answer:['secret'],explanation:'answer is secret'}]});
  assert.equal(JSON.stringify(publicExam).includes('secret'),false);assert.equal(Object.hasOwn(publicExam.questions[0].blanks[0],'answers'),false);
});

test('legacy JSON import retains learning records and private vocabulary ownership',()=>{
  const owner=store.createCandidate('legacy-owner','secret-123').candidate,at=new Date().toISOString();
  const legacy={
    vocabulary:[{id:'legacy-word',ownerId:owner.id,zh:'复习',en:'review',track:'english',reviewStatus:'approved'}],
    collections:[{id:'legacy-collection',candidateId:owner.id,name:'旧生词本',track:'english'}],
    collectionItems:[{collectionId:'legacy-collection',wordId:'legacy-word',createdAt:at}],
    wordProgress:[{candidateId:owner.id,wordId:'legacy-word',correct:2}],
    translationHistory:[{id:'legacy-translation',candidateId:owner.id,text:'hello',sourceRequested:'en',source:'en',targets:['zh'],translations:{zh:'你好'},track:'english'}],
    studyJournal:[{id:'legacy-note',candidateId:owner.id,track:'ielts',module:'writing',response:'My draft',createdAt:at}]
  };
  store.importLegacy(legacy);store.importLegacy(legacy);
  assert.equal(store.collectionWords(owner.id,'legacy-collection').length,1);
  assert.equal(store.getVocabulary('legacy-word',owner.id).ownerId,owner.id);
  assert.equal(store.getVocabulary('legacy-word','someone-else'),null);
  assert.equal(store.wordProgress(owner.id).length,1);
  assert.equal(store.listTranslations(owner.id).length,1);
  assert.equal(store.listStudyJournal(owner.id).length,1);
});
