import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import { migrateV6 } from './migrate-v6.js';

const EMPTY_STATE = {
  quizzes: [], exams: [], attempts: [], candidates: [], sessions: [], vocabulary: [],
  collections: [], collectionItems: [], wordProgress: [], translationHistory: [], studyJournal: [], corpus: []
};

const json = value => JSON.stringify(value ?? null);
const parse = (value, fallback = null) => {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try { return JSON.parse(value); } catch { return fallback; }
};
const date = value => value ? new Date(value) : new Date();
const nullableDate = value => value ? new Date(value) : null;
const normalize = value => String(value || '').normalize('NFC').trim().toLocaleLowerCase().replace(/\s+/g, ' ');
const rowChanged = (previous, current) => JSON.stringify(previous) !== JSON.stringify(current);
const mapBy = (rows, key) => new Map(rows.map(row => [key(row), row]));
const stableId = (...parts) => {
  const hex = crypto.createHash('sha256').update(parts.join(':')).digest('hex').slice(0, 32);
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
};

function withoutRemovedLanguageFeatures(legacy) {
  const quizzes=(legacy.quizzes||[]).filter(row=>row.track!=='thai'),bankIds=new Set(quizzes.map(row=>row.id));
  const exams=(legacy.exams||[]).filter(row=>row.track!=='thai'&&(!row.bankId||bankIds.has(row.bankId))),examIds=new Set(exams.map(row=>row.id));
  const vocabulary=(legacy.vocabulary||[]).filter(row=>row.track!=='thai'&&String(row.zh||'').trim()&&String(row.en||'').trim()).map(row=>{
    const fields=['id','ownerId','zh','en','track','partOfSpeech','pronunciation','meanings','acceptedZh','acceptedEn','exampleEn','exampleZh','chapter','difficulty','frequencyRank','tags','source','sourceUrl','license','attribution','reviewStatus','needsReview','createdAt'];
    return Object.fromEntries(fields.filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
  }),wordIds=new Set(vocabulary.map(row=>row.id));
  const collections=(legacy.collections||[]).filter(row=>row.track!=='thai'),collectionIds=new Set(collections.map(row=>row.id));
  return {...legacy,quizzes,exams,attempts:(legacy.attempts||[]).filter(row=>row.track!=='thai'&&(!row.examId||examIds.has(row.examId))),vocabulary,collections,collectionItems:(legacy.collectionItems||[]).filter(row=>collectionIds.has(row.collectionId)&&wordIds.has(row.wordId)),wordProgress:(legacy.wordProgress||[]).filter(row=>wordIds.has(row.wordId)),translationHistory:(legacy.translationHistory||[]).filter(row=>row.track!=='thai'&&row.sourceRequested!=='th'&&row.source!=='th'&&!(row.targets||[]).includes('th')&&!Object.hasOwn(row.translations||{},'th'))};
}

export async function createRelationalStorage(env = process.env, dependencies = {}) {
  const pool = dependencies.pool || mysql.createPool({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD || '',
    database: env.DB_NAME,
    charset: 'utf8mb4',
    connectionLimit: Number(env.DB_POOL_SIZE || 10),
    enableKeepAlive: true,
    multipleStatements: true
  });
  const schema = await fs.readFile(path.resolve('database/schema.sql'), 'utf8');
  await pool.query(schema);
  await migrateV6(pool);

  let persisted = structuredClone(EMPTY_STATE);
  let migrationPending = false;

  async function load() {
    const [[bankCount], [userCount], [wordCount]] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total FROM question_banks'),
      pool.query('SELECT COUNT(*) AS total FROM users'),
      pool.query('SELECT COUNT(*) AS total FROM vocabulary_entries')
    ]);
    const hasV5Data = Number(bankCount[0].total) + Number(userCount[0].total) + Number(wordCount[0].total) > 0;
    if (!hasV5Data) {
      const [legacyRows] = await pool.query('SELECT payload FROM app_state WHERE id=1');
      if (legacyRows[0]?.payload) {
        const legacy = parse(legacyRows[0].payload, structuredClone(EMPTY_STATE));
        for (const key of Object.keys(EMPTY_STATE)) legacy[key] ||= [];
        for (const candidate of legacy.candidates) candidate.status ||= 'active';
        for (const attempt of legacy.attempts) {
          if (attempt.examId) continue;
          const examId=stableId('legacy-attempt',attempt.id),bank=legacy.quizzes.find(row=>row.id===attempt.quizId);
          legacy.exams.push({id:examId,bankId:attempt.quizId||null,candidateId:attempt.candidateId,candidateName:attempt.candidateName,title:`${bank?.title||'历史题库'} · 历史试卷`,track:attempt.track||bank?.track||'general',module:attempt.module||bank?.module||'general',blueprint:{legacy:true},questions:attempt.questions||[],createdAt:attempt.createdAt,completedAt:attempt.createdAt});
          attempt.examId=examId;
        }
        migrationPending = true;
        return withoutRemovedLanguageFeatures(legacy);
      }
    }

    const [users, sessions, banks, questions, exams, examItems, attempts, vocabulary, collections, items, reviews, translations, journal, corpus] = await Promise.all([
      pool.query('SELECT * FROM users ORDER BY created_at'),
      pool.query('SELECT * FROM sessions WHERE revoked_at IS NULL AND expires_at > NOW(3)'),
      pool.query("SELECT * FROM question_banks WHERE track <> 'thai' ORDER BY created_at"),
      pool.query("SELECT q.* FROM questions q INNER JOIN question_banks b ON b.id=q.bank_id WHERE b.track <> 'thai' ORDER BY q.bank_id, q.position_no"),
      pool.query("SELECT * FROM exams WHERE track <> 'thai' ORDER BY started_at"),
      pool.query("SELECT i.* FROM exam_items i INNER JOIN exams e ON e.id=i.exam_id WHERE e.track <> 'thai' ORDER BY i.exam_id, i.position_no"),
      pool.query("SELECT * FROM attempts WHERE track <> 'thai' ORDER BY submitted_at"),
      pool.query("SELECT id,owner_id,zh,en,track,part_of_speech,pronunciation,meanings_json,accepted_json,examples_json,chapter_name,difficulty,frequency_rank,tags_json,source_name,source_url,license_code,attribution,review_status,created_at FROM vocabulary_entries WHERE track <> 'thai' AND en IS NOT NULL AND en <> '' ORDER BY created_at"),
      pool.query("SELECT * FROM word_collections WHERE track <> 'thai' ORDER BY created_at"),
      pool.query("SELECT i.* FROM word_collection_items i INNER JOIN word_collections c ON c.id=i.collection_id INNER JOIN vocabulary_entries v ON v.id=i.vocabulary_id WHERE c.track <> 'thai' AND v.track <> 'thai' AND v.en IS NOT NULL AND v.en <> '' ORDER BY i.created_at"),
      pool.query("SELECT r.* FROM word_reviews r INNER JOIN vocabulary_entries v ON v.id=r.vocabulary_id WHERE v.track <> 'thai' AND v.en IS NOT NULL AND v.en <> ''"),
      pool.query("SELECT * FROM translation_history WHERE track <> 'thai' AND source_requested <> 'th' AND (detected_source IS NULL OR detected_source <> 'th') ORDER BY created_at"),
      pool.query('SELECT * FROM study_journal ORDER BY created_at'),
      pool.query('SELECT * FROM corpus_entries ORDER BY updated_at')
    ]).then(results => results.map(result => result[0]));

    const questionsByBank = new Map();
    for (const row of questions) {
      const extra = parse(row.extra_json, {});
      const question = {
        ...extra,
        id: row.id,
        type: row.type,
        question: row.prompt,
        options: parse(row.options_json, []),
        answer: parse(row.answer_json),
        blanks: parse(row.blanks_json, []),
        rubric: row.rubric || '',
        explanation: row.explanation || '',
        points: Number(row.points),
        groupId: row.group_id || undefined,
        materialTitle: row.material_title || undefined,
        materialText: row.material_text || undefined,
        reviewStatus: row.review_status,
        generatedBy: row.generated_by || undefined,
        sourceLocator: row.source_locator || undefined
      };
      if (!questionsByBank.has(row.bank_id)) questionsByBank.set(row.bank_id, []);
      questionsByBank.get(row.bank_id).push(question);
    }

    const examItemsByExam = new Map();
    for (const row of examItems) {
      if (!examItemsByExam.has(row.exam_id)) examItemsByExam.set(row.exam_id, []);
      examItemsByExam.get(row.exam_id).push(parse(row.question_snapshot_json, {}));
    }

    const state = {
      corpus: corpus.map(row=>({...parse(row.payload_json,{}),id:row.id,ownerId:row.owner_id,createdAt:new Date(row.created_at).toISOString(),updatedAt:new Date(row.updated_at).toISOString()})),
      candidates: users.filter(row => row.role === 'user').map(row => ({
        id: row.id, name: row.username, nameKey: row.username_key, salt: row.password_salt,
        passwordHash: row.password_hash, status: row.status, starterInitialized:Boolean(row.starter_initialized),createdAt: new Date(row.created_at).toISOString()
      })),
      sessions: sessions.map(row => ({
        id: row.id, tokenHash: row.token_hash, userId: row.user_id, role: row.role,
        name: row.display_name, expiresAt: new Date(row.expires_at).toISOString(),
        createdAt: new Date(row.created_at).toISOString()
      })),
      quizzes: banks.map(row => ({
        id: row.id, ownerId: row.owner_id, title: row.title, track: row.track, category:row.category_name||'',
        module: row.module_code, course: row.course_name || '', unit: row.unit_name || '',
        year: row.exam_year || '', difficulty: row.difficulty, visibility: row.visibility,
        status: row.status, sourceDocumentId: row.source_document_id, sourceName: row.source_name || '',
        sourceText: row.source_text || '', version: row.version_no,
        questions: questionsByBank.get(row.id) || [], createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString()
      })),
      exams: exams.map(row => ({
        id: row.id, bankId: row.bank_id, candidateId: row.user_id, candidateName: row.candidate_name,
        title: row.title, track: row.track, module: row.module_code,
        blueprint: parse(row.blueprint_json, {}), draftAnswers:parse(row.draft_answers_json,{}), questions: examItemsByExam.get(row.id) || [],
        createdAt: new Date(row.started_at).toISOString(),
        completedAt: row.submitted_at ? new Date(row.submitted_at).toISOString() : undefined
      })),
      attempts: attempts.map(row => ({
        id: row.id, examId: row.exam_id, quizId: row.bank_id, candidateId: row.user_id,
        candidateName: row.candidate_name, track: row.track, score: Number(row.score),
        maxScore: Number(row.max_score), answers: parse(row.answers_json, {}),
        results: parse(row.results_json, []), questions: parse(row.questions_json, []),
        createdAt: new Date(row.submitted_at).toISOString()
      })),
      vocabulary: vocabulary.map(row => {
        const accepted = parse(row.accepted_json, {}), examples = parse(row.examples_json, {});
        return {
          id: row.id, ownerId:row.owner_id||null, zh: row.zh, en: row.en || '', track: row.track,
          partOfSpeech: row.part_of_speech || '', pronunciation: row.pronunciation || '',
          meanings: parse(row.meanings_json, []),
          acceptedZh: accepted.zh || [], acceptedEn: accepted.en || [],
          exampleEn: examples.en || '', exampleZh: examples.zh || '',
          chapter: row.chapter_name || '', difficulty: Number(row.difficulty),
          frequencyRank: row.frequency_rank || null, tags: parse(row.tags_json, []),
          source: row.source_name || '', sourceUrl: row.source_url || '', license: row.license_code || '',
          attribution: row.attribution || '', reviewStatus: row.review_status,
          needsReview: row.review_status !== 'approved', createdAt: new Date(row.created_at).toISOString()
        };
      }),
      collections: collections.map(row => ({
        id: row.id, candidateId: row.user_id, name: row.name, track: row.track,
        createdAt: new Date(row.created_at).toISOString()
      })),
      collectionItems: items.map(row => ({
        collectionId: row.collection_id, wordId: row.vocabulary_id,
        createdAt: new Date(row.created_at).toISOString()
      })),
      wordProgress: reviews.map(row => ({
        candidateId: row.user_id, wordId: row.vocabulary_id, correct: row.correct_count,
        wrong: row.wrong_count, streak: row.streak, status: row.status,
        easeFactor: Number(row.ease_factor), intervalDays: row.interval_days,
        dueAt: row.due_at ? new Date(row.due_at).toISOString() : null,
        lastReviewedAt: row.last_reviewed_at ? new Date(row.last_reviewed_at).toISOString() : null
      })),
      studyJournal:journal.map(row=>({id:row.id,candidateId:row.user_id,track:row.track,module:row.module_code,prompt:row.prompt_text,response:row.response_text,notes:row.notes_text||'',createdAt:new Date(row.created_at).toISOString()})),
      translationHistory: translations.map(row => {
        const targets=parse(row.targets_json, []).filter(code=>code==='zh'||code==='en'),raw=parse(row.translations_json, {}),translated=Object.fromEntries(targets.map(code=>[code,raw[code]]).filter(x=>x[1]));
        return {id:row.id,candidateId:row.user_id,candidateName:row.candidate_name,text:row.source_text,sourceRequested:row.source_requested,source:row.detected_source,targets,translations:translated,provider:row.provider,track:row.track,status:row.review_status,cachedFrom:row.cached_from,reviewedAt:row.reviewed_at?new Date(row.reviewed_at).toISOString():null,createdAt:new Date(row.created_at).toISOString()};
      }).filter(row=>row.targets.length)
    };
    persisted = structuredClone(state);
    return state;
  }

  async function persist(nextState) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();
      await syncUsers(connection, persisted.candidates, nextState.candidates);
      await syncSessions(connection, persisted.sessions || [], nextState.sessions || []);
      await syncVocabulary(connection, persisted.vocabulary, nextState.vocabulary);
      await syncBanks(connection, persisted.quizzes, nextState.quizzes);
      await syncExams(connection, persisted.exams, nextState.exams);
      await syncAttempts(connection, persisted.attempts, nextState.attempts);
      await syncCollections(connection, persisted.collections, nextState.collections);
      await syncCollectionItems(connection, persisted.collectionItems, nextState.collectionItems);
      await syncWordReviews(connection, persisted.wordProgress, nextState.wordProgress);
      await syncTranslations(connection, persisted.translationHistory, nextState.translationHistory);
      await syncStudyJournal(connection, persisted.studyJournal||[], nextState.studyJournal||[]);
      await syncCorpus(connection, persisted.corpus||[], nextState.corpus||[]);
      await connection.commit();
      persisted = structuredClone(nextState);
      migrationPending = false;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  return { pool, load, persist, get migrationPending() { return migrationPending; } };
}

