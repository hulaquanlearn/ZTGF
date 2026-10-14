import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import request from 'supertest';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'quizforge-unified-test-'));
Object.assign(process.env, {
  DATA_DIR: path.join(temporary, 'data'), UPLOAD_DIR: path.join(temporary, 'uploads'),
  APP_USERNAME: 'bootstrap-account', APP_PASSWORD: 'test-bootstrap-password',
  ADMIN_USERNAME: '', ADMIN_PASSWORD: '', AUTO_SEED_VOCABULARY: '0',
  DB_HOST: '', DB_NAME: '', DB_USER: '', TRANSLATION_PROVIDER: ''
});
const { store } = await import('./db.js');
const preserved = store.createCandidate('existing-account', 'existing-password').candidate;
const legacyId = crypto.randomUUID(), privateId = crypto.randomUUID();
store.addQuiz({ id: legacyId, title: '旧版公共题库', status: 'published', questions: [], createdAt: new Date().toISOString() });
store.addQuiz({ id: privateId, title: '原有私有题库', status: 'published', visibility: 'private', ownerId: preserved.id, questions: [], createdAt: new Date().toISOString() });
const oldAdminToken = store.createSession({ role: 'admin', name: 'old-admin' });
const { app, dataFiles } = await import('./server.js');
const fixture = path.resolve('test-fixture.md');
const withToken = (req, token) => req.set('x-session-token', token);
const login = (username, password) => request(app).post('/api/account/login').send({ username, password });

test('航班工具深层路由、登录保护、人工配对预览与 XLSX 导出',async()=>{
  const {parseFlightText}=await import('./flights.js');
  const data=parseFlightText('WITH EFFECT FROM 25Oct2026 to 27Mar2027\nNX6321234567MFM0800TPE0935A321\nNX6311234567TPE1035MFM1235A321');
  const payload={flights:data.flights,date:'2026-10-25',pairs:[{outId:'0',backId:'1',returnDays:0}]};
  assert.equal((await request(app).get('/flights')).status,200);
  assert.equal((await request(app).get('/flights/standby')).status,200);
  assert.equal((await request(app).post('/api/flights/standby/analyze').send({duties:[]})).status,401);
  for(const endpoint of ['preview','export','extract'])assert.equal((await request(app).post('/api/flights/'+endpoint).send(payload)).status,401);
  const a=await account('flight-test');
  const preview=await withToken(request(app).post('/api/flights/preview'),a.token).send(payload);
  assert.equal(preview.status,200);assert.equal(preview.body.headers.length,9);assert.equal(preview.body.rows[0][6],'0800');
  const exported=await withToken(request(app).post('/api/flights/export'),a.token).send(payload);
  assert.equal(exported.status,200);assert.match(exported.headers['content-type'],/spreadsheetml/);
  assert.equal((await withToken(request(app).post('/api/flights/preview'),a.token).send({...payload,pairs:[]})).status,400);
});

test('语料四分类、查看编辑搜索、冲突提示及所有者隔离',async()=>{
  const a=await account('corpus-a'),b=await account('corpus-b');
  for(const category of ['reading','listening','writing','speaking']){
    const created=await withToken(request(app).post('/api/corpus'),a.token).send({category,title:'环境表达',content:'Protect the environment.',translation:'保护环境。',tags:'环境'});
    assert.equal(created.status,201);const row=created.body;
    assert.equal((await withToken(request(app).get('/api/corpus/'+row.id),b.token)).status,404);
    assert.equal((await withToken(request(app).put('/api/corpus/'+row.id),b.token).send(row)).status,404);
    assert.equal((await withToken(request(app).delete('/api/corpus/'+row.id),b.token)).status,404);
    const changed=await withToken(request(app).put('/api/corpus/'+row.id),a.token).send({...row,content:'A sustainable future.'});assert.equal(changed.status,200);
    assert.equal((await withToken(request(app).put('/api/corpus/'+row.id),a.token).send(row)).status,409);
    const matches=await withToken(request(app).get(`/api/corpus?category=${category}&q=sustainable`),a.token);assert.equal(matches.body.length,1);
    assert.equal((await withToken(request(app).delete('/api/corpus/'+row.id),a.token)).status,200);
  }
  assert.equal((await withToken(request(app).post('/api/corpus'),a.token).send({category:'thai',title:'a',content:'a'})).status,400);
  assert.equal((await withToken(request(app).post('/api/corpus'),a.token).send({category:'reading',title:'a',content:''})).status,400);
  assert.equal((await withToken(request(app).get('/api/corpus'),b.token)).body.length,0);
});
test('普通路径直接打开刷新返回页面，未知接口不伪装成网页',async()=>{
  for(const url of ['/login','/corpus','/corpus/writing','/ielts/reading','/banks','/data','/flights?draft=preview']){const response=await request(app).get(url);assert.equal(response.status,200);assert.match(response.text,/智题工坊/);}
  const response=await request(app).get('/api/not-existing');assert.notEqual(response.status,200);
});

