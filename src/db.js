import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRelationalStorage } from './db/relational.js';

const dataDir = path.resolve(process.env.DATA_DIR || 'data');
const file = path.join(dataDir, 'quizforge.json');
fs.mkdirSync(dataDir, { recursive: true });
let state = { quizzes: [], exams: [], attempts: [], candidates: [], sessions: [], vocabulary: [], collections: [], collectionItems: [], wordProgress: [], translationHistory: [], studyJournal: [], corpus: [] };
let relational = null;
let persistQueue = Promise.resolve();
const mysqlEnabled = Boolean(process.env.DB_HOST && process.env.DB_NAME && process.env.DB_USER);
if (mysqlEnabled) {
  relational = await createRelationalStorage(process.env);
  state = await relational.load();
} else if (fs.existsSync(file)) state = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const key of ['quizzes','exams','attempts','candidates','sessions','vocabulary','collections','collectionItems','wordProgress','translationHistory','studyJournal','corpus']) state[key] ||= [];

function persist() {
  if (relational) {
    const snapshot = structuredClone(state);
    persistQueue = persistQueue.then(() => relational.persist(snapshot));
    persistQueue.catch(error => { console.error('MySQL persistence failed:', error); process.exitCode = 1; });
  } else {
    const payload = JSON.stringify(state);
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, payload, 'utf8');
    fs.renameSync(temp, file);
  }
}

// 首次启动 v5 时把旧 app_state 拆入关系型表；旧表仍保留用于回滚核对。
if (relational?.migrationPending) persist();