async function deleteMissing(connection, table, previous, current, key = row => row.id) {
  const currentIds = new Set(current.map(key));
  const deleted = previous.map(key).filter(id => !currentIds.has(id));
  if (deleted.length) await connection.query(`DELETE FROM ${table} WHERE id IN (?)`, [deleted]);
}

async function syncCorpus(connection, previous, current) {
  await deleteMissing(connection, 'corpus_entries', previous, current);
  const old = mapBy(previous, row=>row.id);
  for (const row of current) if (rowChanged(old.get(row.id),row)) {
    await connection.execute(`INSERT INTO corpus_entries(id,owner_id,payload_json,created_at,updated_at) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE payload_json=VALUES(payload_json),updated_at=VALUES(updated_at)`,[row.id,row.ownerId,json(row),date(row.createdAt),date(row.updatedAt)]);
  }
}

async function syncUsers(connection, previous, current) {
  await deleteMissing(connection, 'users', previous, current);
  const old = mapBy(previous, row => row.id);
  for (const row of current) if (rowChanged(old.get(row.id), row)) {
    await connection.execute(`INSERT INTO users(id,username,username_key,role,status,password_salt,password_hash,starter_initialized,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE username=VALUES(username),username_key=VALUES(username_key),status=VALUES(status),password_salt=VALUES(password_salt),password_hash=VALUES(password_hash),starter_initialized=VALUES(starter_initialized),updated_at=VALUES(updated_at)`,
      [row.id,row.name,row.nameKey,'user',row.status || 'active',row.salt,row.passwordHash,row.starterInitialized?1:0,date(row.createdAt),new Date()]);
  }
}

