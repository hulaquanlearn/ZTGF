import express from 'express';

const categories = ['reading', 'listening', 'writing', 'speaking'];
export function validateCorpus(body) {
  const fields = { title: 200, content: 50000, translation: 50000, examples: 20000, tags: 500, source: 2000, notes: 20000 };
  const row = { category: body.category };
  if (!categories.includes(row.category)) throw new Error('请选择阅读、听力、写作或口语');
  for (const [key, max] of Object.entries(fields)) {
    if (body[key] != null && typeof body[key] !== 'string') throw new Error('语料字段必须是文字');
    row[key] = String(body[key] || '').trim();
    if (row[key].length > max) throw new Error(`${key === 'title' ? '标题' : '内容'}过长`);
  }
  if (!row.title || !row.content) throw new Error('请填写标题和语料内容');
  return row;
}
export function corpusRouter(store) {
  const router = express.Router();
  const run = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);
  router.get('/', (req, res) => {
    if (req.query.category && !categories.includes(req.query.category)) return res.status(400).json({ error: '分类无效' });
    const q = String(req.query.q || '').toLowerCase();
    res.json(store.listCorpus(req.account.id).filter(row => (!req.query.category || row.category === req.query.category) && (!q || [row.title, row.content, row.translation, row.tags].join(' ').toLowerCase().includes(q))));
  });
  router.get('/:id', (req, res) => {
    const row = store.getCorpus(req.params.id, req.account.id);
    if (!row) return res.status(404).json({ error: '语料不存在' });
    res.json(row);
  });
  router.post('/', run(async (req, res) => {
    let body; try { body = validateCorpus(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
    const row = store.addCorpus(req.account.id, body); await store.flush(); res.status(201).json(row);
  }));
  router.put('/:id', run(async (req, res) => {
    const previous = store.getCorpus(req.params.id, req.account.id);
    if (!previous) return res.status(404).json({ error: '语料不存在' });
    if (!req.body.updatedAt || req.body.updatedAt !== previous.updatedAt) return res.status(409).json({ error: '语料已在其他窗口更新，请重新打开后编辑' });
    let body; try { body = validateCorpus(req.body); } catch (e) { return res.status(400).json({ error: e.message }); }
    const row = store.updateCorpus(req.params.id, req.account.id, body); await store.flush(); res.json(row);
  }));
  router.delete('/:id', run(async (req, res) => {
    if (!store.deleteCorpus(req.params.id, req.account.id)) return res.status(404).json({ error: '语料不存在' });
    await store.flush(); res.json({ ok: true });
  }));
  return router;
}