function passwordDigest(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

function safeEqualHex(a, b) {
  const left = Buffer.from(a || '', 'hex'), right = Buffer.from(b || '', 'hex');
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function attemptTitle(a) {
  return (a.examId ? state.exams.find(e => e.id === a.examId)?.title : null) || state.quizzes.find(q => q.id === a.quizId)?.title || '已删除题库';
}

function attemptsForCandidate(candidateId) {
  return state.attempts.filter(a => a.candidateId === candidateId);
}

export const store = {
  listCorpus: ownerId => state.corpus.filter(row=>row.ownerId===ownerId).slice().sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),
  getCorpus: (id,ownerId) => state.corpus.find(row=>row.id===id&&row.ownerId===ownerId)||null,
  addCorpus: (ownerId,body) => {const now=new Date().toISOString(),row={...body,id:crypto.randomUUID(),ownerId,createdAt:now,updatedAt:now};state.corpus.push(row);persist();return row;},
  updateCorpus: (id,ownerId,body) => {const row=store.getCorpus(id,ownerId);if(!row)return null;Object.assign(row,body,{updatedAt:new Date(Math.max(Date.now(),Date.parse(row.updatedAt)+1)).toISOString()});persist();return row;},
  deleteCorpus: (id,ownerId) => {const index=state.corpus.findIndex(row=>row.id===id&&row.ownerId===ownerId);if(index<0)return false;state.corpus.splice(index,1);persist();return true;},
  ensureBootstrapAccount: (name,password) => {
    const key=String(name||'').trim().slice(0,60).toLowerCase();
    const candidate=state.candidates.find(row=>row.nameKey===key);
    if(candidate)return {ok:true,candidate,created:false};
    return store.createCandidate(name,password);
  },
  claimLegacyBanks: ownerId => {
    const owner=store.getCandidateById(ownerId);if(!owner)return 0;
    let count=0;
    for(const bank of state.quizzes)if(!bank.ownerId&&!isLegacyRemovedTrack(bank.track)){bank.ownerId=ownerId;bank.ownerName=owner.displayName||owner.name;bank.visibility='private';count++;}
    if(count)persist();return count;
  },
  ensureStarterBanks: (candidateId,banks) => {
    const candidate=store.getCandidateById(candidateId);if(!candidate||candidate.starterInitialized)return 0;
    for(const source of banks){const bank=structuredClone(source);delete bank.seedKey;bank.id=crypto.randomUUID();bank.ownerId=candidateId;bank.ownerName=candidate.displayName||candidate.name;bank.visibility='private';bank.status='published';bank.createdAt=new Date().toISOString();bank.questions=(bank.questions||[]).map(q=>({...q,id:crypto.randomUUID(),reviewStatus:'approved'}));state.quizzes.push(bank);}
    candidate.starterInitialized=true;persist();return banks.length;
  },
  listStudyJournal: candidateId => state.studyJournal.filter(row=>row.candidateId===candidateId).slice().reverse(),
  addStudyJournal: row => {const entry={...row,id:crypto.randomUUID(),createdAt:new Date().toISOString()};state.studyJournal.push(entry);persist();return entry;},
  deleteStudyJournal: (id,candidateId) => {const index=state.studyJournal.findIndex(row=>row.id===id&&row.candidateId===candidateId);if(index<0)return false;state.studyJournal.splice(index,1);persist();return true;},
  getOwnedQuiz: (id,ownerId) => state.quizzes.find(row=>row.id===id&&row.ownerId===ownerId&&!isLegacyRemovedTrack(row.track))||null,
  listOwnedQuizzes: (ownerId,filters={}) => store.listQuizzes({...filters,candidateId:ownerId,includePrivateAll:true}).filter(row=>row.ownerId===ownerId&&(!filters.category||row.category===filters.category)),
  listQuizzes: filters => state.quizzes.filter(x => !isLegacyRemovedTrack(x.track) && (x.status === 'published'||filters?.includePrivateAll) && (x.visibility!=='private'||x.ownerId===filters?.candidateId||filters?.includePrivateAll) && (!filters?.track || normalizeTrack(x.track)===filters.track) && (!filters?.module || x.module===filters.module)).map(({ sourceText, questions, ...x }) => ({ ...x, track:normalizeTrack(x.track), module:x.module||'general', difficulty:x.difficulty||'mixed', typeCounts:countTypes(questions), groupCount:new Set(approvedQuestions(questions).map(q=>q.groupId).filter(Boolean)).size })).sort((a,b) => b.createdAt.localeCompare(a.createdAt)),
  getQuiz: (id,candidateId=null) => state.quizzes.find(x => x.id === id && !isLegacyRemovedTrack(x.track) && x.status === 'published' && (x.visibility!=='private'||x.ownerId===candidateId)),
  getQuizAdmin: id => state.quizzes.find(x => x.id === id && !isLegacyRemovedTrack(x.track)),
  addQuiz: quiz => { hydrateGroupMaterials(quiz.questions||[]);state.quizzes.push(quiz); persist(); },
  updateQuiz: (id, updates) => { const quiz = state.quizzes.find(x => x.id === id); if (!quiz) return false; if (updates.title !== undefined) quiz.title = String(updates.title).trim().slice(0, 200); for(const key of ['category','module','course','unit','year','difficulty'])if(updates[key]!==undefined)quiz[key]=String(updates[key]||'').trim().slice(0,100);if(updates.track!==undefined)quiz.track=normalizeTrack(updates.track);quiz.updatedAt=new Date().toISOString(); persist(); return true; },
  deleteQuiz: id => { const idx = state.quizzes.findIndex(x => x.id === id); if (idx < 0) return false; state.quizzes.splice(idx, 1); for(const exam of state.exams)if(exam.bankId===id)exam.bankId=null;for(const attempt of state.attempts)if(attempt.quizId===id)attempt.quizId=null;persist(); return true; },
  deleteQuizForOwner: (id,ownerId) => store.getOwnedQuiz(id,ownerId)?store.deleteQuiz(id):false,

  addQuestion: (quizId, question) => { const quiz = state.quizzes.find(x => x.id === quizId); if (!quiz) return false; if(question.groupId){const sibling=quiz.questions.find(q=>q.groupId===question.groupId&&q.materialText);if(!question.materialText&&sibling){question.materialText=sibling.materialText;question.materialTitle ||= sibling.materialTitle;}if(question.materialText)for(const q of quiz.questions.filter(q=>q.groupId===question.groupId)){q.materialText=question.materialText;q.materialTitle=question.materialTitle;}}quiz.questions.push(question); persist(); return true; },
  updateQuestion: (quizId, index, updates) => { const quiz = state.quizzes.find(x => x.id === quizId); if (!quiz || !Number.isInteger(index) || index < 0 || index >= quiz.questions.length) return false; quiz.questions[index] = { ...quiz.questions[index], ...updates };const changed=quiz.questions[index];if(changed.groupId){const sibling=quiz.questions.find((q,i)=>i!==index&&q.groupId===changed.groupId&&q.materialText);if(!changed.materialText&&sibling){changed.materialText=sibling.materialText;changed.materialTitle ||= sibling.materialTitle;}if(changed.materialText)for(const q of quiz.questions.filter(q=>q.groupId===changed.groupId)){q.materialText=changed.materialText;q.materialTitle=changed.materialTitle;}}persist(); return true; },
  deleteQuestion: (quizId, index) => { const quiz = state.quizzes.find(x => x.id === quizId); if (!quiz || !Number.isInteger(index) || index < 0 || index >= quiz.questions.length) return false; quiz.questions.splice(index, 1); persist(); return true; },

  authenticateCandidate: (name, password, create = false) => {
    const normalizedName = String(name || '').trim();
    const secret = String(password || '');
    if (!normalizedName || normalizedName.length > 60) return { ok:false, error:'账号须非空且最多60个字符' };
    if (!secret) return { ok:false, error:'请输入密码' };
    const key = normalizedName.toLowerCase();
    let candidate = state.candidates.find(c => c.nameKey === key);
    if (!candidate) {
      if (!create) return { ok:false, error:'账号或密码错误' };
      if (secret.length < 6) return { ok:false, error:'密码至少 6 位' };
      const salt = crypto.randomBytes(16).toString('hex');
      candidate = { id:crypto.randomUUID(), name:normalizedName, nameKey:key, status:'active', salt, passwordHash:passwordDigest(secret, salt), createdAt:new Date().toISOString() };
      state.candidates.push(candidate); persist();
      return { ok:true, candidate, created:true };
    }
    if (candidate.status === 'disabled') return { ok:false, error:'账号已被停用' };
    if (!safeEqualHex(passwordDigest(secret, candidate.salt), candidate.passwordHash)) return { ok:false, error:'账号或密码错误' };
    return { ok:true, candidate, created:false };
  },
  createCandidate: (name,password) => {const value=String(name||'').trim();if(!value||value.length>40)return {ok:false,error:'账号须非空且最多40个字符'};const key=value.toLowerCase();if(state.candidates.some(candidate=>candidate.nameKey===key))return {ok:false,error:'用户账号已存在'};return store.authenticateCandidate(name,password,true);},
  listCandidates: () => state.candidates.map(candidate=>({id:candidate.id,name:candidate.displayName||candidate.name,username:candidate.name,status:candidate.status||'active',createdAt:candidate.createdAt,attemptCount:state.attempts.filter(x=>x.candidateId===candidate.id).length,quizCount:state.quizzes.filter(x=>x.ownerId===candidate.id).length})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)),
  getCandidateById: id => state.candidates.find(candidate=>candidate.id===id)||null,
  setCandidateStatus: (id,status) => {const candidate=state.candidates.find(x=>x.id===id);if(!candidate||!['active','disabled'].includes(status))return false;candidate.status=status;if(status==='disabled')state.sessions=state.sessions.filter(x=>x.userId!==id);persist();return true;},
  resetCandidatePassword: (id,password) => {const candidate=state.candidates.find(x=>x.id===id),secret=String(password||'');if(!candidate||secret.length<6)return false;candidate.salt=crypto.randomBytes(16).toString('hex');candidate.passwordHash=passwordDigest(secret,candidate.salt);state.sessions=state.sessions.filter(x=>x.userId!==id);persist();return true;},
  deleteCandidate: (id,{actorUserId=null}={}) => {
    const candidate=state.candidates.find(x=>x.id===id);
    if(!candidate)return {ok:false,code:'not-found',error:'用户账号不存在'};
    if(candidate.role==='admin')return {ok:false,code:'protected',error:'管理员账号不能删除'};
    if(actorUserId&&actorUserId===id)return {ok:false,code:'self',error:'不能删除当前登录账号'};

    const privateBankIds=new Set(state.quizzes.filter(x=>x.ownerId===id&&x.visibility==='private').map(x=>x.id));
    const collectionIds=new Set(state.collections.filter(x=>x.candidateId===id).map(x=>x.id));
    const examIds=new Set(state.exams.filter(x=>x.candidateId===id||privateBankIds.has(x.bankId)).map(x=>x.id));
    const deleted={
      sessions:state.sessions.filter(x=>x.userId===id).length,
      privateQuizzes:privateBankIds.size,
      exams:examIds.size,
      attempts:state.attempts.filter(x=>x.candidateId===id||examIds.has(x.examId)||privateBankIds.has(x.quizId)).length,
      collections:collectionIds.size,
      wordProgress:state.wordProgress.filter(x=>x.candidateId===id).length,
      translations:state.translationHistory.filter(x=>x.candidateId===id).length
    };

    state.candidates=state.candidates.filter(x=>x.id!==id);
    state.sessions=state.sessions.filter(x=>x.userId!==id);
    state.quizzes=state.quizzes.filter(x=>!privateBankIds.has(x.id)).map(x=>x.ownerId===id?{...x,ownerId:null}:x);
    state.exams=state.exams.filter(x=>!examIds.has(x.id));
    state.attempts=state.attempts.filter(x=>x.candidateId!==id&&!examIds.has(x.examId)&&!privateBankIds.has(x.quizId));
    state.collections=state.collections.filter(x=>x.candidateId!==id);
    state.collectionItems=state.collectionItems.filter(x=>!collectionIds.has(x.collectionId));
    state.wordProgress=state.wordProgress.filter(x=>x.candidateId!==id);
    state.translationHistory=state.translationHistory.filter(x=>x.candidateId!==id);
    persist();
    return {ok:true,candidate:{id:candidate.id,name:candidate.name},deleted};
  },
  createSession: ({role,userId=null,name,hours=12,rawToken=null}) => {const token=rawToken||crypto.randomBytes(32).toString('base64url'),record={id:crypto.randomUUID(),tokenHash:crypto.createHash('sha256').update(token).digest('hex'),userId,role,name,expiresAt:new Date(Date.now()+Number(hours)*3600000).toISOString(),createdAt:new Date().toISOString()};state.sessions=state.sessions.filter(x=>new Date(x.expiresAt)>new Date());state.sessions.push(record);persist();return token;},
  getSession: token => {const hash=crypto.createHash('sha256').update(String(token||'')).digest('hex'),session=state.sessions.find(x=>x.tokenHash===hash&&!x.revokedAt&&new Date(x.expiresAt)>new Date());if(!session)return null;if(session.userId&&state.candidates.find(x=>x.id===session.userId)?.status==='disabled')return null;return session;},
  revokeSession: token => {const hash=crypto.createHash('sha256').update(String(token||'')).digest('hex'),session=state.sessions.find(x=>x.tokenHash===hash);if(!session)return false;state.sessions=state.sessions.filter(x=>x.id!==session.id);persist();return true;},
  addExam: exam => { state.exams.push(exam); persist(); },
  getExam: id => state.exams.find(x => x.id === id),
  getExamForCandidate: (id, candidateId) => state.exams.find(x => x.id === id && x.candidateId === candidateId),
  saveExamProgress: (id,candidateId,answers) => {const exam=store.getExamForCandidate(id,candidateId);if(!exam||exam.completedAt)return false;exam.draftAnswers=structuredClone(answers);persist();return true;},
  findActiveExam: (bankId, candidateId) => state.exams.find(x => x.bankId === bankId && x.candidateId === candidateId && !x.completedAt),
  completeExam: id => { const exam = state.exams.find(x => x.id === id); if (exam) { exam.completedAt = new Date().toISOString(); persist(); } },
  listExams: () => state.exams.slice().reverse().map(e=>({ id:e.id,bankId:e.bankId,candidateName:e.candidateName,title:e.title,blueprint:e.blueprint,questionCount:e.questions.length,createdAt:e.createdAt,completedAt:e.completedAt||null })),
  listExamsForCandidate: candidateId => state.exams.filter(e=>e.candidateId===candidateId).slice().reverse().map(e=>({id:e.id,bankId:e.bankId,title:e.title,track:e.track,module:e.module,questionCount:e.questions.length,createdAt:e.createdAt,completedAt:e.completedAt||null})),
  deleteExam: id => { const index=state.exams.findIndex(e=>e.id===id); if(index<0)return false; if(state.exams[index].completedAt)return false; state.exams.splice(index,1);persist();return true; },

  addAttempt: attempt => { state.attempts.push(attempt); persist(); },
  getAttempt: id => { const a = state.attempts.find(x => x.id === id); return a ? { ...a, title:attemptTitle(a) } : null; },
  getAttemptForCandidate: (id, candidateId) => { const a = state.attempts.find(x => x.id === id && x.candidateId === candidateId); return a ? { ...a, title:attemptTitle(a) } : null; },
  deleteAttempt: id => { const idx = state.attempts.findIndex(x => x.id === id); if (idx < 0) return false; state.attempts.splice(idx, 1); persist(); return true; },
  listAttempts: () => state.attempts.slice(-500).reverse().map(a => ({ ...a, title:attemptTitle(a) })),
  findAttemptsByCandidate: candidateId => attemptsForCandidate(candidateId).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).map(a => ({ id:a.id, quizId:a.quizId, examId:a.examId, track:a.track||'general', module:a.module||'general', candidateName:a.candidateName, score:a.score, maxScore:a.maxScore, percentage:a.maxScore ? Math.round(a.score/a.maxScore*1000)/10 : 0, wrongCount:(a.results||[]).filter(r=>r.score<r.maxPoints).length, questionCount:(a.results||[]).length, title:attemptTitle(a), createdAt:a.createdAt })),
  aggregateWrongQuestions: (candidateId,filters={}) => aggregateWrong(attemptsForCandidate(candidateId).filter(a=>(!filters.track||(a.track||'general')===filters.track)&&(!filters.module||(a.module||'general')===filters.module)&&(!filters.bankId||a.quizId===filters.bankId))),
  buildWrongExam: (candidateId,filters={}) => store.aggregateWrongQuestions(candidateId,filters).map(w => ({ type:w.type, question:w.question, options:w.options||[], blanks:w.blanks||[], answer:w.correctAnswer, explanation:w.explanation||'',groupId:w.groupId,materialTitle:w.materialTitle,materialText:w.materialText,language:w.language,rubric:'', points:1 })),

  searchVocabulary: (query,filters={}) => {
    const needle=normalizeLookup(query); if(!needle)return [];
    const language=normalizeVocabularyLanguage(filters.language||filters.sourceLanguage);
    return state.vocabulary.filter(v=>canReadVocabulary(v,filters.candidateId)&&(v.reviewStatus||'approved')==='approved'&&(!filters.track||normalizeTrack(v.track)===filters.track)&&(!filters.chapter||v.chapter===filters.chapter)&&vocabularySearchValues(v,language).some(x=>normalizeLookup(x).includes(needle))).slice(0,100).map(publicVocabulary);
  },
  findVocabularyExact: (query,candidateId) => {const needle=normalizeLookup(query),found=state.vocabulary.find(v=>canReadVocabulary(v,candidateId)&&(v.reviewStatus||'approved')==='approved'&&[v.zh,v.en,...(v.acceptedZh||[]),...(v.acceptedEn||[])].some(x=>normalizeLookup(x)===needle));return found?publicVocabulary(found):null;},
  listVocabulary: filters => state.vocabulary.filter(v=>canReadVocabulary(v,filters?.candidateId)&&(!filters?.track||normalizeTrack(v.track)===filters.track)&&(!filters?.chapter||v.chapter===filters.chapter)).slice().sort((a,b)=>(a.en||a.zh).localeCompare(b.en||b.zh,'zh-CN')).map(publicVocabulary),
  getVocabulary: (id,candidateId) => {const row=state.vocabulary.find(v=>v.id===id&&canReadVocabulary(v,candidateId));return row?publicVocabulary(row):null;},
  addVocabulary: (entries,{ownerId=null}={}) => {
    const added=[], duplicates=[];
    for(const raw of entries){
      const entry=normalizeVocabulary({...raw,ownerId}); if(!entry)continue;entry.ownerId=ownerId;
      const existing=state.vocabulary.find(v=>isActiveVocabulary(v)&&(v.ownerId||null)===ownerId&&normalizeTrack(v.track)===entry.track&&normalizeLookup(v.en)===normalizeLookup(entry.en)&&normalizeLookup(v.zh)===normalizeLookup(entry.zh));
      if(existing){duplicates.push(entry);continue;}
      entry.id=crypto.randomUUID(); entry.createdAt=new Date().toISOString(); state.vocabulary.push(entry); added.push(entry);
    }
    if(added.length)persist(); return {added,duplicates};
  },
  updateVocabulary: (id,input) => { const index=state.vocabulary.findIndex(v=>v.id===id); if(index<0)return false; const normalized=normalizeVocabulary({...state.vocabulary[index],...input}); if(!normalized)return false; state.vocabulary[index]={...state.vocabulary[index],...normalized,id};persist();return true; },
  deleteVocabulary: id => { const index=state.vocabulary.findIndex(v=>v.id===id);if(index<0)return false;state.vocabulary.splice(index,1);state.collectionItems=state.collectionItems.filter(x=>x.wordId!==id);state.wordProgress=state.wordProgress.filter(x=>x.wordId!==id);persist();return true; },
  listCollections: candidateId => state.collections.filter(c=>c.candidateId===candidateId&&!isLegacyRemovedTrack(c.track)).map(c=>({...c,track:normalizeTrack(c.track),count:state.collectionItems.filter(x=>x.collectionId===c.id).length})),
  createCollection: (candidateId,name,track='general') => { const collection={id:crypto.randomUUID(),candidateId,name:String(name||'我的词库').trim().slice(0,80),track:normalizeTrack(track),createdAt:new Date().toISOString()};state.collections.push(collection);persist();return collection; },
  addCollectionItem: (candidateId,collectionId,wordId) => { const c=state.collections.find(x=>x.id===collectionId&&x.candidateId===candidateId&&!isLegacyRemovedTrack(x.track)),v=state.vocabulary.find(x=>x.id===wordId&&canReadVocabulary(x,candidateId));if(!c||!v)return false;if(!state.collectionItems.some(x=>x.collectionId===collectionId&&x.wordId===wordId))state.collectionItems.push({collectionId,wordId,createdAt:new Date().toISOString()});persist();return true; },
  collectionWords: (candidateId,collectionId) => { if(!state.collections.some(x=>x.id===collectionId&&x.candidateId===candidateId&&!isLegacyRemovedTrack(x.track)))return null;const ids=new Set(state.collectionItems.filter(x=>x.collectionId===collectionId).map(x=>x.wordId));return state.vocabulary.filter(v=>ids.has(v.id)&&canReadVocabulary(v,candidateId)&&(v.reviewStatus||'approved')==='approved').map(publicVocabulary); },
  recordWordResult: (candidateId,wordId,correct) => { let row=state.wordProgress.find(x=>x.candidateId===candidateId&&x.wordId===wordId);if(!row){row={candidateId,wordId,correct:0,wrong:0,streak:0,status:'learning',easeFactor:2.5,intervalDays:0};state.wordProgress.push(row);}if(correct){row.correct++;row.streak++;row.intervalDays=row.streak===1?1:row.streak===2?3:Math.max(7,Math.round((row.intervalDays||3)*(row.easeFactor||2.5)));row.easeFactor=Math.min(3,Number(row.easeFactor||2.5)+0.05);row.status=row.streak>=3?'mastered':'learning';}else{row.wrong++;row.streak=0;row.intervalDays=1;row.easeFactor=Math.max(1.3,Number(row.easeFactor||2.5)-0.2);row.status='review';}row.lastReviewedAt=new Date().toISOString();row.dueAt=new Date(Date.now()+row.intervalDays*86400000).toISOString();persist();return row; },
  wordProgress: candidateId => state.wordProgress.filter(x=>x.candidateId===candidateId),
  dailyPlan: (candidateId,track=null) => {
    const now=Date.now(),words=state.vocabulary.filter(v=>canReadVocabulary(v,candidateId)&&(v.reviewStatus||'approved')==='approved'&&(!track||normalizeTrack(v.track)===track)),progress=state.wordProgress.filter(x=>x.candidateId===candidateId),byWord=new Map(progress.map(x=>[x.wordId,x]));
    const due=words.filter(word=>{const row=byWord.get(word.id);return row&&(!row.dueAt||new Date(row.dueAt).getTime()<=now)&&row.status!=='mastered';}).slice(0,20);
    const fresh=words.filter(word=>!byWord.has(word.id)).sort((a,b)=>(a.frequencyRank||999999)-(b.frequencyRank||999999)).slice(0,10);
    const wrong=aggregateWrong(attemptsForCandidate(candidateId));
    return {track:track||'all',dueWords:due.length,newWords:fresh.length,wrongQuestions:wrong.length,recommended:[
      ...(due.length?[{type:'word-review',title:`复习 ${due.length} 个到期单词`,count:due.length}]:[]),
      ...(fresh.length?[{type:'new-words',title:`学习 ${fresh.length} 个新单词`,count:fresh.length}]:[]),
      ...(wrong.length?[{type:'wrong-questions',title:`复习 ${Math.min(20,wrong.length)} 道错题`,count:Math.min(20,wrong.length)}]:[])
    ]};
  },
  findTranslationCache: (text,source,targets,candidateId) => {const found=state.translationHistory.find(x=>x.candidateId===candidateId&&isActiveTranslation(x)&&normalizeLookup(x.text)===normalizeLookup(text)&&x.sourceRequested===source&&JSON.stringify([...(x.targets||[])].sort())===JSON.stringify([...(targets||[])].sort()));return found?publicTranslation(found):null;},
  addTranslation: row => {const targets=[...new Set(row.targets||[])].filter(isActiveLanguage),translations=Object.fromEntries(targets.map(code=>[code,String(row.translations?.[code]||'').trim()]).filter(x=>x[1])),record={...row,id:crypto.randomUUID(),sourceRequested:row.sourceRequested==='auto'?'auto':isActiveLanguage(row.sourceRequested)?row.sourceRequested:'auto',source:isActiveLanguage(row.source)?row.source:null,targets,translations,track:normalizeTrack(row.track),status:'machine',createdAt:new Date().toISOString()};state.translationHistory.push(record);if(state.translationHistory.length>10000)state.translationHistory.splice(0,state.translationHistory.length-10000);persist();return publicTranslation(record);},
  listTranslations: (candidateId=null) => state.translationHistory.filter(x=>isActiveTranslation(x)&&(!candidateId||x.candidateId===candidateId)).slice().reverse().slice(0,500).map(publicTranslation),
  getTranslation: id => {const found=state.translationHistory.find(x=>x.id===id&&isActiveTranslation(x));return found?publicTranslation(found):null;},
  updateTranslationStatus: (id,status) => {const row=state.translationHistory.find(x=>x.id===id);if(!row)return false;row.status=status;row.reviewedAt=new Date().toISOString();persist();return true;},
  studyOverview: (track,candidateId=null) => {
    const key=normalizeTrack(track),quizzes=state.quizzes.filter(q=>!isLegacyRemovedTrack(q.track)&&q.status==='published'&&normalizeTrack(q.track)===key&&q.ownerId===candidateId),words=state.vocabulary.filter(v=>canReadVocabulary(v,candidateId)&&(v.reviewStatus||'approved')==='approved'&&normalizeTrack(v.track)===key),progress=candidateId?state.wordProgress.filter(p=>p.candidateId===candidateId&&words.some(w=>w.id===p.wordId)):[],attempts=candidateId?state.attempts.filter(a=>a.candidateId===candidateId&&!isLegacyRemovedTrack(a.track||state.quizzes.find(q=>q.id===a.quizId)?.track)&&normalizeTrack(a.track||state.quizzes.find(q=>q.id===a.quizId)?.track)===key):[];
    return {track:key,quizCount:quizzes.length,questionCount:quizzes.reduce((s,q)=>s+approvedQuestions(q.questions).length,0),wordCount:words.length,modules:[...new Set(quizzes.map(q=>q.module||'general'))],progress:{practiced:progress.length,mastered:progress.filter(p=>p.status==='mastered').length,review:progress.filter(p=>p.status==='review').length,attempts:attempts.length,average:attempts.length?Math.round(attempts.reduce((s,a)=>s+(a.maxScore?a.score/a.maxScore*100:0),0)/attempts.length):0}};
  },

  getStats: () => { const quizzes=state.quizzes.filter(x=>x.status==='published'), attempts=state.attempts; return { quizCount:quizzes.length, totalQuestions:quizzes.reduce((s,q)=>s+q.questions.length,0), examCount:state.exams.length, attemptCount:attempts.length, candidateCount:state.candidates.length, avgScore:attempts.length ? Math.round(attempts.reduce((s,a)=>s+(a.maxScore?a.score/a.maxScore*100:0),0)/attempts.length*10)/10 : 0 }; },
  exportData: () => {const {sessions:_sessions,...safeState}=state;return JSON.stringify({ exportedAt:new Date().toISOString(), ...safeState, candidates:state.candidates.map(({passwordHash,salt,...c})=>c) }, null, 2);},
  importLegacy: legacy => {
    const keyFor={collectionItems:row=>`${row.collectionId}:${row.wordId}`,wordProgress:row=>`${row.candidateId}:${row.wordId}`};
    const keys=['candidates','quizzes','exams','attempts','vocabulary','collections','collectionItems','wordProgress','translationHistory','studyJournal','corpus'];
    for(const key of keys)if(Array.isArray(legacy[key])){
      const identity=keyFor[key]||((row)=>row.id),known=new Set(state[key].map(identity));
      for(const row of legacy[key])if(row&&identity(row)&&!known.has(identity(row))){state[key].push(structuredClone(row));known.add(identity(row));}
    }
    for(const attempt of state.attempts)if(!attempt.examId){
      const examId=crypto.randomUUID(),bank=state.quizzes.find(row=>row.id===attempt.quizId);
      state.exams.push({id:examId,bankId:bank?.id||null,candidateId:attempt.candidateId,candidateName:attempt.candidateName,title:bank?.title||'历史试卷',track:attempt.track||bank?.track||'general',questions:attempt.questions||[],createdAt:attempt.createdAt,completedAt:attempt.createdAt});
      attempt.examId=examId;
    }
    persist();return Object.fromEntries(keys.map(key=>[key,state[key].length]));
  },
  flush: () => persistQueue,
  storageMode: () => relational ? 'mysql' : 'json'
};

