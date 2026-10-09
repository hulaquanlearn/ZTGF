import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { store, publicQuiz } from './db.js';
import { extractText } from './extract.js';
import { parseExistingQuestions } from './parser.js';
import { examDocx, attemptDocx, wrongQuestionsDocx } from './export-docx.js';
import { parseVocabularyFile, vocabularyTemplate } from './vocabulary-import.js';
import { detectLanguage, translateText, translationConfigured } from './translation.js';
import { seedVocabulary } from './seed-vocabulary.js';
import { seedStudyBanks } from './seed-study.js';
import { jobQueue } from './job-queue.js';
import { corpusRouter } from './corpus.js';

export const app = express();
const TRACKS = {
  english: { name: '英语学习', modules: ['vocabulary', 'reading', 'listening', 'writing'] },
  postgraduate: { name: '考研英语', modules: ['vocabulary', 'cloze', 'reading', 'new-type', 'translation', 'writing'] },
  ielts: { name: '雅思', modules: ['vocabulary', 'listening', 'reading', 'writing', 'speaking'] }
};
const TYPES = { boolean: '判断题', choice: '单选题', multiple: '多选题', fill: '填空题', short: '简答题' };
const loginUsage = new Map(), translationUsage = new Map();
const uploadDir = path.resolve(process.env.UPLOAD_DIR || 'uploads');
await fs.mkdir(uploadDir, { recursive: true });
const upload = multer({ dest: uploadDir, limits: { fileSize: Number(process.env.MAX_UPLOAD_MB || 20) * 1024 * 1024, files: 1 }, fileFilter: (_req, file, cb) => cb(null, /\.(pdf|doc|docx|md|markdown|txt|xlsx|csv)$/i.test(file.originalname)) });
const bootstrapName = String(process.env.APP_USERNAME || process.env.ADMIN_USERNAME || 'admin').trim();
const bootstrapPassword = process.env.APP_PASSWORD || process.env.ADMIN_PASSWORD || '';
if (bootstrapPassword) {
  if (/^(?:CHANGE[_-]|change-this-password|your[_-]?password|password123|example)/i.test(bootstrapPassword)) throw new Error('请先修改 APP_PASSWORD 示例密码');
  const bootstrap = store.ensureBootstrapAccount(bootstrapName, bootstrapPassword);
  if (!bootstrap.ok) throw new Error(`初始账号配置无效：${bootstrap.error}`);
  store.claimLegacyBanks(bootstrap.candidate.id);
}
if (process.env.AUTO_SEED_VOCABULARY !== '0') store.addVocabulary(seedVocabulary);
await store.flush();