test('导入原件可管理和重导入，确认与下载均隔离账号，回收后业务题库保留',async()=>{
  const owner=await account('managed-bank'),other=await account('managed-other');
  const preview=await withToken(request(app).post('/api/import/preview'),owner.token)
    .field('title','我的阅读资料').field('track','ielts').field('module','reading').field('category','Part 1').field('mode','extract').attach('file',fixture);
  assert.equal(preview.status,200);const fileId=preview.body.dataFileId;assert.ok(fileId);
  const payload={title:'修改后的题库',track:'ielts',module:'reading',category:'Part 2',sourceName:preview.body.sourceName,dataFileId:fileId,questions:preview.body.questions};
  const before=(await withToken(request(app).get('/api/banks'),other.token)).body.length;
  assert.equal((await withToken(request(app).post('/api/import/confirm'),other.token).send(payload)).status,404);
  assert.equal((await withToken(request(app).get('/api/banks'),other.token)).body.length,before);
  assert.equal((await withToken(request(app).post(`/api/data/${fileId}/reimport`),other.token)).status,404);
  const confirmed=await withToken(request(app).post('/api/import/confirm'),owner.token).send(payload);assert.equal(confirmed.status,201);
  const files=(await withToken(request(app).get('/api/data'),owner.token)).body,original=files.find(row=>row.id===fileId);
  assert.equal(original.category,'ielts');assert.equal(original.sourceOptions.module,'reading');assert.equal(original.sourceOptions.category,'Part 2');
  assert.ok(original.links.some(link=>link.url==='/bank/'+confirmed.body.id));
  const parsedAgain=await withToken(request(app).post(`/api/data/${fileId}/reimport`),owner.token);
  assert.equal(parsedAgain.status,200);assert.equal(parsedAgain.body.dataFileId,fileId);assert.equal(parsedAgain.body.questions.length,preview.body.questions.length);
  assert.equal(parsedAgain.body.sourceOptions.title,'修改后的题库');
  const grant=await withToken(request(app).post(`/api/data/${fileId}/download`),owner.token);assert.equal(grant.status,200);
  const downloaded=await request(app).get(grant.body.url);assert.equal(downloaded.status,200);assert.equal(downloaded.text,fs.readFileSync(fixture,'utf8'));
  assert.equal((await withToken(request(app).post(`/api/data/${fileId}/download`),other.token)).status,404);
  assert.equal((await withToken(request(app).delete(`/api/data/${fileId}`),owner.token)).status,200);
  assert.equal((await request(app).get(grant.body.url)).status,404);
  assert.equal((await withToken(request(app).get('/api/banks/'+confirmed.body.id),owner.token)).status,200);
  assert.equal((await withToken(request(app).post(`/api/data/${fileId}/restore`),owner.token)).status,200);
  assert.equal((await request(app).get(grant.body.url)).status,200);
});

test('题库导出生成持久 HTTP 下载记录，文件内容仍为有效 Word',async()=>{
  const owner=await account('managed-export'),created=await bank(owner,[{type:'boolean',question:'下载测试题',answer:true}]);
  const exported=await withToken(request(app).get(`/api/banks/${created.id}/export?answers=1`),owner.token)
    .set('x-download-mode','managed').set('x-download-name',encodeURIComponent('我的题库与答案.docx')).set('x-data-category','banks');
  assert.equal(exported.status,200);assert.equal(exported.body.name,'我的题库与答案.docx');assert.match(exported.body.url,/^\/downloads\/[a-f0-9]{64}$/);
  const doc=await request(app).get(exported.body.url).buffer(true).parse((response,done)=>{const parts=[];response.on('data',chunk=>parts.push(chunk));response.on('end',()=>done(null,Buffer.concat(parts)));});
  assert.equal(doc.status,200);assert.match(doc.headers['content-type'],/wordprocessingml/);assert.equal(doc.body.subarray(0,2).toString(),'PK');assert.ok(doc.body.length>1000);
  const rows=(await withToken(request(app).get('/api/data'),owner.token)).body;
  assert.ok(rows.some(row=>row.kind==='export'&&row.name==='我的题库与答案.docx'));
});

