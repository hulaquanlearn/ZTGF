import { spawn } from 'node:child_process';
import { once } from 'node:events';
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'quizforge-smoke-v6-'));
const probe = net.createServer(); probe.listen(0, '127.0.0.1'); await once(probe, 'listening');
const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
const base = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['src/server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', DATA_DIR: path.join(temporary, 'data'), UPLOAD_DIR: path.join(temporary, 'uploads'), APP_USERNAME: 'smoke-account', APP_PASSWORD: 'smoke-private-password', ADMIN_USERNAME: '', ADMIN_PASSWORD: '', DB_HOST: '', DB_NAME: '', DB_USER: '', AUTO_SEED_VOCABULARY: '1', TRANSLATION_PROVIDER: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = ''; child.stdout.on('data', chunk => output += chunk); child.stderr.on('data', chunk => output += chunk);
const exited = once(child, 'exit');
const check = (condition, message) => { if (!condition) throw new Error(message); };
try {
  let health;
  for (let index = 0; index < 100; index++) {
    if (child.exitCode !== null) throw new Error(`服务提前退出：${output.slice(-1500)}`);
    try { const response = await fetch(`${base}/api/health`); if (response.ok) { health = await response.json(); break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  check(health?.accountMode === 'unified', `服务未正确启动：${output.slice(-1500)}`);
  const page = await (await fetch(`${base}/`)).text();
  check(page.includes('/workspace.js') && page.includes('/app.css') && page.includes('href="/banks"') && page.includes('href="/english"') && page.includes('href="/ielts"') && page.includes('href="/corpus"'), '新版界面资源缺失');
  check((await fetch(`${base}/workspace.js`)).ok && (await fetch(`${base}/app.css`)).ok, '界面文件无法加载');
  check((await fetch(`${base}/api/banks`)).status === 401, '匿名请求未被拒绝');
  const session = await (await fetch(`${base}/api/account/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'smoke-account', password: 'smoke-private-password' }) })).json();
  check(session.token && !Object.hasOwn(session, 'role'), '统一账号登录失败');
  const headers = { 'Content-Type': 'application/json', 'x-session-token': session.token };
  const words = await (await fetch(`${base}/api/vocabulary?browse=1&track=english`, { headers })).json();
  check(words.length >= 20, '英语基础词库未加载');
  const starterBanks = await (await fetch(`${base}/api/banks`, { headers })).json();
  check(starterBanks.some(bank => bank.track === 'english') && starterBanks.some(bank => bank.track === 'ielts'), '基础学习题库未初始化');
  const created = await fetch(`${base}/api/banks`, { method: 'POST', headers, body: JSON.stringify({ title: '任意科目冒烟检查', category: '职业技能', questions: [{ type: 'boolean', question: '规则判分正常。', answer: true }] }) });
  check(created.status === 201, '自定义题库新增失败'); const bank = await created.json();
  const generated = await fetch(`${base}/api/banks/${bank.id}/random-exam`, { method: 'POST', headers, body: JSON.stringify({ boolean: 1 }) }); check(generated.status === 201, '随机练习生成失败');
  const exam = await generated.json();
  const paper = await (await fetch(`${base}/api/exams/${exam.id}`, { headers })).json(); check(!Object.hasOwn(paper.questions[0], 'answer'), '试卷泄漏答案');
  const submitted = await (await fetch(`${base}/api/exams/${exam.id}/submit`, { method: 'POST', headers, body: JSON.stringify({ answers: { 0: true } }) })).json(); check(submitted.score === 100, '规则判分失败');
  check((await fetch(`${base}/api/admin/quizzes`, { headers })).status === 410, '旧分级接口未关闭');
  console.log(JSON.stringify({ ok: true, health, unifiedAccount: true, customBanks: true, randomPractice: true, deterministicScoring: true, starterBanks: starterBanks.length, englishWords: words.length }));
} finally {
  if (child.exitCode === null) { child.kill('SIGTERM'); await exited; }
  fs.rmSync(temporary, { recursive: true, force: true });
}