app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.resolve('public')));
app.get('/api/health', (_req, res) => res.json({ ok: true, database: store.storageMode(), schema: 'relational-v6', version: '6.2.1', identityMode: 'standalone', accountMode: 'unified', accountConfigured: store.listCandidates().length > 0, gradingMode: 'deterministic-only', translationConfigured: translationConfigured(), translationProvider: translationConfigured() ? String(process.env.TRANSLATION_PROVIDER).toLowerCase() : 'none' }));
// Retired privileged routes never become shortcuts around account ownership.
app.use('/api/admin', (_req, res) => res.status(410).json({ error: '分级管理接口已停用，请登录后使用题库功能' }));
app.post(['/api/account/login', '/api/session/login'], asyncRoute(async (req, res) => {
  const username = String(req.body.username || req.body.name || '').trim();
  if(username.length>60)return res.status(400).json({error:'账号最多 60 个字符'});
  if (!allowLogin(req, username)) return res.status(429).json({ error: '登录尝试过多，请15分钟后再试' });
  const auth = store.authenticateCandidate(username, req.body.password, false);
  if (!auth.ok) return res.status(401).json({ error: '账号或密码错误' });
  loginUsage.delete(loginKey(req, username));
  store.ensureStarterBanks(auth.candidate.id, seedStudyBanks);
  const token = createSession(auth.candidate);
  await store.flush();
  res.json({ ok: true, id: auth.candidate.id, name: auth.candidate.name, token });
}));
app.post(['/api/account/logout', '/api/session/logout'], asyncRoute(async (req, res) => { store.revokeSession(sessionToken(req)); await store.flush(); res.json({ ok: true }); }));
app.use('/api', asyncRoute(async (req, res, next) => {
  const session = store.getSession(sessionToken(req));
  const candidate = session?.role === 'user' && session.userId ? store.getCandidateById(session.userId) : null;
  if (!candidate || candidate.status === 'disabled') return res.status(401).json({ error: '请先登录' });
  req.account = candidate; next();
}));
app.get('/api/account/me', (req, res) => res.json({ id: req.account.id, name: req.account.name }));
app.post('/api/candidate/session', (req, res) => res.json({ ok: true, name: req.account.name }));
app.post('/api/account/password', asyncRoute(async (req, res) => {
  if (!store.authenticateCandidate(req.account.name, req.body.currentPassword, false).ok) return res.status(400).json({ error: '当前密码不正确' });
  const password = String(req.body.newPassword || '');
  if (password.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  store.resetCandidatePassword(req.account.id, password);
  const token = createSession(req.account); await store.flush(); res.json({ ok: true, token });
}));
app.use('/api/corpus', corpusRouter(store));

// All subjects use the same owned bank workspace.
app.get(['/api/banks', '/api/quizzes', '/api/user/quizzes'], (req, res) => {
  const track = optionalTrack(req.query.track);
  if (req.query.track && !track) return res.status(400).json({ error: '学习方向无效' });
  const rows = store.listOwnedQuizzes(req.account.id, { track, module: text(req.query.module, 100), category: text(req.query.category, 100) });
  const query = text(req.query.q, 200).toLocaleLowerCase();
  res.json(rows.filter(row => !query || `${row.title} ${row.category || ''}`.toLocaleLowerCase().includes(query)).map(bankSummary));
});
app.post(['/api/banks', '/api/quizzes'], asyncRoute(async (req, res) => {
  const metadata = bankMetadata(req.body), checked = validateQuestions(req.body.questions || [], { allowEmpty: true });
  if (metadata.error || checked.error) return res.status(400).json(metadata.error ? { error: metadata.error } : checked);
  const bank = saveBank(req.account, metadata, checked.questions); await store.flush();
  res.status(201).json({ ...bankSummary(bank), questionCount: bank.questions.length });
}));
app.get(['/api/banks/:id', '/api/quizzes/:id'], (req, res) => { const bank = ownedBank(req, res); if (bank) res.json({ ...bankSummary(bank), ...publicQuiz(bank) }); });
app.patch(['/api/banks/:id', '/api/quizzes/:id'], asyncRoute(async (req, res) => {
  const bank = ownedBank(req, res); if (!bank) return;
  const metadata = bankMetadata({ ...bank, ...req.body }); if (metadata.error) return res.status(400).json({ error: metadata.error });
  store.updateQuiz(bank.id, metadata); await store.flush(); res.json({ ok: true, ...bankSummary(store.getOwnedQuiz(bank.id, req.account.id)) });
}));
app.delete(['/api/banks/:id', '/api/quizzes/:id', '/api/user/quizzes/:id'], asyncRoute(async (req, res) => { const bank = ownedBank(req, res); if (!bank) return; store.deleteQuizForOwner(bank.id, req.account.id); await store.flush(); res.json({ ok: true }); }));
app.get(['/api/banks/:id/questions', '/api/quizzes/:id/questions'], (req, res) => { const bank = ownedBank(req, res); if (bank) res.json({ ...bankSummary(bank), questions: bank.questions, typeCounts: countTypes(bank.questions) }); });
app.post(['/api/banks/:id/questions', '/api/quizzes/:id/questions'], asyncRoute(async (req, res) => {
  const bank = ownedBank(req, res); if (!bank) return; const checked = normalizeQuestion(req.body);
  if (!checked.ok) return res.status(400).json({ error: checked.error }); store.addQuestion(bank.id, checked.question); await store.flush(); res.status(201).json({ ok: true, index: bank.questions.length - 1 });
}));
app.put(['/api/banks/:id/questions/:index', '/api/quizzes/:id/questions/:index'], asyncRoute(async (req, res) => {
  const bank = ownedBank(req, res); if (!bank) return; const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || !bank.questions[index]) return res.status(404).json({ error: '题目不存在' });
  const checked = normalizeQuestion({ ...bank.questions[index], ...req.body }); if (!checked.ok) return res.status(400).json({ error: checked.error });
  store.updateQuestion(bank.id, index, checked.question); await store.flush(); res.json({ ok: true });
}));
app.delete(['/api/banks/:id/questions/:index', '/api/quizzes/:id/questions/:index'], asyncRoute(async (req, res) => {
  const bank = ownedBank(req, res); if (!bank) return; if (!store.deleteQuestion(bank.id, Number(req.params.index))) return res.status(404).json({ error: '题目不存在' }); await store.flush(); res.json({ ok: true });
}));
app.get(['/api/banks/:id/export', '/api/quizzes/:id/export'], asyncRoute(async (req, res) => { const bank = ownedBank(req, res); if (bank) sendDocx(res, await examDocx(bank, req.query.answers === '1'), 'question-bank.docx'); }));

app.post(['/api/import/preview', '/api/user/preview'], upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 PDF、Word、Markdown 或文本文件' });
  try {
    if (!/\.(pdf|doc|docx|md|markdown|txt)$/i.test(req.file.originalname)) return res.status(400).json({ error: '题库导入支持 PDF、Word、Markdown 和文本文件' });
    if (req.body.track && !optionalTrack(req.body.track)) return res.status(400).json({ error: '学习方向无效' });
    const sourceName = decodeFilename(req.file.originalname), sourceText = await extractText({ ...req.file, originalname: sourceName });
    if (sourceText.trim().length < 10) return res.status(422).json({ error: '未提取到足够正文；扫描版 PDF 请先执行 OCR 或转换为可搜索 PDF' });
    const metadata = { title: text(req.body.title, 200) || sourceName.replace(/\.[^.]+$/, ''), sourceName, category: text(req.body.category, 100), track: inputTrack(req.body.track), module: text(req.body.module, 100) || 'general' };
    if (req.body.mode === 'generate') {
      if (!process.env.DB_HOST || !process.env.DB_NAME || !process.env.DB_USER) return res.status(503).json({ error: '文档自动出题需要配置数据库和后台任务服务，当前可提取文件中的现有题目' });
      const count = integer(req.body.count ?? 20, 1, 100); if (!count) return res.status(400).json({ error: '自动出题数量需要为1至100的整数' });
      const queued = await jobQueue.enqueueGeneration({ ownerId: req.account.id, ownerName: req.account.name, sourceName, sourceText, byteSize: req.file.size, mimeType: req.file.mimetype, options: { ...metadata, count, difficulty: ['easy', 'medium', 'hard'].includes(req.body.difficulty) ? req.body.difficulty : 'medium' } });
      return res.status(202).json({ ...metadata, ...queued, status: 'queued', mode: 'generate' });
    }
    const parsed = parseExistingQuestions(sourceText);
    if (!parsed.questions.length && !parsed.incomplete.length) return res.status(422).json({ error: '没有识别到题号、题干与答案结构。请检查文件内容，或手动新增题目' });
    res.json({ ...metadata, questions: parsed.questions, incomplete: parsed.incomplete, incompleteCount: parsed.incomplete.length, extractedChars: sourceText.length, mode: 'extract' });
  } finally { await fs.unlink(req.file.path).catch(() => {}); }
}));
app.post(['/api/import/confirm', '/api/user/confirm-import'], asyncRoute(async (req, res) => {
  const metadata = bankMetadata({ ...req.body, title: req.body.title || req.body.sourceName || '导入题库' }), checked = validateQuestions(req.body.questions);
  if (metadata.error || checked.error) return res.status(400).json(metadata.error ? { error: metadata.error } : checked);
  const bank = saveBank(req.account, metadata, checked.questions, text(req.body.sourceName, 255)); await store.flush();
  res.status(201).json({ id: bank.id, title: bank.title, questionCount: bank.questions.length, category: bank.category, visibility: 'private' });
}));
app.get(['/api/jobs', '/api/user/jobs'], asyncRoute(async (req, res) => res.json(await jobQueue.list(req.account.id))));
app.get(['/api/jobs/:id', '/api/user/jobs/:id'], asyncRoute(async (req, res) => { const job = await jobQueue.get(req.params.id, req.account.id); res.status(job ? 200 : 404).json(job || { error: '任务不存在' }); }));