test('词汇原表与解析失败的文件均可在数据管理找回',async()=>{
  const owner=await account('managed-words');
  const csv=Buffer.from('英文,中文,学习方向\nplan,方案,ielts\nrevise,修订,ielts\nincomplete,,ielts\n');
  const preview=await withToken(request(app).post('/api/vocabulary/preview'),owner.token).attach('file',csv,{filename:'个人词汇.csv'});
  assert.equal(preview.status,200);assert.equal(preview.body.entries.length,2);assert.equal(preview.body.incomplete.length,1);
  const saved=await withToken(request(app).post('/api/vocabulary/import'),owner.token).send({entries:preview.body.entries,dataFileId:preview.body.dataFileId});assert.equal(saved.status,201);
  const files=(await withToken(request(app).get('/api/data'),owner.token)).body,words=files.find(row=>row.id===preview.body.dataFileId);
  assert.equal(words.category,'ielts');assert.ok(words.links.some(link=>link.url.startsWith('/english/dictionary')));
  const reimported=await withToken(request(app).post(`/api/data/${words.id}/reimport`),owner.token);assert.equal(reimported.status,200);assert.equal(reimported.body.entries.length,2);
  const failed=await withToken(request(app).post('/api/import/preview'),owner.token).attach('file',Buffer.from('没有题号或答案的原始资料，需要重新整理题目结构。'),{filename:'需要修改.txt'});
  assert.equal(failed.status,422);
  const retained=(await withToken(request(app).get('/api/data'),owner.token)).body.find(row=>row.name==='需要修改.txt');
  assert.ok(retained);assert.equal(retained.status,'解析失败');
  const grant=await withToken(request(app).post(`/api/data/${retained.id}/download`),owner.token);assert.equal(grant.status,200);
  assert.equal((await request(app).get(grant.body.url)).text,'没有题号或答案的原始资料，需要重新整理题目结构。');
});
test('词汇练习不固定八题，按可用词汇随机抽取自定义题量',async()=>{
  const owner=await account('larger-practice');
  const entries=Array.from({length:35},(_,i)=>({en:`term${i}`,zh:`释义${i}`,track:'ielts'}));
  await withToken(request(app).post('/api/vocabulary/import'),owner.token).send({entries});
  const options=await withToken(request(app).get('/api/vocabulary/practice-options?track=ielts'),owner.token);assert.equal(options.body.available,35);
  const practice=await withToken(request(app).post('/api/vocabulary/practice'),owner.token).send({track:'ielts',direction:'en-zh',mode:'choice',count:30});assert.equal(practice.status,201);assert.equal(practice.body.questionCount,30);
  assert.equal((await withToken(request(app).post('/api/vocabulary/practice'),owner.token).send({track:'ielts',count:36})).status,400);
});
test('已有短密码仍可登录，新建与重设拒绝短密码',async()=>{
  const user=await account('legacy-short'),candidate=store.getCandidateById(user.id);
  candidate.passwordHash=crypto.scryptSync('旧',candidate.salt,32).toString('hex');await store.flush();
  assert.equal((await login(user.name,'旧')).status,200);
  assert.equal(store.resetCandidatePassword(user.id,'1'),false);
});
async function account(label) {
  const name = `${label}-${crypto.randomUUID().slice(0, 8)}`, password = 'private-test-password';
  const result = store.createCandidate(name, password); assert.equal(result.ok, true);
  const session = await login(name, password); assert.equal(session.status, 200, JSON.stringify(session.body));
  return { id: result.candidate.id, name, password, token: session.body.token };
}
async function bank(owner, questions = [{ type: 'boolean', question: '这是判断题。', answer: true }], extra = {}) {
  const result = await withToken(request(app).post('/api/import/confirm'), owner.token).send({ title: '自定义题库', questions, ...extra });
  assert.equal(result.status, 201, JSON.stringify(result.body)); return result.body;
}
async function exam(owner, bankId, counts = { boolean: 1 }) {
  return withToken(request(app).post(`/api/banks/${bankId}/random-exam`), owner.token).send(counts);
}

test('模块内学习记录、错题筛选和错题练习方向一致，账号彼此隔离',async()=>{
  const owner=await account('scope'),other=await account('scope-other'),ids={};
  for(const track of ['general','postgraduate','ielts']){
    const created=await bank(owner,[{type:'boolean',question:track+' 独有错题',answer:true}],{track,module:track==='general'?'general':'reading'});ids[track]=created.id;
    const paper=await exam(owner,created.id);assert.equal(paper.status,201);
    const submitted=await withToken(request(app).post('/api/exams/'+paper.body.id+'/submit'),owner.token).send({answers:{0:false}});assert.equal(submitted.status,200);
  }
  for(const track of Object.keys(ids)){
    const attempts=await withToken(request(app).get('/api/attempts?track='+track),owner.token);assert.equal(attempts.body.length,1);assert.equal(attempts.body[0].track,track);
    const wrong=await withToken(request(app).get('/api/wrong-questions?track='+track+'&bankId='+ids[track]),owner.token);assert.equal(wrong.body.length,1);assert.equal(wrong.body[0].question,track+' 独有错题');
    const practiced=await withToken(request(app).post('/api/wrong-exam'),owner.token).send({track,module:track==='general'?'general':'reading',bankId:ids[track]});assert.equal(practiced.status,201);assert.equal(store.getExam(practiced.body.id).track,track);
  }
  assert.equal((await withToken(request(app).get('/api/wrong-questions?track=postgraduate'),other.token)).body.length,0);
  assert.equal((await withToken(request(app).get('/api/wrong-questions?track=ielts&bankId='+ids.general),owner.token)).body.length,0);
});

test('航班命名草稿持久保存、保留多版本、账号隔离和并发覆盖保护',async()=>{
  const owner=await account('flight-draft'),other=await account('flight-draft-other'),id=crypto.randomUUID(),second=crypto.randomUUID();
  const data={sourceName:'season.pdf',start:'2026-10-25',flights:[{id:'0'}]},draft={title:'人工航班表',data,pairs:[],excluded:[],reviewed:[],revision:0,mode:'season'};
  const saved=await withToken(request(app).put('/api/flights/drafts/'+id),owner.token).send(draft);assert.equal(saved.status,200);assert.equal(saved.body.revision,1);
  assert.equal((await withToken(request(app).put('/api/flights/drafts/'+id),owner.token).send(draft)).status,409);
  assert.equal((await withToken(request(app).get('/api/flights/drafts/'+id),other.token)).status,404);
  assert.equal((await withToken(request(app).get('/api/flights/drafts/'+id),owner.token)).body.title,'人工航班表');
  assert.equal((await withToken(request(app).put('/api/flights/drafts/'+second),owner.token).send({...draft,title:'新版本'})).status,200);
  assert.equal((await withToken(request(app).get('/api/flights/drafts'),owner.token)).body.length,2);
  const races=await Promise.all([1,2].map(n=>withToken(request(app).put('/api/flights/drafts/'+id),owner.token).send({...draft,title:'窗口'+n,revision:1})));
  assert.deepEqual(races.map(r=>r.status).sort(),[200,409]);assert.equal((await withToken(request(app).get('/api/flights/drafts/'+id),owner.token)).body.revision,2);
});
after(async () => { await store.flush(); await dataFiles.flush(); fs.rmSync(temporary, { recursive: true, force: true }); });