function normalizeLookup(value){return String(value||'').normalize('NFC').trim().toLocaleLowerCase().replace(/\s+/g,' ');}
function normalizeVocabularyLanguage(value){return ['zh','en'].includes(String(value))?String(value):'auto';}
function vocabularySearchValues(entry,language){
  if(language==='zh')return [entry.zh,...(entry.acceptedZh||[])];
  if(language==='en')return [entry.en,...(entry.acceptedEn||[])];
  return [entry.zh,entry.en,...(entry.meanings||[]),...(entry.acceptedZh||[]),...(entry.acceptedEn||[])];
}
function normalizeTrack(value){return ['english','postgraduate','ielts'].includes(String(value))?String(value):'general';}
function hydrateGroupMaterials(questions){for(const q of questions){if(!q.groupId)continue;const source=questions.find(x=>x.groupId===q.groupId&&x.materialText);if(source){q.materialText=source.materialText;q.materialTitle ||= source.materialTitle;}}}
function normalizeVocabulary(input){
  const zh=String(input.zh||input.chinese||'').trim(),en=String(input.en||input.english||'').trim();
  if(!zh||!en)return null;
  const list=value=>Array.isArray(value)?value.map(String).map(x=>x.trim()).filter(Boolean):String(value||'').split(/[;；|]/).map(x=>x.trim()).filter(Boolean);
  const reviewStatus=['draft','needs-review','approved','rejected'].includes(input.reviewStatus)?input.reviewStatus:(input.needsReview?'needs-review':'approved');
  return {zh,en,track:normalizeTrack(input.track),partOfSpeech:String(input.partOfSpeech||input.part_of_speech||'').trim(),pronunciation:String(input.pronunciation||'').trim(),meanings:list(input.meanings||input.meaning),acceptedZh:list(input.acceptedZh||input.accepted_zh),acceptedEn:list(input.acceptedEn||input.accepted_en),exampleEn:String(input.exampleEn||input.example_en||'').trim(),exampleZh:String(input.exampleZh||input.example_zh||'').trim(),chapter:String(input.chapter||'').trim(),difficulty:Math.min(5,Math.max(1,Number(input.difficulty)||1)),frequencyRank:input.frequencyRank?Math.max(1,Number(input.frequencyRank)):null,tags:list(input.tags),source:String(input.source||'').trim().slice(0,255),sourceUrl:String(input.sourceUrl||input.source_url||'').trim().slice(0,1000),license:String(input.license||input.licenseCode||'').trim().slice(0,120),attribution:String(input.attribution||'').trim(),reviewStatus,needsReview:reviewStatus!=='approved'};
}