app.post(['/api/banks/:id/random-exam', '/api/quizzes/:id/random-exam'], asyncRoute(async (req, res) => {
  const bank = ownedBank(req, res); if (!bank) return;
  const active = store.findActiveExam(bank.id, req.account.id); if (active) return res.json({ ...examSummary(active), resumed: true });
  const requested = Object.fromEntries(Object.keys(TYPES).map(type => [type, Number(req.body[type] ?? req.body.counts?.[type] ?? 0)])), selected = [];
  for (const [type, count] of Object.entries(requested)) {
    const pool = bank.questions.filter(q => q.type === type && (q.reviewStatus || 'approved') === 'approved');
    if (!Number.isInteger(count) || count < 0 || count > pool.length) return res.status(400).json({ error: `${TYPES[type]}要求 ${count} 题，当前可用 ${pool.length} 题` });
    selected.push(...shuffle(pool).slice(0, count).map(q => structuredClone(q)));
  }
  if (!selected.length) return res.status(400).json({ error: '请至少选择一道题' });
  const questions = shuffle(selected);
  for (const q of questions) if (q.groupId && !q.materialText) { const source = bank.questions.find(item => item.groupId === q.groupId && item.materialText); if (source) { q.materialText = source.materialText; q.materialTitle = source.materialTitle; } }
  allocatePoints(questions);
  const exam = saveExam(req.account, { bankId: bank.id, title: `${bank.title} · 随机练习`, track: bank.track || 'general', module: bank.module || 'general', questions, blueprint: requested }); await store.flush(); res.status(201).json(examSummary(exam));
}));
app.get('/api/exams', (req, res) => res.json(store.listExamsForCandidate(req.account.id)));
app.get('/api/exams/:id', (req, res) => { const exam = ownedExam(req, res); if (exam) res.json({ ...publicQuiz(exam), completedAt: exam.completedAt || null, draftAnswers: exam.draftAnswers || {} }); });
app.put('/api/exams/:id/progress', asyncRoute(async (req, res) => {
  const exam = ownedExam(req, res); if (!exam) return; if (exam.completedAt) return res.status(409).json({ error: '该试卷已经提交' });
  const answers = sanitizeAnswers(req.body.answers, exam.questions.length); if (!answers) return res.status(400).json({ error: '答题数据格式不正确' });
  store.saveExamProgress(exam.id, req.account.id, answers); await store.flush(); res.json({ ok: true });
}));
app.delete('/api/exams/:id', asyncRoute(async (req, res) => { const exam = ownedExam(req, res); if (!exam) return; if (!store.deleteExam(exam.id)) return res.status(409).json({ error: '已提交的试卷不可取消' }); await store.flush(); res.json({ ok: true }); }));
app.get('/api/exams/:id/export', asyncRoute(async (req, res) => { const exam = ownedExam(req, res); if (exam) sendDocx(res, await examDocx(exam, false), 'exam.docx'); }));
app.post('/api/quizzes/:id/submit', (_req, res) => res.status(405).json({ error: '请先生成个人试卷' }));
app.post('/api/exams/:id/submit', asyncRoute(async (req, res) => {
  const exam = ownedExam(req, res); if (!exam) return; if (exam.completedAt) return res.status(409).json({ error: '该试卷已经提交，请到学习记录查看' });
  const answers = sanitizeAnswers(req.body.answers ?? exam.draftAnswers ?? {}, exam.questions.length); if (!answers) return res.status(400).json({ error: '答题数据格式不正确' });
  const result = gradeAndSave(exam, req.account, answers); await store.flush(); res.json(result);
}));
app.get('/api/attempts', (req, res) => res.json(store.findAttemptsByCandidate(req.account.id)));
app.get('/api/attempts/:id', (req, res) => { const row = store.getAttemptForCandidate(req.params.id, req.account.id); res.status(row ? 200 : 404).json(row || { error: '答题记录不存在' }); });
app.post('/api/attempts/:id/retry', asyncRoute(async (req, res) => {
  const row = store.getAttemptForCandidate(req.params.id, req.account.id);
  if (!row) return res.status(404).json({ error: '答题记录不存在' });
  const active = store.listExamsForCandidate(req.account.id).find(e => !e.completedAt && store.getExam(e.id)?.blueprint?.retryAttemptId === row.id);
  if (active) return res.json({ id: active.id, title: active.title, questionCount: active.questionCount, resumed: true });
  const questions = (row.results || []).filter(r => r.score < r.maxPoints).map(r => {
    const question = structuredClone(row.questions[r.index]);
    question.answer = structuredClone(r.correctAnswer);
    question.explanation = r.explanation || '';
    if (question.groupId && !question.materialText) {
      const source = row.questions.find(q => q.groupId === question.groupId && q.materialText);
      if (source) { question.materialText = source.materialText; question.materialTitle = source.materialTitle; }
    }
    return question;
  });
  if (!questions.length) return res.status(400).json({ error: '本次练习没有错题' });
  allocatePoints(questions);
  const paper = saveExam(req.account, { title: `${row.title} · 错题重练`, track: row.track || 'general', questions: shuffle(questions), blueprint: { retryAttemptId: row.id } });
  await store.flush(); res.status(201).json(examSummary(paper));
}));
app.get('/api/attempts/:id/export', asyncRoute(async (req, res) => { const row = store.getAttemptForCandidate(req.params.id, req.account.id); if (!row) return res.status(404).json({ error: '答题记录不存在' }); sendDocx(res, await attemptDocx(row, req.query.wrongOnly === '1'), req.query.wrongOnly === '1' ? 'wrong-questions.docx' : 'attempt.docx'); }));
app.get('/api/wrong-questions', (req, res) => res.json(store.aggregateWrongQuestions(req.account.id)));
app.get('/api/wrong-questions/export', asyncRoute(async (req, res) => sendDocx(res, await wrongQuestionsDocx(req.account.name, store.aggregateWrongQuestions(req.account.id)), 'wrong-book.docx')));
app.post('/api/wrong-exam', asyncRoute(async (req, res) => {
  const pool = store.buildWrongExam(req.account.id); if (!pool.length) return res.status(400).json({ error: '暂无错题' });
  const count = integer(req.body.count ?? Math.min(20, pool.length), 1, pool.length); if (!count) return res.status(400).json({ error: `错题数量需要为1至${pool.length}的整数` });
  const questions = shuffle(pool).slice(0, count); allocatePoints(questions);
  const exam = saveExam(req.account, { title: '错题复习', questions }); await store.flush(); res.status(201).json(examSummary(exam));
}));