test('本次错题重练隔离账号、复用未完成试卷并保留删除后的材料快照', async () => {
  const a = await account('retry-a'), b = await account('retry-b');
  const created = await bank(a, [
    { type:'boolean', question:'第一题', answer:true, groupId:'reading', materialText:'保留阅读材料', materialTitle:'材料' },
    { type:'boolean', question:'第二题', answer:false, groupId:'reading' }
  ]);
  const paper = await exam(a, created.id, {boolean:2});
  const internal = store.getExam(paper.body.id);
  const answers = Object.fromEntries(internal.questions.map((q,i)=>[i, q.question==='第一题' ? q.answer : !q.answer]));
  const submission = await withToken(request(app).post(`/api/exams/${paper.body.id}/submit`), a.token).send({answers});
  const id = submission.body.attemptId;
  assert.equal((await withToken(request(app).post(`/api/attempts/${id}/retry`), b.token).send({})).status,404);
  await withToken(request(app).delete(`/api/banks/${created.id}`), a.token);
  const retry = await withToken(request(app).post(`/api/attempts/${id}/retry`), a.token).send({});
  assert.equal(retry.status,201,JSON.stringify(retry.body));
  const retryPaper = store.getExam(retry.body.id);
  assert.equal(retryPaper.questions.length,1);
  assert.equal(retryPaper.questions[0].question,'第二题');
  assert.equal(retryPaper.questions[0].materialText,'保留阅读材料');
  const duplicate = await withToken(request(app).post(`/api/attempts/${id}/retry`), a.token).send({});
  assert.equal(duplicate.body.id,retry.body.id);
  assert.equal(duplicate.body.resumed,true);
  const done = await withToken(request(app).post(`/api/exams/${retry.body.id}/submit`), a.token).send({answers:{0:'false'}});
  const perfect = await withToken(request(app).post(`/api/attempts/${done.body.attemptId}/retry`), a.token).send({});
  assert.equal(perfect.status,400);
  assert.equal(store.getAttempt(id).results.filter(r=>r.score<r.maxPoints).length,1);
});

test('统一账号承接旧公共题库，保留其他账号数据并拒绝旧管理员会话', async () => {
  const session = await login('bootstrap-account', 'test-bootstrap-password');
  assert.equal(session.status, 200); assert.ok(session.body.token); assert.equal(Object.hasOwn(session.body, 'role'), false);
  const own = await withToken(request(app).get('/api/banks'), session.body.token);
  assert.ok(own.body.some(row => row.id === legacyId)); assert.ok(!own.body.some(row => row.id === privateId));
  const existing = await login('existing-account', 'existing-password'); assert.equal(existing.status, 200);
  assert.ok((await withToken(request(app).get('/api/banks'), existing.body.token)).body.some(row => row.id === privateId));
  assert.equal((await withToken(request(app).get('/api/banks'), oldAdminToken)).status, 401);
  assert.equal((await request(app).get('/api/admin/quizzes').set('x-admin-password', 'test-bootstrap-password')).status, 410);
  assert.equal((await withToken(request(app).delete(`/api/admin/candidates/${preserved.id}`), session.body.token)).status, 410);
  assert.equal((await login('unregistered', 'unregistered-password')).status, 401);
  assert.equal((await request(app).get('/api/banks')).status, 401);
  assert.equal((await request(app).get('/api/vocabulary?q=hello')).status, 401);
});

test('每个账号均可新建任意科目题库并编辑题目，所有读写按所有者隔离', async () => {
  const a = await account('owner-a'), b = await account('owner-b');
  const created = await withToken(request(app).post('/api/banks'), a.token).send({ title: '系统集成项目管理师', category: '软考 · 系统集成', track: 'general', ownerId: b.id });
  assert.equal(created.status, 201); const id = created.body.id;
  assert.equal(created.body.questionCount, 0); assert.equal(store.getOwnedQuiz(id, a.id).ownerId, a.id);
  assert.equal((await withToken(request(app).post(`/api/banks/${id}/questions`), a.token).send({ type: 'choice', question: '哪项属于范围管理？', options: ['定义范围', '筹措资金'], answer: 0 })).status, 201);
  const updated = await withToken(request(app).patch(`/api/banks/${id}`), a.token).send({ title: '项目管理题库', category: '职业资格' }); assert.equal(updated.status, 200);
  const listed = await withToken(request(app).get('/api/banks?category=职业资格'), a.token); assert.ok(listed.body.some(row => row.id === id && row.title === '项目管理题库'));
  for (const [method, url, body] of [
    ['get', `/api/banks/${id}`, null], ['get', `/api/banks/${id}/questions`, null], ['patch', `/api/banks/${id}`, { title: '越权' }],
    ['post', `/api/banks/${id}/questions`, { type: 'boolean', question: '越权', answer: true }], ['put', `/api/banks/${id}/questions/0`, { answer: 1 }],
    ['delete', `/api/banks/${id}/questions/0`, null], ['delete', `/api/banks/${id}`, null], ['get', `/api/banks/${id}/export?answers=1`, null], ['post', `/api/banks/${id}/random-exam`, { choice: 1 }]
  ]) {
    const call = withToken(request(app)[method](url), b.token); const result = body ? await call.send(body) : await call; assert.equal(result.status, 404, `${method} ${url}`);
  }
  assert.equal((await withToken(request(app).put(`/api/banks/${id}/questions/0`), a.token).send({ answer: 1 })).status, 200);
  assert.equal((await withToken(request(app).get(`/api/banks/${id}/questions`), a.token)).body.questions[0].answer, 1);
  assert.equal((await withToken(request(app).delete(`/api/banks/${id}/questions/0`), a.token)).status, 200);
  assert.equal((await withToken(request(app).delete(`/api/banks/${id}`), a.token)).status, 200);
});