function isLegacyRemovedTrack(value){return String(value||'')==='thai';}
function isActiveLanguage(value){return value==='zh'||value==='en';}
function isActiveVocabulary(entry){return !isLegacyRemovedTrack(entry?.track)&&Boolean(String(entry?.zh||'').trim()&&String(entry?.en||'').trim());}
function canReadVocabulary(entry,candidateId){return isActiveVocabulary(entry)&&(!entry.ownerId||entry.ownerId===candidateId);}
function publicVocabulary(entry){
  const fields=['id','ownerId','zh','en','track','partOfSpeech','pronunciation','meanings','acceptedZh','acceptedEn','exampleEn','exampleZh','chapter','difficulty','frequencyRank','tags','source','sourceUrl','license','attribution','reviewStatus','needsReview','createdAt'];
  return Object.fromEntries(fields.filter(key=>entry[key]!==undefined).map(key=>[key,key==='track'?normalizeTrack(entry[key]):entry[key]]));
}
function isActiveTranslation(row){return !isLegacyRemovedTrack(row?.track)&&row?.sourceRequested!=='th'&&row?.source!=='th'&&!(row?.targets||[]).includes('th')&&!Object.hasOwn(row?.translations||{},'th');}
function publicTranslation(row){const targets=(row.targets||[]).filter(isActiveLanguage),translations=Object.fromEntries(targets.map(code=>[code,row.translations?.[code]]).filter(x=>x[1]));return {...row,track:normalizeTrack(row.track),targets,translations};}