// Shared local words are read-only; personal imports are isolated by owner.
app.get('/api/vocabulary', (req, res) => {
  const language = String(req.query.language || req.query.sourceLanguage || 'auto').toLowerCase(), track = optionalTrack(req.query.track);
  if (!['auto', 'zh', 'en'].includes(language)) return res.status(400).json({ error: '查词语言仅支持中文和英文' });
  if (req.query.track && !track) return res.status(400).json({ error: '学习方向无效' });
  const filters = { candidateId: req.account.id, track, chapter: text(req.query.chapter, 100), language };
  res.json(req.query.browse === '1' ? store.listVocabulary(filters) : store.searchVocabulary(req.query.q || '', filters));
});
app.get('/api/vocabulary/template', asyncRoute(async (_req, res) => res.type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet').attachment('vocabulary-template.xlsx').send(await vocabularyTemplate())));
app.post('/api/vocabulary/preview', upload.single('file'), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: '请选择 XLSX 或 CSV 文件' });
  try { if (!/\.(xlsx|csv)$/i.test(req.file.originalname)) return res.status(400).json({ error: '词库导入支持 XLSX 或 CSV 文件' }); res.json(await parseVocabularyFile(req.file)); }
  finally { await fs.unlink(req.file.path).catch(() => {}); }
}));
app.post('/api/vocabulary/import', asyncRoute(async (req, res) => {
  const entries = req.body.entries;
  if (!Array.isArray(entries) || !entries.length || entries.length > 20000) return res.status(400).json({ error: '请提供1至20000个词条' });
  if (entries.some(entry => !entry || hasRetiredVocabularyFields(entry) || !inputTrack(entry.track) || !text(entry.zh, 500) || !text(entry.en, 500))) return res.status(400).json({ error: '每个词条需要中文和英文，请使用新版模板及有效学习方向' });
  const result = store.addVocabulary(entries.map(entry => ({ ...entry, reviewStatus: 'approved' })), { ownerId: req.account.id }); await store.flush(); res.status(201).json({ added: result.added.length, duplicates: result.duplicates.length });
}));
app.put('/api/vocabulary/:id', asyncRoute(async (req, res) => {
  const word = store.getVocabulary(req.params.id, req.account.id); if (!word || word.ownerId !== req.account.id) return res.status(404).json({ error: '个人词条不存在' });
  if (hasRetiredVocabularyFields(req.body) || (req.body.track && !optionalTrack(req.body.track))) return res.status(400).json({ error: '仅支持中文、英文和有效学习方向' });
  if (!store.updateVocabulary(word.id, { ...req.body, ownerId: req.account.id, reviewStatus: 'approved' })) return res.status(400).json({ error: '词条内容不完整' }); await store.flush(); res.json({ ok: true });
}));
app.delete('/api/vocabulary/:id', asyncRoute(async (req, res) => { const word = store.getVocabulary(req.params.id, req.account.id); if (!word || word.ownerId !== req.account.id) return res.status(404).json({ error: '个人词条不存在' }); store.deleteVocabulary(word.id); await store.flush(); res.json({ ok: true }); }));
app.post('/api/vocabulary/practice', asyncRoute(async (req, res) => {
  const track = inputTrack(req.body.track); if (!track) return res.status(400).json({ error: '学习方向无效' });
  await vocabularyPractice(req, res, store.listVocabulary({ candidateId: req.account.id, track: track === 'general' ? null : track, chapter: text(req.body.chapter, 100) }));
}));
app.get('/api/vocabulary/practice-options',(req,res)=>{
  const words=req.query.collectionId ? store.collectionWords(req.account.id,String(req.query.collectionId)) : store.listVocabulary({candidateId:req.account.id,track:optionalTrack(req.query.track)||'english'});
  if(!words)return res.status(404).json({error:'词库不存在'});
  const count=words.filter(word=>word.en&&word.zh&&(word.reviewStatus||'approved')==='approved').length;
  res.json({available:count,maxPerExam:Math.min(200,count)});
});
app.get('/api/collections', (req, res) => res.json(store.listCollections(req.account.id)));
app.post('/api/collections', asyncRoute(async (req, res) => { const name = text(req.body.name, 80), track = inputTrack(req.body.track); if (!name || !track) return res.status(400).json({ error: '请填写词本名称并选择有效学习方向' }); const row = store.createCollection(req.account.id, name, track); await store.flush(); res.status(201).json(row); }));
app.get('/api/collections/:id/words', (req, res) => { const words = store.collectionWords(req.account.id, req.params.id); res.status(words ? 200 : 404).json(words || { error: '词本不存在' }); });
app.post('/api/collections/:id/words', asyncRoute(async (req, res) => { if (!store.addCollectionItem(req.account.id, req.params.id, req.body.wordId)) return res.status(404).json({ error: '词本或词条不存在' }); await store.flush(); res.status(201).json({ ok: true }); }));
app.post('/api/collections/:id/practice', asyncRoute(async (req, res) => vocabularyPractice(req, res, store.collectionWords(req.account.id, req.params.id) || [])));
app.get('/api/word-progress', (req, res) => res.json(store.wordProgress(req.account.id)));
app.get('/api/study/tracks', (req, res) => res.json(Object.entries(TRACKS).map(([id, value]) => ({ id, ...store.studyOverview(id, req.account.id), ...value }))));
app.get('/api/study/today', (req, res) => { const track = optionalTrack(req.query.track); if (req.query.track && !track) return res.status(400).json({ error: '学习方向无效' }); res.json(store.dailyPlan(req.account.id, track)); });
app.get('/api/study/journal', (req, res) => res.json(store.listStudyJournal(req.account.id)));
app.post('/api/study/journal', asyncRoute(async (req, res) => {
  const track = inputTrack(req.body.track), module = String(req.body.module || '');
  if (!track || !['writing', 'speaking'].includes(module)) return res.status(400).json({ error: '请选择写作或口语练习' });
  const response = text(req.body.response, 30000), prompt = text(req.body.prompt, 10000), notes = text(req.body.notes, 10000);
  if (!response) return res.status(400).json({ error: '请填写作文或口语练习记录' });
  const row = store.addStudyJournal({ candidateId: req.account.id, track, module, prompt, response, notes }); await store.flush(); res.status(201).json(row);
}));
app.delete('/api/study/journal/:id', asyncRoute(async (req, res) => { if (!store.deleteStudyJournal(req.params.id, req.account.id)) return res.status(404).json({ error: '练习记录不存在' }); await store.flush(); res.json({ ok: true }); }));
app.get('/api/study/:track', (req, res) => { const track = String(req.params.track); if (!TRACKS[track]) return res.status(404).json({ error: '学习方向不存在' }); res.json({ ...store.studyOverview(track, req.account.id), ...TRACKS[track], track, quizzes: store.listOwnedQuizzes(req.account.id, { track }).map(bankSummary) }); });