test('文档预览保留待修复题，确认时拒绝空答案和残缺选项', async () => {
  const owner = await account('import');
  const preview = await withToken(request(app).post('/api/import/preview'), owner.token).field('category', '酿酒技能').attach('file', fixture);
  assert.equal(preview.status, 200, JSON.stringify(preview.body)); assert.ok(preview.body.questions.length); assert.ok(Array.isArray(preview.body.incomplete));
  const created = await withToken(request(app).post('/api/import/confirm'), owner.token).send({ ...preview.body, title: '技能题库' }); assert.equal(created.status, 201);
  assert.equal(store.getOwnedQuiz(created.body.id, owner.id).category, '酿酒技能');
  for (const question of [
    { type: 'choice', question: '残缺题', options: ['甲'], answer: 0 },
    { type: 'choice', question: '没有答案', options: ['甲', '乙'], answer: null },
    { type: 'choice', question: '空答案', options: ['甲', '乙'], answer: '' },
    { type: 'choice', question: '中间选项缺失', options: ['甲', '', '丙'], answer: 2 },
    { type: 'fill', question: '两空', blanks: [{ answers: ['a'] }, { answers: [] }] },
    { type: 'short', question: '简答', answer: '' }
  ]) {
    const result = await withToken(request(app).post('/api/import/confirm'), owner.token).send({ title: '待修复', questions: [question] });
    assert.equal(result.status, 400); assert.equal(result.body.invalid[0].index, 0); assert.ok(result.body.invalid[0].reason);
  }
  assert.equal((await withToken(request(app).post('/api/import/confirm'), owner.token).send({ title: '未知方向', track: 'thai', questions: preview.body.questions })).status, 400);
  assert.equal(fs.readdirSync(process.env.UPLOAD_DIR).length, 0);
});

test('随机练习按题型数量抽取、题组保留材料、未完成试卷可恢复', async () => {
  const owner = await account('random');
  const questions = [
    { type: 'choice', question: 'Main idea?', options: ['a', 'b'], answer: 0, groupId: 'reading', materialTitle: 'Passage', materialText: 'A small library opened on Monday.' },
    { type: 'choice', question: 'Which detail?', options: ['a', 'b'], answer: 1, groupId: 'reading' },
    { type: 'fill', question: 'The library opened on ____.', blanks: [{ answers: ['Monday'] }], language: 'en', groupId: 'reading' },
    ...Array.from({ length: 10 }, (_, i) => ({ type: 'boolean', question: `判断题${i}`, answer: i % 2 === 0 }))
  ];
  const created = await bank(owner, questions, { track: 'ielts', category: '阅读' });
  assert.equal((await exam(owner, created.id, { choice: 3 })).status, 400);
  const first = await exam(owner, created.id, { choice: 1, fill: 1, boolean: 3 }); assert.equal(first.status, 201);
  const paper = await withToken(request(app).get(`/api/exams/${first.body.id}`), owner.token);
  assert.equal(paper.body.questions.filter(q => q.type === 'choice').length, 1); assert.equal(paper.body.questions.filter(q => q.type === 'fill').length, 1); assert.equal(paper.body.questions.filter(q => q.type === 'boolean').length, 3);
  for (const q of paper.body.questions.filter(q => q.groupId)) assert.equal(q.materialText, questions[0].materialText);
  assert.equal(new Set(paper.body.questions.map(q => q.question)).size, 5);
  assert.equal(Math.round(paper.body.questions.reduce((sum, q) => sum + q.points, 0) * 100), 10000);
  const resumed = await exam(owner, created.id, { boolean: 1 }); assert.equal(resumed.status, 200); assert.equal(resumed.body.id, first.body.id); assert.equal(resumed.body.resumed, true);
  await withToken(request(app).post(`/api/exams/${first.body.id}/submit`), owner.token).send({ answers: {} });
  const next = await exam(owner, created.id, { choice: 1, fill: 1, boolean: 3 }); assert.equal(next.status, 201); assert.notEqual(next.body.id, first.body.id);
});