function aggregateWrong(attempts) {
  const map = new Map();
  for (const attempt of attempts) for (const result of (attempt.results || [])) {
    if (result.score >= result.maxPoints) continue;
    const q = (attempt.questions || [])[result.index]; if (!q) continue;
    const key = JSON.stringify([q.type,q.question,q.materialText||'',q.options||[],result.correctAnswer]);
    if (!map.has(key)) map.set(key, { type:q.type, question:q.question, options:q.options||[], blanks:q.blanks||[],groupId:q.groupId,materialTitle:q.materialTitle,materialText:q.materialText,language:q.language,correctAnswer:result.correctAnswer, explanation:result.explanation||'', wrongCount:0, attempts:[] });
    const entry=map.get(key); entry.wrongCount++; entry.attempts.push({ attemptId:attempt.id,date:attempt.createdAt,userAnswer:attempt.answers?.[result.index],title:attemptTitle(attempt) });
  }
  return [...map.values()].sort((a,b)=>b.wrongCount-a.wrongCount);
}

function approvedQuestions(questions=[]){return questions.filter(q=>(q.reviewStatus||'approved')==='approved');}
function countTypes(questions) { return approvedQuestions(questions).reduce((out,q)=>({ ...out,[q.type]:(out[q.type]||0)+1 }),{}); }

export function publicQuiz(row) {
  const questions = approvedQuestions(row.questions).map(q => ({id:q.id,type:q.type,question:q.question,options:q.options||[],points:q.points,groupId:q.groupId,materialTitle:q.materialTitle,materialText:q.materialText,blanks:(q.blanks||[]).map(b=>({label:b.label,points:b.points}))}));
  return { id:row.id, bankId:row.bankId, blueprint:row.blueprint, title:row.title, track:normalizeTrack(row.track), module:row.module||'general', sourceName:row.sourceName, questions, draftAnswers:row.draftAnswers||{},candidateName:row.candidateName, createdAt:row.createdAt };
}