app.post('/api/translate', asyncRoute(async (req, res) => {
  const value = text(req.body.text, 5001), maximum = Math.min(5000, Math.max(50, Number(process.env.TRANSLATION_MAX_CHARS || 1200)));
  if (!value || value.length > maximum) return res.status(400).json({ error: `请输入1至${maximum}个字符` });
  if (/[\u0E00-\u0E7F]/.test(value)) return res.status(400).json({ error: '翻译仅支持中文和英文' });
  const source = String(req.body.source || 'auto'); if (!['auto', 'zh', 'en'].includes(source)) return res.status(400).json({ error: '翻译语言无效' });
  const detected = detectLanguage(value), resolved = source === 'auto' ? detected : source;
  const targets = [...new Set(Array.isArray(req.body.targets) ? req.body.targets : [])].filter(code => ['zh', 'en'].includes(code) && code !== resolved); if (!targets.length) targets.push(resolved === 'en' ? 'zh' : 'en');
  const track = inputTrack(req.body.track); if (!track) return res.status(400).json({ error: '学习方向无效' });
  const metadata = { candidateId: req.account.id, candidateName: req.account.name, text: value, sourceRequested: source, source: resolved, track };
  const exact = store.findVocabularyExact(value, req.account.id); let row, cached = false;
  if (exact && targets.every(code => exact[code])) row = store.addTranslation({ ...metadata, targets, translations: Object.fromEntries(targets.map(code => [code, exact[code]])), provider: 'local' });
  else {
    const previous = store.findTranslationCache(value, source, targets, req.account.id);
    if (previous) { row = store.addTranslation({ ...metadata, source: previous.source, targets, translations: previous.translations, provider: previous.provider, cachedFrom: previous.id }); cached = true; }
    else {
      if (!translationConfigured()) return res.status(503).json({ error: '实时翻译服务尚未配置，可以先使用本地查词' });
      enforceTranslationLimit(req.account.id); const result = await translateText(value, { source, targets }); row = store.addTranslation({ ...metadata, source: result.source || resolved, targets, translations: result.translations, provider: result.provider });
    }
  }
  await store.flush(); res.json({ ...row, cached });
}));
app.get('/api/translations', (req, res) => res.json(store.listTranslations(req.account.id)));
app.use('/api', (_req, res) => res.status(404).json({ error: '接口不存在' }));
// History routes: refresh/direct links return the shell, never unknown APIs or files.
app.get(/^\/(?:login|banks|bank\/[^/]+|import(?:\/[^/]+){0,2}|build\/[^/]+|exam\/[^/]+|attempt\/[^/]+|results|wrong|english(?:\/[^/]+)?|ielts(?:\/[^/]+)?|corpus(?:\/[^/]+)?|settings)\/?$/, (_req,res)=>res.sendFile(path.resolve('public/index.html')));
app.use((error, _req, res, _next) => { const status = error instanceof multer.MulterError ? 400 : Number(error.status) || 500; if (status >= 500) console.error(error); res.status(status).json({ error: error.message || '服务器错误' }); });
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.HOST || '0.0.0.0', port = Number(process.env.PORT || 3080);
  const listener = app.listen(port, host, () => console.log(`QuizForge running at http://${host}:${port}`));
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    const timeout = setTimeout(() => process.exit(1), 15000); timeout.unref();
    try { await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve())); await store.flush(); await jobQueue.close(); clearTimeout(timeout); process.exit(0); }
    catch (error) { console.error('Shutdown failed:', error); process.exit(1); }
  };
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
}