test('保存答题草稿、成绩与导出均仅本人可读，删除题库后保留历史快照', async () => {
  const owner = await account('history'), other = await account('history-other');
  const created = await bank(owner), generated = await exam(owner, created.id), id = generated.body.id;
  assert.equal((await withToken(request(app).put(`/api/exams/${id}/progress`), owner.token).send({ answers: { 0: true } })).status, 200);
  assert.deepEqual((await withToken(request(app).get(`/api/exams/${id}`), owner.token)).body.draftAnswers, { 0: true });
  assert.equal((await withToken(request(app).get(`/api/exams/${id}`), other.token)).status, 404);
  assert.equal((await withToken(request(app).put(`/api/exams/${id}/progress`), other.token).send({ answers: {} })).status, 404);
  await withToken(request(app).delete(`/api/banks/${created.id}`), owner.token);
  const submitted = await withToken(request(app).post(`/api/exams/${id}/submit`), owner.token).send({}); assert.equal(submitted.status, 200); assert.equal(submitted.body.score, 100);
  const attemptId = submitted.body.attemptId, attempt = await withToken(request(app).get(`/api/attempts/${attemptId}`), owner.token);
  assert.equal(attempt.body.examId, id); assert.equal(attempt.body.questions[0].question, '这是判断题。'); assert.notEqual(attempt.body.title, '已删除题库');
  assert.equal((await withToken(request(app).post(`/api/exams/${id}/submit`), owner.token).send({})).status, 409);
  assert.equal((await withToken(request(app).delete(`/api/exams/${id}`), owner.token)).status, 409);
  for (const url of [`/api/attempts/${attemptId}`, `/api/attempts/${attemptId}/export`, `/api/exams/${id}/export`]) assert.equal((await withToken(request(app).get(url), other.token)).status, 404);
  const doc = await withToken(request(app).get(`/api/attempts/${attemptId}/export?wrongOnly=1`), owner.token); assert.equal(doc.status, 200); assert.match(doc.headers['content-type'], /wordprocessingml/); assert.ok(Number(doc.headers['content-length']) > 1000);
});

test('考试界面不泄露答案、解析或填空备选答案，空答不能当作选项A', async () => {
  const owner = await account('answer-safe');
  const created = await bank(owner, [
    { type: 'choice', question: '选A', options: ['A', 'B'], answer: 0, explanation: 'answer-secret' },
    { type: 'fill', question: '写单词', blanks: [{ answers: ['secret-word'] }], explanation: 'fill-secret', rubric: 'rubric-secret' }
  ]);
  const generated = await exam(owner, created.id, { choice: 1, fill: 1 }), paper = await withToken(request(app).get(`/api/exams/${generated.body.id}`), owner.token);
  const serialized = JSON.stringify(paper.body); assert.ok(!serialized.includes('secret-word')); assert.ok(!serialized.includes('answer-secret')); assert.ok(!serialized.includes('rubric-secret'));
  for (const q of paper.body.questions) assert.equal(Object.hasOwn(q, 'answer'), false);
  const answers = Object.fromEntries(paper.body.questions.map((q, index) => [index, q.type === 'choice' ? null : ['']]));
  const submitted = await withToken(request(app).post(`/api/exams/${generated.body.id}/submit`), owner.token).send({ answers }); assert.equal(submitted.body.score, 0);
});

test('填空按预设答案逐空判分，英文词间空格保留，满分总分精确为100', async () => {
  const owner = await account('fill');
  const created = await bank(owner, [
    { type: 'fill', question: '菌种与温度', blanks: [{ answers: ['酵母菌', '酵母'] }, { answers: ['28-32'] }] },
    { type: 'fill', question: '拼写短语', language: 'en', blanks: [{ answers: ['ice cream'] }] },
    { type: 'fill', question: '英语大小写', language: 'en', blanks: [{ answers: ['Monday'] }] }
  ]);
  const generated = await exam(owner, created.id, { fill: 3 }), paper = await withToken(request(app).get(`/api/exams/${generated.body.id}`), owner.token);
  const answers = Object.fromEntries(paper.body.questions.map((q, i) => [i, q.question === '菌种与温度' ? ['酵 母', '28至32'] : q.question === '拼写短语' ? ['icecream'] : ['MONDAY']]));
  const submitted = await withToken(request(app).post(`/api/exams/${generated.body.id}/submit`), owner.token).send({ answers }); assert.equal(submitted.body.maxScore, 100);
  assert.equal(submitted.body.results[paper.body.questions.findIndex(q => q.question === '拼写短语')].score, 0); assert.ok(submitted.body.score > 66 && submitted.body.score < 67);
  const wrong = await withToken(request(app).get('/api/wrong-questions'), owner.token); assert.equal(wrong.body.length, 1);
  const practice = await withToken(request(app).post('/api/wrong-exam'), owner.token).send({ count: 1 }); assert.equal(practice.status, 201);
  const wrongPaper = store.getExamForCandidate(practice.body.id, owner.id); assert.equal(wrongPaper.questions[0].language, 'en');
});

