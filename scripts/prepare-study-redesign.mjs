import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
const [baseline,out]=process.argv.slice(2);if(!baseline||!out)throw Error('Usage: node scripts/prepare-study-redesign.mjs BASELINE_DIR OUTPUT_DIR');
const read=p=>fs.readFileSync(p,'utf8'),hash=v=>crypto.createHash('sha256').update(v).digest('hex');
const original=read(path.join(baseline,'public/workspace.js')),local=read('public/workspace.js');let code=original;
function block(s,start,end){const a=s.indexOf(start),b=s.indexOf(end,a+start.length);assert(a>=0&&b>a,start);return s.slice(a,b);}
const changes=[];function swap(a,b){assert(code.includes(a),a.slice(0,80));const at=code.indexOf(a);code=code.slice(0,at)+b+code.slice(at+a.length);changes.push({before:a.slice(0,90),after:b.slice(0,90)});}
for(const [start,end]of [['function pageContext(','\n$(\'#navToggle\')'],['async function login()','\nfunction bankCard'],['const lookup=','\nasync function banks()'],['async function english(','\nfunction practiceFormHtml'],['async function route()','\ndocument.addEventListener']])swap(block(code,start,end),block(local,start,end));
swap("import {showLookup}","import {mountQuery}");
swap('|review(?:\\/|$)|results$','|review(?:\\/|$)|query$|vocabulary$|results$');
code=code.replaceAll('20261022-navigation','20261023-design').replaceAll('20261022-study','20261023-design');
fs.mkdirSync(path.join(out,'public'),{recursive:true});fs.mkdirSync(path.join(out,'src'),{recursive:true});fs.writeFileSync(path.join(out,'public/workspace.js'),code);
let server=read(path.join(baseline,'src/server.js'));assert(server.includes('lookupRouter(store)'));server=server.replace('(?:login|me|review','(?:login|query|vocabulary|me|review');fs.writeFileSync(path.join(out,'src/server.js'),server);fs.copyFileSync('src/lookup.js',path.join(out,'src/lookup.js'));
fs.writeFileSync(path.join(out,'public/index.html'),read('public/index.html').replace(/<a href="\/data" id="accountDataLink">数据管理<\/a>/,''));
for(const file of ['learning-home.js','profile.js','lookup.js','query.css','home.css','login.css','app.css','redesign.css','refinements.css','workbench.css','navigation-layout.css','theme.css','android-release.json','android/index.html','android/quizforge-android-1.0.5.apk','assets/login-paper-grid.webp']){fs.mkdirSync(path.dirname(path.join(out,'public',file)),{recursive:true});fs.copyFileSync(path.join('public',file),path.join(out,'public',file));}
fs.cpSync('public/icons',path.join(out,'public/icons'),{recursive:true});
const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):[path.join(dir,e.name)]);
const files=walk(out).filter(p=>!['SHA256SUMS','baseline.json'].includes(path.basename(p))).map(p=>({file:path.relative(out,p).replaceAll('\\','/'),sha256:hash(fs.readFileSync(p))}));
fs.writeFileSync(path.join(out,'SHA256SUMS'),files.map(x=>x.sha256+'  '+x.file).join('\n')+'\n');
fs.writeFileSync(path.join(out,'baseline.json'),JSON.stringify({workspace:hash(original),server:hash(read(path.join(baseline,'src/server.js'))),changes},null,2));console.log({files:files.length,reviewedBlocks:changes.length});