async function syncSessions(connection, previous, current) {
  await deleteMissing(connection, 'sessions', previous, current);
  const old = mapBy(previous, row => row.id);
  for (const row of current) if (rowChanged(old.get(row.id), row)) {
    await connection.execute(`INSERT INTO sessions(id,token_hash,user_id,role,display_name,expires_at,revoked_at,created_at)
      VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE expires_at=VALUES(expires_at),revoked_at=VALUES(revoked_at)`,
      [row.id,row.tokenHash,row.userId || null,row.role,row.name,date(row.expiresAt),nullableDate(row.revokedAt),date(row.createdAt)]);
  }
}

async function syncVocabulary(connection, previous, current) {
  await deleteMissing(connection, 'vocabulary_entries', previous, current);
  const old = mapBy(previous, row => row.id);
  for (const row of current) if (rowChanged(old.get(row.id), row)) {
    await connection.execute(`INSERT INTO vocabulary_entries
      (id,owner_id,zh,en,normalized_zh,normalized_en,track,part_of_speech,pronunciation,meanings_json,accepted_json,examples_json,chapter_name,difficulty,frequency_rank,tags_json,source_name,source_url,license_code,attribution,review_status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE
      zh=VALUES(zh),en=VALUES(en),normalized_zh=VALUES(normalized_zh),normalized_en=VALUES(normalized_en),track=VALUES(track),part_of_speech=VALUES(part_of_speech),pronunciation=VALUES(pronunciation),meanings_json=VALUES(meanings_json),accepted_json=VALUES(accepted_json),examples_json=VALUES(examples_json),chapter_name=VALUES(chapter_name),difficulty=VALUES(difficulty),frequency_rank=VALUES(frequency_rank),tags_json=VALUES(tags_json),source_name=VALUES(source_name),source_url=VALUES(source_url),license_code=VALUES(license_code),attribution=VALUES(attribution),review_status=VALUES(review_status),updated_at=VALUES(updated_at)`,
      [row.id,row.ownerId||null,row.zh,row.en||null,normalize(row.zh),normalize(row.en)||null,row.track||'general',row.partOfSpeech||null,row.pronunciation||null,json(row.meanings||[]),json({zh:row.acceptedZh||[],en:row.acceptedEn||[]}),json({zh:row.exampleZh||'',en:row.exampleEn||''}),row.chapter||null,row.difficulty||1,row.frequencyRank||null,json(row.tags||[]),row.source||null,row.sourceUrl||null,row.license||null,row.attribution||null,row.reviewStatus || (row.needsReview ? 'needs-review' : 'approved'),date(row.createdAt),new Date()]);
  }
}