test('个人词汇和词本隔离，共享基础词仅可查询练习', async () => {
  const owner = await account('words'), other = await account('words-other');
  const shared = store.addVocabulary([{ zh: '公共词汇', en: 'shared word', track: 'english' }]).added[0];
  const imported = await withToken(request(app).post('/api/vocabulary/import'), owner.token).send({ entries: [{ zh: '私有甲', en: 'private alpha', track: 'english' }, { zh: '私有乙', en: 'private beta', track: 'english' }] }); assert.equal(imported.status, 201); assert.equal(imported.body.added, 2);
  const own = await withToken(request(app).get('/api/vocabulary?q=private&language=en'), owner.token), others = await withToken(request(app).get('/api/vocabulary?q=private&language=en'), other.token); assert.equal(own.body.length, 2); assert.equal(others.body.length, 0);
  const word = own.body[0]; assert.equal(word.ownerId, owner.id);
  assert.equal((await withToken(request(app).put(`/api/vocabulary/${shared.id}`), owner.token).send({ zh: '改词' })).status, 404);
  assert.equal((await withToken(request(app).delete(`/api/vocabulary/${word.id}`), other.token)).status, 404);
  const a = await withToken(request(app).post('/api/collections'), owner.token).send({ name: '我的词本', track: 'english' });
  const b = await withToken(request(app).post('/api/collections'), other.token).send({ name: '其他词本', track: 'english' });
  assert.equal((await withToken(request(app).post(`/api/collections/${b.body.id}/words`), other.token).send({ wordId: word.id })).status, 404);
  for (const w of own.body) assert.equal((await withToken(request(app).post(`/api/collections/${a.body.id}/words`), owner.token).send({ wordId: w.id })).status, 201);
  const practice = await withToken(request(app).post(`/api/collections/${a.body.id}/practice`), owner.token).send({ direction: 'en-zh', mode: 'choice', count: 2 }); assert.equal(practice.status, 201);
  assert.equal((await withToken(request(app).get(`/api/collections/${a.body.id}/words`), other.token)).status, 404);
  assert.equal((await withToken(request(app).post('/api/vocabulary/import'), owner.token).send({ entries: [{ zh: '旧词', en: 'old', th: 'retired' }] })).status, 400);
  assert.equal((await withToken(request(app).get('/api/vocabulary?language=fr'), owner.token)).status, 400);
});

test('本地查词和翻译使用本人可见词库，翻译历史不跨账号', async () => {
  const owner = await account('translation'), other = await account('translation-other');
  await withToken(request(app).post('/api/vocabulary/import'), owner.token).send({ entries: [{ zh: '专属服务器', en: 'private server', track: 'english' }] });
  const translated = await withToken(request(app).post('/api/translate'), owner.token).send({ text: '专属服务器', source: 'zh', targets: ['en'] }); assert.equal(translated.status, 200); assert.equal(translated.body.translations.en, 'private server'); assert.equal(translated.body.provider, 'local');
  const invisible = await withToken(request(app).post('/api/translate'), other.token).send({ text: '专属服务器', source: 'zh', targets: ['en'] }); assert.equal(invisible.status, 503);
  assert.equal((await withToken(request(app).get('/api/translations'), other.token)).body.length, 0);
});

test('IELTS写作口语保存为自主复盘记录，不虚构评分', async () => {
  const owner = await account('journal'), other = await account('journal-other');
  const created = await withToken(request(app).post('/api/study/journal'), owner.token).send({ track: 'ielts', module: 'writing', prompt: 'Discuss public transport.', response: 'My draft essay.', notes: 'Improve examples.' });
  assert.equal(created.status, 201); assert.equal(Object.hasOwn(created.body, 'score'), false);
  assert.ok((await withToken(request(app).get('/api/study/journal'), owner.token)).body.some(row => row.id === created.body.id));
  assert.equal((await withToken(request(app).get('/api/study/journal'), other.token)).body.length, 0);
  assert.equal((await withToken(request(app).delete(`/api/study/journal/${created.body.id}`), other.token)).status, 404);
  assert.equal((await withToken(request(app).delete(`/api/study/journal/${created.body.id}`), owner.token)).status, 200);
});

test('初始学习题库按账号生成一次，删除后再次登录不会复活', async () => {
  const owner = await account('starter');
  const initial = await withToken(request(app).get('/api/banks'), owner.token); assert.ok(initial.body.length >= 4);
  const id = initial.body[0].id; await withToken(request(app).delete(`/api/banks/${id}`), owner.token);
  const relogin = await login(owner.name, owner.password); assert.equal(relogin.status, 200);
  const afterLogin = await withToken(request(app).get('/api/banks'), relogin.body.token); assert.equal(afterLogin.body.length, initial.body.length - 1); assert.ok(!afterLogin.body.some(row => row.id === id));
});

test('账号可修改自己的密码，旧密码和旧会话同时失效', async () => {
  const owner = await account('password');
  assert.equal((await withToken(request(app).post('/api/account/password'), owner.token).send({ currentPassword: 'wrong', newPassword: 'new-private-password' })).status, 400);
  const changed = await withToken(request(app).post('/api/account/password'), owner.token).send({ currentPassword: owner.password, newPassword: 'new-private-password' }); assert.equal(changed.status, 200); assert.ok(changed.body.token);
  assert.equal((await withToken(request(app).get('/api/account/me'), owner.token)).status, 401);
  assert.equal((await login(owner.name, owner.password)).status, 401); assert.equal((await login(owner.name, 'new-private-password')).status, 200);
  const me = await withToken(request(app).get('/api/account/me'), changed.body.token); assert.equal(me.status, 200); assert.equal(me.body.id, owner.id);
  await withToken(request(app).post('/api/account/logout'), changed.body.token);
  assert.equal((await withToken(request(app).get('/api/account/me'), changed.body.token)).status, 401);
});

