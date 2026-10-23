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
  for (let index = 0; index < 400; index++) {
    if (child.exitCode !== null) throw new Error(`服务提前退出：${output.slice(-1500)}`);
    try { const response = await fetch(`${base}/api/health`); if (response.ok) { health = await response.json(); break; } } catch {}
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  check(health?.accountMode === 'unified', `服务未正确启动：${output.slice(-1500)}`);
  const appVersionResponse = await fetch(`${base}/api/app-version`);
  const appVersion = await appVersionResponse.json();
  check(appVersionResponse.ok && /^[a-f0-9]{64}$/.test(appVersion.webRevision) && appVersionResponse.headers.get('cache-control') === 'no-store', '安卓在线版本检测不可用');
  const androidPage = await fetch(`${base}/android/`);
  check(androidPage.ok && (await androidPage.text()).includes('/android/install.js'), '安卓下载页不可用');
  if (appVersion.android) {
    const apk = await fetch(`${base}${appVersion.android.apkPath}`);
    check(apk.ok && (await apk.arrayBuffer()).byteLength > 10000, '已发布的安卓安装包无法下载');
  }
  const page = await (await fetch(`${base}/`)).text();
  check(page.includes('/workspace.js') && page.includes('/app.css') && page.includes('href="/query"') && page.includes('href="/me"'), '新版界面资源缺失');
  check((await fetch(`${base}/workspace.js`)).ok && (await fetch(`${base}/app.css`)).ok, '界面文件无法加载');
  for(const asset of ['workbench.css','standby-calculator.js','learning-home.js','lookup.js','icons/search.svg','query.css','assets/login-paper-grid.webp'])check((await fetch(`${base}/${asset}`)).ok,'改版资源无法加载：'+asset);
  check((await fetch(`${base}/flights/standby`)).ok&&page.includes('id="accountMenu"'),'工具或账号菜单缺失');
  check(page.includes('id="siteHeader"')&&!page.includes('id="sidebar"')&&page.includes('雅思工坊'),'顶部导航改版未包含在服务中');
  check((await fetch(`${base}/api/banks`)).status === 401, '匿名请求未被拒绝');
  const session = await (await fetch(`${base}/api/account/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'smoke-account', password: 'smoke-private-password' }) })).json();
  check(session.token && !Object.hasOwn(session, 'role'), '统一账号登录失败');
  const headers = { 'Content-Type': 'application/json', 'x-session-token': session.token };
  const flights=[{id:'a',number:'NX632',from:'MFM',to:'TPE',departure:'0800',arrival:'0935',days:'1234567',start:'2026-10-25',end:'2027-03-27',fromZone:'Asia/Shanghai',toZone:'Asia/Shanghai'},{id:'b',number:'NX631',from:'TPE',to:'MFM',departure:'1035',arrival:'1235',days:'1234567',start:'2026-10-25',end:'2027-03-27',fromZone:'Asia/Shanghai',toZone:'Asia/Shanghai'}];
  const pairs=[{outId:'a',backId:'b',returnDays:0,outOpening:'0650'}];
  const flightPreview=await (await fetch(`${base}/api/flights/preview`,{method:'POST',headers,body:JSON.stringify({flights,pairs,mode:'season'})})).json();
  check(flightPreview.rows?.length===2&&flightPreview.headers?.[6]==='离港时间（北京时间）'&&flightPreview.rows[0][5]==='0650','整季航班九列与人工开会时间预览失败');
  const draftId='a1234567-1234-4321-9876-123456789012',draftUrl=`${base}/api/flights/drafts/${draftId}`;
  const draftSaved=await fetch(draftUrl,{method:'PUT',headers,body:JSON.stringify({revision:0,title:'隔离草稿检查',data:{flights,start:'2026-10-25',sourceName:'smoke'},pairs,excluded:[],reviewed:[],mode:'season'})});
  check(draftSaved.ok,'航班草稿落盘失败');
  const draftRestored=await (await fetch(draftUrl,{headers})).json();check(draftRestored.revision===1&&draftRestored.pairs?.length===1,'航班草稿恢复失败');
  const standbySource=await (await fetch(`${base}/api/flights/standby/from-timetable`,{method:'POST',headers,body:JSON.stringify({flights,pairs,mode:'season'})})).json();check(standbySource.duties?.length===1,'时刻表无法送入备份分析');
  const standbyPayload={duties:standbySource.duties};const standbyReport=await (await fetch(`${base}/api/flights/standby/analyze`,{method:'POST',headers,body:JSON.stringify(standbyPayload)})).json();check(standbyReport.selected?.covered===1&&standbyReport.goal?.achieved&&standbyReport.taskLimits?.turnaround===840&&standbyReport.taskLimits?.layover===540&&standbyReport.proposal.schemes.map(s=>s.shifts.length).join(',')==='4,5,6','全覆盖目标、方案数量或 14／9 小时规则不一致');
  for(const format of ['xlsx','docx']){const exported=await fetch(`${base}/api/flights/standby/export/${format}`,{method:'POST',headers,body:JSON.stringify(standbyPayload)});check(exported.ok&&(await exported.arrayBuffer()).byteLength>1000,'备份文件导出失败：'+format);}
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
  console.log(JSON.stringify({ ok: true, health, topNavigation:true,seasonFlights:true,persistentFlightDrafts:true,unifiedAccount: true, customBanks: true, randomPractice: true, deterministicScoring: true, starterBanks: starterBanks.length, englishWords: words.length }));
} finally {
  if (child.exitCode === null) { child.kill('SIGTERM'); await exited; }
  fs.rmSync(temporary, { recursive: true, force: true });
}