async function syncBanks(connection, previous, current) {
  await deleteMissing(connection, 'question_banks', previous, current);
  const old = mapBy(previous, row => row.id);
  for (const row of current) if (rowChanged(old.get(row.id), row)) {
    await connection.execute(`INSERT INTO question_banks
      (id,owner_id,title,track,category_name,module_code,course_name,unit_name,exam_year,difficulty,visibility,status,source_document_id,source_name,source_text,version_no,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE owner_id=VALUES(owner_id),title=VALUES(title),track=VALUES(track),category_name=VALUES(category_name),module_code=VALUES(module_code),course_name=VALUES(course_name),unit_name=VALUES(unit_name),exam_year=VALUES(exam_year),difficulty=VALUES(difficulty),visibility=VALUES(visibility),status=VALUES(status),source_document_id=VALUES(source_document_id),source_name=VALUES(source_name),source_text=VALUES(source_text),version_no=VALUES(version_no),updated_at=VALUES(updated_at)`,
      [row.id,row.ownerId||null,row.title,row.track||'general',row.category||'',row.module||'general',row.course||null,row.unit||null,row.year||null,row.difficulty||'mixed',row.visibility||'private',row.status||'published',row.sourceDocumentId||null,row.sourceName||null,row.sourceText||null,row.version||1,date(row.createdAt),new Date()]);
    await connection.execute('DELETE FROM questions WHERE bank_id=?',[row.id]);
    for (let index=0; index<(row.questions||[]).length; index++) {
      const q=row.questions[index], known=new Set(['id','type','question','options','answer','blanks','rubric','explanation','points','groupId','materialTitle','materialText','reviewStatus','generatedBy','sourceLocator']), extra={};
      for(const [key,value] of Object.entries(q))if(!known.has(key))extra[key]=value;
      await connection.execute(`INSERT INTO questions
        (id,bank_id,position_no,type,prompt,options_json,answer_json,blanks_json,rubric,explanation,points,group_id,material_title,material_text,review_status,generated_by,source_locator,extra_json,created_at,updated_at)
        VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [q.id||stableId(row.id,index),row.id,index,q.type,q.question,json(q.options||[]),json(q.answer),json(q.blanks||[]),q.rubric||null,q.explanation||null,q.points||1,q.groupId||null,q.materialTitle||null,q.materialText||null,q.reviewStatus||'approved',q.generatedBy||null,q.sourceLocator||null,json(extra),new Date(),new Date()]);
    }
  }
}

async function syncExams(connection, previous, current) {
  await deleteMissing(connection, 'exams', previous, current);
  const old=mapBy(previous,row=>row.id);
  for(const row of current)if(rowChanged(old.get(row.id),row)){
    await connection.execute(`INSERT INTO exams(id,bank_id,user_id,candidate_name,title,track,module_code,blueprint_json,draft_answers_json,started_at,submitted_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE bank_id=VALUES(bank_id),title=VALUES(title),blueprint_json=VALUES(blueprint_json),draft_answers_json=VALUES(draft_answers_json),submitted_at=VALUES(submitted_at)`,
      [row.id,row.bankId||null,row.candidateId,row.candidateName,row.title,row.track||'general',row.module||'general',json(row.blueprint||{}),json(row.draftAnswers||{}),date(row.createdAt),nullableDate(row.completedAt)]);
    await connection.execute('DELETE FROM exam_items WHERE exam_id=?',[row.id]);
    for(let index=0;index<(row.questions||[]).length;index++)await connection.execute('INSERT INTO exam_items(id,exam_id,position_no,source_question_id,question_snapshot_json) VALUES(?,?,?,?,?)',[stableId(row.id,index),row.id,index,row.questions[index].id||null,json(row.questions[index])]);
  }
}

async function syncAttempts(connection, previous, current) {
  await deleteMissing(connection,'attempts',previous,current);
  const old=mapBy(previous,row=>row.id);
  for(const row of current)if(rowChanged(old.get(row.id),row))await connection.execute(`INSERT INTO attempts
    (id,exam_id,bank_id,user_id,candidate_name,track,score,max_score,answers_json,results_json,questions_json,submitted_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE bank_id=VALUES(bank_id),score=VALUES(score),max_score=VALUES(max_score),answers_json=VALUES(answers_json),results_json=VALUES(results_json),questions_json=VALUES(questions_json),submitted_at=VALUES(submitted_at)`,
    [row.id,row.examId,row.quizId||null,row.candidateId,row.candidateName,row.track||'general',row.score,row.maxScore,json(row.answers||{}),json(row.results||[]),json(row.questions||[]),date(row.createdAt)]);
}

async function syncCollections(connection, previous, current){
  await deleteMissing(connection,'word_collections',previous,current);
  const old=mapBy(previous,row=>row.id);
  for(const row of current)if(rowChanged(old.get(row.id),row))await connection.execute(`INSERT INTO word_collections(id,user_id,name,track,created_at) VALUES(?,?,?,?,?) ON DUPLICATE KEY UPDATE name=VALUES(name),track=VALUES(track)`,[row.id,row.candidateId,row.name,row.track||'general',date(row.createdAt)]);
}

async function syncCollectionItems(connection, previous, current){
  const key=row=>`${row.collectionId}:${row.wordId}`,old=mapBy(previous,key),now=mapBy(current,key);
  for(const [id,row] of old)if(!now.has(id))await connection.execute('DELETE FROM word_collection_items WHERE collection_id=? AND vocabulary_id=?',[row.collectionId,row.wordId]);
  for(const [id,row] of now)if(!old.has(id))await connection.execute('INSERT IGNORE INTO word_collection_items(collection_id,vocabulary_id,created_at) VALUES(?,?,?)',[row.collectionId,row.wordId,date(row.createdAt)]);
}

async function syncWordReviews(connection, previous, current){
  const key=row=>`${row.candidateId}:${row.wordId}`,old=mapBy(previous,key),now=mapBy(current,key);
  for(const [id,row] of old)if(!now.has(id))await connection.execute('DELETE FROM word_reviews WHERE user_id=? AND vocabulary_id=?',[row.candidateId,row.wordId]);
  for(const [id,row] of now)if(rowChanged(old.get(id),row))await connection.execute(`INSERT INTO word_reviews(user_id,vocabulary_id,correct_count,wrong_count,streak,status,ease_factor,interval_days,due_at,last_reviewed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE correct_count=VALUES(correct_count),wrong_count=VALUES(wrong_count),streak=VALUES(streak),status=VALUES(status),ease_factor=VALUES(ease_factor),interval_days=VALUES(interval_days),due_at=VALUES(due_at),last_reviewed_at=VALUES(last_reviewed_at)`,
    [row.candidateId,row.wordId,row.correct||0,row.wrong||0,row.streak||0,row.status||'new',row.easeFactor||2.5,row.intervalDays||0,nullableDate(row.dueAt),nullableDate(row.lastReviewedAt)]);
}

async function syncTranslations(connection, previous, current){
  await deleteMissing(connection,'translation_history',previous,current);
  const old=mapBy(previous,row=>row.id);
  for(const row of current)if(rowChanged(old.get(row.id),row))await connection.execute(`INSERT INTO translation_history
    (id,user_id,candidate_name,source_text,source_requested,detected_source,targets_json,translations_json,provider,track,review_status,cached_from,reviewed_at,created_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE translations_json=VALUES(translations_json),review_status=VALUES(review_status),reviewed_at=VALUES(reviewed_at)`,
    [row.id,row.candidateId,row.candidateName,row.text,row.sourceRequested||'auto',row.source||null,json(row.targets||[]),json(row.translations||{}),row.provider,row.track||'general',row.status||'machine',row.cachedFrom||null,nullableDate(row.reviewedAt),date(row.createdAt)]);
}

async function syncStudyJournal(connection,previous,current){
  await deleteMissing(connection,'study_journal',previous,current);
  const old=mapBy(previous,row=>row.id);
  for(const row of current)if(rowChanged(old.get(row.id),row))await connection.execute(`INSERT INTO study_journal(id,user_id,track,module_code,prompt_text,response_text,notes_text,created_at) VALUES(?,?,?,?,?,?,?,?) ON DUPLICATE KEY UPDATE prompt_text=VALUES(prompt_text),response_text=VALUES(response_text),notes_text=VALUES(notes_text)`,[row.id,row.candidateId,row.track,row.module,row.prompt||'',row.response||'',row.notes||'',date(row.createdAt)]);
}