test('新密码至少六位，允许长密码，不要求字符组合', async () => {
  const name = `pwd-${crypto.randomUUID().slice(0,20)}`;
  assert.equal(store.createCandidate(`${name}-empty`, '').ok, false);
  assert.equal(store.createCandidate(name, '短').ok, false);
  const created = store.createCandidate(name, '123456');
  assert.equal(created.ok, true);
  let session = await login(name, '123456');
  assert.equal(session.status, 200);
  assert.equal(store.resetCandidatePassword(created.candidate.id, ''), false);
  assert.equal((await withToken(request(app).post('/api/account/password'), session.body.token).send({currentPassword:'123456',newPassword:'12345'})).status, 400);
  for (const [currentPassword, newPassword] of [['123456', 'x'.repeat(256)], ['x'.repeat(256), '654321']]) {
    const changed = await withToken(request(app).post('/api/account/password'), session.body.token).send({currentPassword,newPassword});
    assert.equal(changed.status, 200);
    assert.equal((await login(name, currentPassword)).status, 401);
    assert.equal((await withToken(request(app).get('/api/account/me'), session.body.token)).status, 401);
    session = await login(name, newPassword);
    assert.equal(session.status, 200);
  }
  const longName = `${name}-long`;
  assert.equal(store.createCandidate(longName, '长'.repeat(256)).ok, true);
  assert.equal((await login(longName, '长'.repeat(256))).status, 200);
});

test('移除停用设置表单，登录表单仍兼容旧短密码', () => {
  const script = fs.readFileSync(path.resolve('public/workspace.js'), 'utf8');
  const inputs = [...script.matchAll(/<input\b[^>]*type="password"[^>]*>/g)].map(match => match[0]);
  assert.equal(inputs.length, 1);
  assert.doesNotMatch(script, /async function settings\(/);
  for (const input of inputs) {
    if(input.includes('new-password'))assert.match(input,/minlength="6"/);
    else assert.doesNotMatch(input,/minlength=/);
    assert.match(input, /required/);
  }
  assert.doesNotMatch(script, /请使用至少 8 位密码/);
});

test('数字小数点参与判分，未标语言的英文短语保留词间空格', async () => {
  const owner = await account('precision');
  const created = await bank(owner, [
    { type: 'fill', question: '浓度是多少？', blanks: [{ answers: ['1.5'] }] },
    { type: 'short', question: 'Write the phrase.', answer: 'ice cream' }
  ]);
  const generated = await exam(owner, created.id, { fill: 1, short: 1 });
  const paper = await withToken(request(app).get(`/api/exams/${generated.body.id}`), owner.token);
  const answers = Object.fromEntries(paper.body.questions.map((q, i) => [i, q.type === 'fill' ? ['15'] : 'icecream']));
  const result = await withToken(request(app).post(`/api/exams/${generated.body.id}/submit`), owner.token).send({ answers });
  assert.equal(result.status, 200); assert.equal(result.body.score, 0);
});

test('单词练习期间删除源词条后仍能提交，且不会写入孤立学习进度', async () => {
  const owner = await account('deleted-word');
  await withToken(request(app).post('/api/vocabulary/import'), owner.token).send({ entries: [{ zh: '删除快照', en: 'snapshot term', track: 'english', chapter: 'snapshot-chapter' }] });
  const word = (await withToken(request(app).get('/api/vocabulary?q=snapshot%20term&language=en'), owner.token)).body[0];
  const generated = await withToken(request(app).post('/api/vocabulary/practice'), owner.token).send({ track: 'english', chapter: 'snapshot-chapter', mode: 'spell', direction: 'zh-en', count: 1 });
  assert.equal(generated.status, 201);
  await withToken(request(app).delete(`/api/vocabulary/${word.id}`), owner.token);
  const result = await withToken(request(app).post(`/api/exams/${generated.body.id}/submit`), owner.token).send({ answers: { 0: ['snapshot term'] } });
  assert.equal(result.status, 200); assert.equal(result.body.score, 100);
  assert.ok(!store.wordProgress(owner.id).some(row => row.wordId === word.id));
});

test('词义选择题不会把同一释义的同义词互作干扰项', async () => {
  const owner = await account('synonym');
  await withToken(request(app).post('/api/vocabulary/import'), owner.token).send({ entries: [
    { zh: '选择', en: 'choose', acceptedEn: ['select'], track: 'english', chapter: 'synonym-only' },
    { zh: '选择', en: 'select', track: 'english', chapter: 'synonym-only' }
  ] });
  const blocked = await withToken(request(app).post('/api/vocabulary/practice'), owner.token).send({ track: 'english', chapter: 'synonym-only', mode: 'choice', direction: 'zh-en', count: 2 });
  assert.equal(blocked.status, 400); assert.match(blocked.body.error, /拼写/);
  const spelling = await withToken(request(app).post('/api/vocabulary/practice'), owner.token).send({ track: 'english', chapter: 'synonym-only', mode: 'spell', direction: 'zh-en', count: 2 });
  assert.equal(spelling.status, 201);
});