function asyncRoute(handler) { return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next); }
function text(value, max) { return String(value ?? '').trim().slice(0, max); }
function optionalTrack(value) { const key = text(value, 100); return ['general', ...Object.keys(TRACKS)].includes(key) ? key : null; }
function inputTrack(value) { return text(value, 100) ? optionalTrack(value) : 'general'; }
function integer(value, min, max) { const number = Number(value); return Number.isInteger(number) && number >= min && number <= max ? number : null; }
function sessionToken(req) { return String(req.get('x-session-token') || ''); }
function createSession(account) { return store.createSession({ role: 'user', userId: account.id, name: account.name, hours: Number(process.env.SESSION_HOURS || 12) }); }
function ownedBank(req, res) { const bank = store.getOwnedQuiz(req.params.id, req.account.id); if (!bank) res.status(404).json({ error: '题库不存在' }); return bank; }
function ownedExam(req, res) { const exam = store.getExamForCandidate(req.params.id, req.account.id); if (!exam) res.status(404).json({ error: '试卷不存在' }); return exam; }
function countTypes(questions = []) { return questions.reduce((out, q) => ({ ...out, [q.type]: (out[q.type] || 0) + 1 }), {}); }
function bankSummary(bank) { const counts = bank.typeCounts || countTypes(bank.questions); return { id: bank.id, title: bank.title, track: bank.track || 'general', category: bank.category || '', module: bank.module || 'general', course: bank.course || '', unit: bank.unit || '', year: bank.year || '', difficulty: bank.difficulty || 'mixed', sourceName: bank.sourceName || '', source_name: bank.sourceName || '', createdAt: bank.createdAt, created_at: bank.createdAt, updatedAt: bank.updatedAt || bank.createdAt, typeCounts: counts, questionCount: Object.values(counts).reduce((sum, count) => sum + count, 0), groupCount: bank.groupCount || new Set((bank.questions || []).map(q => q.groupId).filter(Boolean)).size, visibility: 'private' }; }
function bankMetadata(input) { const title = text(input.title, 200), track = inputTrack(input.track); if (!title) return { error: '请填写题库名称' }; if (!track) return { error: '学习方向无效' }; return { title, track, category: text(input.category ?? input.course, 100), module: text(input.module, 100) || 'general', course: text(input.course, 100), unit: text(input.unit, 100), year: text(input.year, 100), difficulty: text(input.difficulty, 100) || 'mixed' }; }
function saveBank(account, metadata, questions, sourceName = '') { const bank = { id: crypto.randomUUID(), ...metadata, questions, sourceName, sourceText: '', status: 'published', visibility: 'private', ownerId: account.id, ownerName: account.name, createdAt: new Date().toISOString() }; store.addQuiz(bank); return bank; }
function decodeFilename(name) { const decoded = Buffer.from(name, 'latin1').toString('utf8'); return /[\u4e00-\u9fff]/.test(decoded) && !/[\u4e00-\u9fff]/.test(name) ? decoded : name; }
function validateQuestions(input, { allowEmpty = false } = {}) {
  if (!Array.isArray(input) || (!allowEmpty && !input.length) || input.length > 10000) return { error: '请提供有效题目，单次最多10000道' };
  const checked = input.map((question, index) => ({ index, result: normalizeQuestion(question) })), invalid = checked.filter(row => !row.result.ok).map(row => ({ index: row.index, reason: row.result.error }));
  return invalid.length ? { error: `仍有 ${invalid.length} 道题不完整，请补充或剔除后导入`, invalid } : { questions: checked.map(row => row.result.question) };
}
function normalizeQuestion(input) {
  if (!input || typeof input !== 'object') return { ok: false, error: '题目格式不正确' };
  const type = String(input.type || ''), question = text(input.question, 20000);
  if (!Object.hasOwn(TYPES, type)) return { ok: false, error: '题型不合法' }; if (!question) return { ok: false, error: '题干不能为空' };
  const base = { type, question, options: [], blanks: [], answer: input.answer, explanation: text(input.explanation, 20000), rubric: text(input.rubric, 20000), groupId: text(input.groupId, 80), materialTitle: text(input.materialTitle, 200), materialText: text(input.materialText, 30000), reviewStatus: 'approved', generatedBy: text(input.generatedBy, 120), sourceLocator: text(input.sourceLocator, 255), language: ['en', 'zh'].includes(input.language) ? input.language : null, points: ['multiple', 'fill', 'short'].includes(type) ? 2 : 1 };
  if (type === 'boolean') { if (typeof input.answer !== 'boolean') return { ok: false, error: '判断题答案必须是正确或错误' }; }
  else if (type === 'choice' || type === 'multiple') {
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 26 || input.options.some(option => !text(option, 10000))) return { ok: false, error: '选择题需要2至26个非空选项' };
    base.options = input.options.map(option => text(option, 10000)); const supplied = Array.isArray(input.answer) ? input.answer : [input.answer];
    if (!supplied.length || supplied.some(value => value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '')) return { ok: false, error: '选择题缺少标准答案' };
    const indices = supplied.map(Number); if (indices.some(index => !Number.isInteger(index) || index < 0 || index >= base.options.length)) return { ok: false, error: '选择题答案超出选项范围' };
    if (type === 'choice' && indices.length !== 1) return { ok: false, error: '单选题只能有1个答案' };
    base.answer = type === 'choice' ? indices[0] : [...new Set(indices)].sort((a, b) => a - b);
  } else if (type === 'fill') {
    const blanks = Array.isArray(input.blanks) && input.blanks.length ? input.blanks : Array.isArray(input.answer) ? input.answer.map(answer => ({ answers: Array.isArray(answer) ? answer : [answer] })) : [];
    base.blanks = blanks.map(blank => ({ answers: (Array.isArray(blank?.answers) ? blank.answers : [blank?.answers]).map(answer => text(answer, 10000)).filter(Boolean) }));
    if (!base.blanks.length || base.blanks.some(blank => !blank.answers.length)) return { ok: false, error: '每一空都需要至少1个标准答案' }; base.answer = base.blanks.map(blank => blank.answers);
  } else { base.answer = (Array.isArray(input.answer) ? input.answer : [input.answer]).map(answer => text(answer, 20000)).filter(Boolean); if (!base.answer.length) return { ok: false, error: '简答题需要文件中的标准答案' }; }
  base.language ||= inferAnswerLanguage(base);
  return { ok: true, question: base };
}
function allocatePoints(questions) {
  const weights = questions.map(q => ['multiple', 'fill', 'short'].includes(q.type) ? 2 : 1), total = weights.reduce((sum, weight) => sum + weight, 0);
  const cents = weights.map(weight => Math.floor(weight * 10000 / total));
  const order = weights.map((weight, index) => ({ index, remainder: (weight * 10000) % total })).sort((a, b) => b.remainder - a.remainder);
  const remaining = 10000 - cents.reduce((sum, value) => sum + value, 0);
  for (let index = 0; index < remaining; index++) cents[order[index].index]++;
  questions.forEach((q, index) => { q.points = cents[index] / 100; });
}
function saveExam(account, fields) { const exam = { id: crypto.randomUUID(), bankId: null, candidateId: account.id, candidateName: account.name, track: 'general', module: 'general', blueprint: {}, draftAnswers: {}, ...fields, createdAt: new Date().toISOString() }; store.addExam(exam); return exam; }
function examSummary(exam) { return { id: exam.id, title: exam.title, questionCount: exam.questions.length, blueprint: exam.blueprint, createdAt: exam.createdAt }; }
function sanitizeAnswers(input, count) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null; const answers = {};
  for (const [key, value] of Object.entries(input)) {
    if (!/^\d+$/.test(key) || Number(key) >= count) continue;
    if (Array.isArray(value)) { if (value.length > 100 || value.some(item => item !== null && !['string', 'number', 'boolean'].includes(typeof item))) return null; answers[key] = value.map(item => typeof item === 'string' ? item.slice(0, 20000) : item); }
    else if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) answers[key] = typeof value === 'string' ? value.slice(0, 20000) : value;
    else return null;
  }
  return answers;
}
function gradeAndSave(exam, account, answers) {
  const results = exam.questions.map((q, index) => {
    const answer = answers[index], maxPoints = Number(q.points), language = q.language || inferAnswerLanguage(q); let score = 0;
    if (q.type === 'choice' || q.type === 'multiple') {
      const raw = Array.isArray(answer) ? answer : [answer], actual = raw.map(Number), expected = (Array.isArray(q.answer) ? q.answer : [q.answer]).map(Number).sort((a, b) => a - b);
      if (raw.length && raw.every(value => value !== null && value !== undefined && typeof value !== 'boolean' && String(value).trim() !== '') && actual.every(Number.isInteger) && new Set(actual).size === actual.length && JSON.stringify(actual.sort((a, b) => a - b)) === JSON.stringify(expected)) score = maxPoints;
    } else if (q.type === 'boolean') { if ((answer === true || answer === false || answer === 'true' || answer === 'false') && String(answer) === String(q.answer)) score = maxPoints; }
    else if (q.type === 'fill') { const actual = Array.isArray(answer) ? answer : [], blanks = q.blanks || [], matches = blanks.filter((blank, blankIndex) => normalizeAnswer(actual[blankIndex], language) && blank.answers.some(expected => normalizeAnswer(expected, language) === normalizeAnswer(actual[blankIndex], language))).length; if (blanks.length) score = maxPoints * matches / blanks.length; }
    else if (q.type === 'short') { const actual = normalizeAnswer(answer, language); if (actual && (Array.isArray(q.answer) ? q.answer : [q.answer]).some(expected => normalizeAnswer(expected, language) === actual)) score = maxPoints; }
    score = Math.round(score * 100) / 100; return { index, score, maxPoints, explanation: q.explanation || '', correctAnswer: q.answer, feedback: score === maxPoints ? '回答正确' : score > 0 ? '部分正确' : '回答不正确' };
  });
  const score = Math.round(results.reduce((sum, row) => sum + row.score, 0) * 100) / 100, maxScore = Math.round(results.reduce((sum, row) => sum + row.maxPoints, 0) * 100) / 100, attemptId = crypto.randomUUID();
  const questions = exam.questions.map(q => ({ type: q.type, question: q.question, options: q.options || [], blanks: q.blanks || [], groupId: q.groupId || '', materialTitle: q.materialTitle || '', materialText: q.materialText || '', points: q.points, wordId: q.wordId || null, language: q.language || null }));
  store.addAttempt({ id: attemptId, title: exam.title, quizId: exam.bankId, examId: exam.id, candidateId: account.id, candidateName: account.name, track: exam.track || 'general', module: exam.module || 'general', answers, results, questions, score, maxScore, createdAt: new Date().toISOString() });
  exam.questions.forEach((q, index) => { if (q.wordId && store.getVocabulary(q.wordId, account.id)) store.recordWordResult(account.id, q.wordId, results[index].score === results[index].maxPoints); }); store.completeExam(exam.id);
  return { attemptId, score, maxScore, percentage: maxScore ? Math.round(score / maxScore * 1000) / 10 : 0, results };
}
function inferAnswerLanguage(question) {
  if (!['fill', 'short'].includes(question.type)) return null;
  const answers = [...(question.blanks || []).flatMap(blank => blank.answers || []), ...(Array.isArray(question.answer) ? question.answer.flat(2) : [question.answer])].filter(value => typeof value === 'string' && value.trim());
  return answers.length && answers.every(value => /^[\x20-\x7E\s]+$/.test(value)) && answers.some(value => /[a-z]/i.test(value)) ? 'en' : null;
}
function normalizeAnswer(value, language) {
  const valueText = String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('en').replace(/[，,。.!！；;：:？?]+$/g, '');
  return language === 'en' ? valueText.replace(/\s+/g, ' ') : valueText.replace(/\s+/g, '').replace(/[‐‑‒–—―−﹣－~～至]/g, '-');
}
function shuffle(items) { const result = items.slice(); for (let i = result.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]]; } return result; }
async function vocabularyPractice(req, res, words) {
  if (!words.length) return res.status(400).json({ error: '当前词库没有可练习的单词' });
  const direction = String(req.body.direction || 'en-zh'); if (!['zh-en', 'en-zh'].includes(direction)) return res.status(400).json({ error: '仅支持中英互练' });
  const mode = req.body.mode === 'spell' ? 'spell' : 'choice', [from, to] = direction.split('-'), pool = words.filter(word => word[from] && word[to] && (word.reviewStatus || 'approved') === 'approved');
  const count = integer(req.body.count ?? Math.min(10, pool.length), 1, Math.min(200, pool.length)); if (!count) return res.status(400).json({ error: `可练习数量为1至${Math.min(200, pool.length)}，请调整题量` });
  const questions = shuffle(pool).slice(0, count).map(word => wordQuestion(word, pool, from, to, mode));
  if (questions.some(q => q.type === 'choice' && q.options.length < 2)) return res.status(400).json({ error: '选择练习至少需要两个不同释义的单词，可改用拼写练习' });
  allocatePoints(questions); const exam = saveExam(req.account, { title: mode === 'spell' ? '单词拼写练习' : '词义选择练习', track: inputTrack(req.body.track) || pool[0].track || 'english', module: 'vocabulary', questions, blueprint: { direction, mode, count } }); await store.flush(); res.status(201).json(examSummary(exam));
}
function wordQuestion(word, pool, from, to, mode) {
  const common = { question: `“${word[from]}”对应的${to === 'en' ? '英文' : '中文'}是？`, explanation: `${word.zh} · ${word.en}`, points: 1, wordId: word.id, language: to };
  if (mode === 'spell') { const answers = [...new Set([word[to], ...(word[to === 'en' ? 'acceptedEn' : 'acceptedZh'] || [])].filter(Boolean))]; return { ...common, type: 'fill', options: [], blanks: [{ answers }], answer: [answers] }; }
  const alternatives = (item, language) => [item[language], ...(item[language === 'en' ? 'acceptedEn' : 'acceptedZh'] || [])].map(value => normalizeAnswer(value, language)).filter(Boolean);
  const sourceValues = new Set(alternatives(word, from)), targetValues = new Set(alternatives(word, to));
  const distractors = shuffle([...new Set(pool.filter(item => item.id !== word.id && item[to] && !alternatives(item, from).some(value => sourceValues.has(value)) && !alternatives(item, to).some(value => targetValues.has(value))).map(item => item[to]))]).slice(0, 3), options = shuffle([word[to], ...distractors]);
  return { ...common, type: 'choice', options, blanks: [], answer: options.indexOf(word[to]) };
}
function sendDocx(res, buffer, filename) { res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document').attachment(filename).send(buffer); }
function hasRetiredVocabularyFields(entry) { return ['th', 'thai', 'acceptedTh', 'accepted_th', 'exampleTh', 'example_th', 'romanization'].some(key => Object.hasOwn(entry || {}, key)); }
function loginKey(req, username) { return `${req.ip}:${String(username || '').toLowerCase()}`; }
function allowLogin(req, username) { const now = Date.now(); for (const [key, times] of loginUsage) if (!times.some(time => now - time < 900000)) loginUsage.delete(key); const key = loginKey(req, username), recent = (loginUsage.get(key) || []).filter(time => now - time < 900000); recent.push(now); loginUsage.set(key, recent); return recent.length <= 10; }
function enforceTranslationLimit(accountId) { const now = Date.now(), recent = (translationUsage.get(accountId) || []).filter(time => now - time < 3600000), max = Math.min(500, Math.max(1, Number(process.env.TRANSLATION_MAX_PER_HOUR || 30))); if (recent.length >= max) { const error = new Error('本小时翻译次数已用完，请稍后再试'); error.status = 429; throw error; } recent.push(now); translationUsage.set(accountId, recent); }
