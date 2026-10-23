import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

function fixture(handler=()=>[]) {
  const html=fs.readFileSync(new URL('../public/index.html',import.meta.url),'utf8');
  const dom=new JSDOM(html,{url:'http://example.test/banks',runScripts:'outside-only'}),win=dom.window,calls=[],downloads=[];
  win.sessionStorage.setItem('quizforge-session-token','isolated-session');
  win.sessionStorage.setItem('quizforge-candidate-name','界面测试');
  win.Headers=Headers;win.structuredClone=structuredClone;win.scrollTo=()=>{};
  win.matchMedia=()=>({matches:false,addEventListener(){},removeEventListener(){}});
  win.HTMLElement.prototype.scrollIntoView=()=>{};
  win.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  win.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new win.Event('close'));};
  win.confirm=()=>true;
  win.fetch=async(url,options={})=>{calls.push({url,options});const value=await handler(url,options);return value instanceof Response?value:{ok:true,json:async()=>value};};
  win.downloadFile=async(url,name)=>downloads.push({url,name});
  win.showData=async({app})=>{app.innerHTML='<section data-manager>数据管理</section>';};
  win.showFlights=async({app})=>{app.innerHTML='<section data-flight-draft>航班草稿</section>';return ()=>{};};
  win.bindPasswordVisibility=()=>{};
  win.eval(fs.readFileSync(new URL('../public/lookup.js',import.meta.url),'utf8').replace(/export (async )?function /g,'$1function ')+'\nwindow.mountQuery=mountQuery;');
  win.eval(fs.readFileSync(new URL('../public/learning-home.js',import.meta.url),'utf8').replace('export function mountLearningHome','function mountLearningHome')+'\nwindow.mountLearningHome=mountLearningHome;');
  win.eval(fs.readFileSync(new URL('../public/profile.js',import.meta.url),'utf8').replace('export function mountProfile','function mountProfile')+'\nwindow.mountProfile=mountProfile;');
  const source=fs.readFileSync(new URL('../public/workspace.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/^route\(\);\r?$/m,'');
  win.eval(source+'\nwindow.workbench={api,status,bindForm,bankDetail,importPage,renderImportPreview,practiceFormHtml,bindPractice,dictionary,vocabularyImport,reimportData,go,route};');
  return {dom,win,app:win.document.querySelector('#app'),calls,downloads,close:()=>dom.window.close()};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

test('词汇页保留选择与拼写学习，首页没有品牌、查询或重复工具',async()=>{
  const view=fixture(url=>url==='/api/vocabulary/practice-options?track=ielts'?{available:30,maxPerExam:30}:[]);
  try{
    await view.win.workbench.go('/');assert.equal(view.app.querySelector('#homeLookup'),null);assert.equal(view.win.document.querySelector('#siteHeader .brand'),null);assert.equal(view.app.querySelector('.learning-primary').textContent,'词汇开始学习');
    assert.deepEqual([...view.app.querySelectorAll('.learning-resources a')].map(a=>a.textContent),['题库','语料','复习']);
    await view.win.workbench.go('/vocabulary');await settle();const form=view.app.querySelector('#vocabularyPractice');assert.equal(form.elements.track.value,'ielts');assert.equal(form.elements.mode.value,'choice');
    view.app.querySelector('[data-mode="spell"]').click();assert.equal(form.elements.mode.value,'spell');assert.equal(form.elements.direction.value,'zh-en');assert.ok(view.app.querySelector('a[href="/english/collections"]'));
  }finally{view.close();}
});

test('底栏覆盖雅思模块、语料和集中复习，首页没有宣传横幅或职业考试',async()=>{
  const view=fixture(url=>url==='/api/study/today'?{}:[]);
  try {
    assert.deepEqual([...view.win.document.querySelectorAll('#mobileNav a')].map(a=>a.textContent),['学习','查询','我的']);
    for(const [route,group] of [['/','home'],['/english','home'],['/ielts/writing','home'],['/corpus','home'],['/banks','home'],['/review','home'],['/review/wrong','home'],['/query','query'],['/me','me'],['/data','me']]){
      await view.win.workbench.go(route);
      assert.equal(view.win.document.querySelector('#mobileNav [aria-current="page"]').dataset.section,group,route);
      assert.equal(view.win.document.querySelector('#pageBack').classList.contains('hidden'),['/','/query','/me'].includes(view.win.location.pathname),route+' return control');
    }
    await view.win.workbench.go('/');assert.equal(view.app.querySelector('.home-hero'),null);assert.ok(view.app.querySelector('.learning-workspace'));assert.ok(view.app.querySelector('.learning-resources a[href="/corpus"]'));assert.equal(view.app.textContent.includes('系统集成'),false);
  }finally{view.close();}
});

test('个人中心兼容旧App更新操作，过滤低频操作且退出时清除监听与会话',async()=>{
  const view=fixture();
  try {
    let updateClicks=0;
    const source=view.win.document.createElement('div');source.className='native-app-actions';
    source.innerHTML=['reload','credentials','update','server','browser','about'].map(action=>`<button data-native-action="${action}">${action}</button>`).join('');
    view.win.document.querySelector('#accountMenu .account-dropdown').append(source);
    source.querySelector('[data-native-action="update"]').onclick=()=>updateClicks++;
    await view.win.workbench.go('/me');
    assert.deepEqual([...view.app.querySelectorAll('[data-legacy-action]')].map(b=>b.dataset.legacyAction),['update','server','about']);
    view.app.querySelector('[data-legacy-action="update"]').click();assert.equal(updateClicks,1);
    const reload=source.querySelector('[data-native-action="reload"]');reload.dataset.available='true';await settle();assert.equal(view.app.querySelector('[data-legacy-action="reload"]').textContent,'加载新内容');
    await view.win.workbench.go('/banks');source.append(view.win.document.createElement('span'));await settle();assert.equal(view.app.querySelector('#profileAppActions'),null);
    await view.win.workbench.go('/me');view.app.querySelector('#profileLogout').click();await settle();assert.equal(view.win.location.pathname,'/login');assert.equal(view.win.sessionStorage.getItem('quizforge-session-token'),null);assert.ok(view.win.document.querySelector('#mobileNav').classList.contains('hidden'));
  }finally{view.close();}
});

test('同类菜单切换保持新菜单展开，点击外部和 Escape 均关闭菜单',async()=>{
  const view=fixture();
  try{
    const errors=[];view.win.addEventListener('error',event=>errors.push(event.error));
    view.app.innerHTML='<details class="row-menu"><summary>第一个菜单</summary><div><button>下载</button></div></details><details class="export-menu"><summary>第二个菜单</summary><div class="actions"><button>导出</button></div></details><button id="outsideMenu">页面其他操作</button>';
    const first=view.app.querySelector('.row-menu'),second=view.app.querySelector('.export-menu');
    first.querySelector('summary').click();await settle();assert.equal(first.open,true);
    second.querySelector('summary').click();await settle();assert.equal(first.open,false);assert.equal(second.open,true);
    view.win.document.dispatchEvent(new view.win.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(second.open,false);
    first.querySelector('summary').click();await settle();view.app.querySelector('#outsideMenu').click();
    assert.equal(first.open,false);assert.equal(view.calls.length,0);assert.deepEqual(errors,[]);
  }finally{view.close();}
});

test('真实表单提交禁用所有提交入口，成功及接口失败后恢复并显示状态',async()=>{
  let release,requestNumber=0;
  const view=fixture(url=>{
    assert.equal(url,'/api/test-submit');
    return ++requestNumber===1?new Promise(resolve=>{release=resolve;}):new Response(JSON.stringify({error:'资料不能为空'}),{status:400,headers:{'Content-Type':'application/json'}});
  });
  try {
    view.app.innerHTML='<form id="saveForm"><input name="title" value="待保存资料" required><button type="submit" id="topSubmit">保存</button><button id="defaultSubmit">保存底部</button><input type="submit" id="inputSubmit" value="保存"><button type="button" id="cancel">取消</button><p data-status aria-live="polite"></p></form>';
    const form=view.app.querySelector('form'),submits=['topSubmit','defaultSubmit','inputSubmit'].map(id=>form.querySelector('#'+id));
    view.win.workbench.bindForm(form,async(fd,currentForm)=>{
      const result=await view.win.workbench.api('/api/test-submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.fromEntries(fd))});
      view.win.workbench.status(currentForm,result.message);
    });
    submits[0].click();
    assert.ok(submits.every(button=>button.disabled));assert.equal(form.querySelector('#cancel').disabled,false);
    submits[1].click();submits[2].click();assert.equal(requestNumber,1,'disabled submit controls cannot duplicate the request');
    assert.equal(JSON.parse(view.calls[0].options.body).title,'待保存资料');
    release({message:'保存成功'});await settle();
    assert.ok(submits.every(button=>!button.disabled));assert.equal(form.querySelector('[data-status]').textContent,'保存成功');assert.equal(form.querySelector('[data-status]').className,'success');
    submits[1].click();await settle();
    assert.equal(requestNumber,2);assert.ok(submits.every(button=>!button.disabled));
    assert.equal(form.querySelector('[data-status]').textContent,'资料不能为空');assert.equal(form.querySelector('[data-status]').className,'form-error');
  } finally {view.close();}
});

test('真实登录提交发送账号密码，成功写入会话并进入首页',async()=>{
  let release;
  const view=fixture(url=>url==='/api/account/login'?new Promise(resolve=>{release=resolve;}):url==='/api/study/today'?{dueWords:0}:[]);
  try {
    view.win.sessionStorage.removeItem('quizforge-session-token');await view.win.workbench.go('/login');
    const form=view.app.querySelector('#loginForm'),button=form.querySelector('[type="submit"]');
    form.elements.username.value='local-review';form.elements.password.value='local-review-password';button.click();
    assert.equal(button.disabled,true);assert.equal(view.calls.length,1);assert.equal(view.calls[0].url,'/api/account/login');
    assert.equal(view.calls[0].options.method,'POST');assert.deepEqual(JSON.parse(view.calls[0].options.body),{username:'local-review',password:'local-review-password'});
    release({token:'authenticated-test-token',name:'本地验收账号'});await settle();
    assert.equal(view.win.sessionStorage.getItem('quizforge-session-token'),'authenticated-test-token');
    assert.equal(view.win.sessionStorage.getItem('quizforge-candidate-name'),'本地验收账号');assert.equal(view.win.location.pathname,'/');
    assert.equal(view.app.querySelector('#loginForm'),null);assert.equal(view.app.querySelector('h1').textContent,'学习');
    assert.equal(view.win.document.querySelector('#siteHeader').classList.contains('hidden'),false);
    assert.ok(view.calls.filter(call=>call.url!=='/api/account/login').every(call=>call.options.headers.get('x-session-token')==='authenticated-test-token'));
  } finally {view.close();}
});

test('登录失败保留输入，显示接口错误且允许再次提交',async()=>{
  const view=fixture(()=>new Response(JSON.stringify({error:'账号或密码错误'}),{status:401,headers:{'Content-Type':'application/json'}}));
  try {
    view.win.sessionStorage.removeItem('quizforge-session-token');await view.win.workbench.go('/login');
    const form=view.app.querySelector('#loginForm'),button=form.querySelector('[type="submit"]');
    form.elements.username.value='incorrect';form.elements.password.value='retry-password';button.click();await settle();
    assert.equal(button.disabled,false);assert.equal(form.querySelector('[data-status]').textContent,'账号或密码错误');
    assert.equal(form.querySelector('[data-status]').className,'form-error');assert.equal(form.elements.username.value,'incorrect');assert.equal(form.elements.password.value,'retry-password');
    assert.equal(view.win.location.pathname,'/login');assert.equal(view.win.sessionStorage.getItem('quizforge-session-token'),null);
  } finally {view.close();}
});

test('题库导出菜单的两种选择都生成真实下载请求',async()=>{
  const view=fixture(url=>url.endsWith('/questions')?{bank:{title:'考试资料',category:'自定义'},questions:[{type:'boolean',question:'检查导出',answer:true}]}:[]);
  try {
    await view.win.workbench.bankDetail('bank-1');
    assert.equal(view.app.querySelectorAll('details.export-menu').length,1);
    await view.app.querySelector('#exportBank').onclick();
    await view.app.querySelector('#exportBankAnswers').onclick();
    assert.deepEqual(view.downloads,[{url:'/api/banks/bank-1/export',name:'考试资料-题库.docx'},{url:'/api/banks/bank-1/export?answers=1',name:'考试资料-题库与答案.docx'}]);
  } finally {view.close();}
});

test('修改预览后的题库名称保留源文件关联，选择另一个文件清除旧预览',async()=>{
  let saved;
  const view=fixture((url,options)=>{if(url==='/api/import/confirm'){saved=JSON.parse(options.body);return {id:'new-bank',questionCount:1};}if(url.endsWith('/questions'))return {bank:{title:'改名后'},questions:[]};return [];});
  try {
    await view.win.workbench.importPage('ielts','reading');
    view.win.workbench.renderImportPreview({dataFileId:'original-file',title:'原名',questions:[{type:'boolean',question:'测试题',answer:true}]},{title:'原名',track:'ielts',module:'reading'});
    view.app.querySelector('[name="title"]').value='改名后';
    await view.app.querySelector('#saveImport').onclick({currentTarget:view.app.querySelector('#saveImport')});
    await settle();
    assert.equal(saved.title,'改名后');assert.equal(saved.dataFileId,'original-file');assert.equal(saved.module,'reading');
    await view.win.workbench.importPage();
    view.win.workbench.renderImportPreview({questions:[{type:'boolean',question:'旧文件预览',answer:true}]},{});
    view.app.querySelector('[name="file"]').dispatchEvent(new view.win.Event('change'));
    assert.equal(view.app.querySelector('#saveImport'),null);
  } finally {view.close();}
});

test('旧页面请求迟到时不会覆盖刚打开的数据管理页面',async()=>{
  let release;
  const view=fixture(url=>url==='/api/banks/slow/questions'?new Promise(resolve=>{release=resolve;}):[]);
  try {
    const previous=view.win.workbench.go('/bank/slow');
    await view.win.workbench.go('/data');
    release({bank:{title:'迟到的题库'},questions:[]});await previous;
    assert.equal(view.win.location.pathname,'/data');
    assert.ok(view.app.querySelector('[data-manager]'));
    assert.equal(view.app.textContent.includes('迟到的题库'),false);
  } finally {view.close();}
});

test('后台保存仍拒绝已切换账号会话的响应',async()=>{
  let release;
  const view=fixture(()=>new Promise(resolve=>{release=resolve;}));
  try {
    const pending=view.win.workbench.api('/api/flights/drafts/snapshot',{background:true,method:'PUT'});
    view.win.sessionStorage.setItem('quizforge-session-token','another-account-session');release({revision:2});
    await assert.rejects(pending,error=>error.code==='NAVIGATION_CHANGED');
  } finally {view.close();}
});

test('重导入保留学习方向、专项和自定义分类，词典按链接方向打开',async()=>{
  const view=fixture();
  try {
    await view.win.workbench.reimportData({name:'阅读资料.md',dataFileId:'retained-file',category:'ielts',sourceOptions:{title:'我的阅读',track:'ielts',module:'reading',category:'Section 1',mode:'extract'},questions:[{type:'boolean',question:'题目',answer:true}]});
    assert.equal(view.app.querySelector('[name="title"]').value,'我的阅读');
    assert.equal(view.app.querySelector('[name="module"]').value,'reading');
    assert.equal(view.app.querySelector('[name="category"]').value,'Section 1');
    assert.ok(view.app.querySelector('#saveImport'));
    view.win.history.replaceState(null,'','/english/dictionary?track=ielts');view.app.innerHTML='<div id="englishContent"></div>';
    await view.win.workbench.dictionary();assert.equal(view.app.querySelector('#wordTrack').value,'ielts');
    assert.ok(view.calls.some(call=>call.url==='/api/vocabulary?browse=1&track=ielts'));
  } finally {view.close();}
});

test('词汇预览能为缺失或不规范学习方向指定目标，并保留原文件标识',async()=>{
  let saved;
  const view=fixture((url,options)=>{if(url==='/api/vocabulary/import'){saved=JSON.parse(options.body);return {added:2,duplicates:0};}return [];});
  try {
    view.app.innerHTML='<div id="englishContent"></div>';
    await view.win.workbench.vocabularyImport({dataFileId:'word-file',entries:[{en:'plan',zh:'方案'},{en:'revise',zh:'修订',track:'雅思'}]});
    assert.equal(view.app.querySelector('#confirmWords').disabled,true);
    const target=view.app.querySelector('#importWordTrack');target.value='ielts';target.dispatchEvent(new view.win.Event('change'));
    assert.equal(view.app.querySelector('#confirmWords').disabled,false);
    await view.app.querySelector('#confirmWords').onclick({currentTarget:view.app.querySelector('#confirmWords')});
    await settle();
    assert.equal(saved.dataFileId,'word-file');assert.deepEqual(saved.entries.map(row=>row.track),['ielts','ielts']);
    assert.equal(view.win.location.search,'?track=ielts');
  } finally {view.close();}
});

test('语料搜索实时只保留命中的条目，编辑和删除可直接操作',async()=>{
  const view=fixture();
  try {
    const source=fs.readFileSync(new URL('../public/corpus.js',import.meta.url),'utf8').replace('export async function showCorpus','async function corpusScreen');
    view.win.eval(source+'\nwindow.corpusScreen=corpusScreen;');
    const rows=[{id:'1',title:'旅行',content:'Travel abroad.',translation:'出国旅行',category:'reading'},{id:'2',title:'旅行',content:'Pack a bag.',translation:'收拾行李',category:'reading'}];
    await view.win.corpusScreen({app:view.app,api:async()=>rows,esc:String,heading:(title,description,actions)=>'<h1>'+title+'</h1>'+actions,dialog:()=>{},bindForm:()=>{},json:()=>{},toast:()=>{}},'reading');
    assert.equal(view.app.querySelectorAll('.corpus-entry').length,2);
    const q=view.app.querySelector('[name="q"]');q.value='abroad';q.dispatchEvent(new view.win.Event('input'));
    assert.equal(view.app.querySelectorAll('.corpus-entry').length,1);
    assert.ok(view.app.querySelector('.corpus-entry > .actions > [data-edit="1"]'));
    assert.equal(view.app.querySelector('.corpus-entry-menu'),null);
    assert.equal(view.app.querySelectorAll('#corpusSearch button').length,0);
    q.value='no match';q.dispatchEvent(new view.win.Event('input'));view.app.querySelector('[data-reset-search]').click();
    assert.equal(view.app.querySelectorAll('.corpus-entry').length,2);
  } finally {view.close();}
});


test('复习汇总各模块记录与错题，旧地址归一且筛选保持，内页只展示返回和标题',async()=>{
  const view=fixture(url=>url.startsWith('/api/attempts?')?[{id:'done',title:'词汇练习',score:1,maxScore:2,questionCount:2}]:url==='/api/exams'?[{id:'a',title:'未完成词汇',track:'ielts',module:'vocabulary'},{id:'b',title:'未完成阅读',track:'general',module:'reading'}]:url==='/api/banks'?[{id:'bank',title:'阅读资料',track:'ielts',module:'reading'}]:url.startsWith('/api/wrong-questions?')?[{type:'choice',question:'Which word?',options:['a','b'],correctAnswer:0,wrongCount:1}]:[]);
  try{
    for(const path of ['/banks','/ielts/listening','/english/collections']){await view.win.workbench.go(path);assert.equal(view.app.querySelector('a[href$="/results"],a[href$="/wrong"]'),null,path);}
    await view.win.workbench.go('/review');assert.match(view.app.textContent,/未完成词汇/);assert.match(view.app.textContent,/未完成阅读/);assert.equal(view.win.document.querySelector('#pageTitle').textContent,'复习');assert.equal(view.win.document.querySelector('#pageBack').getAttribute('href'),'/');assert.ok(view.win.document.querySelector('#siteHeader').classList.contains('inner-page'));
    view.app.querySelector('#historyModule').value='reading';view.app.querySelector('#historyModule').dispatchEvent(new view.win.Event('change'));await settle();assert.equal(view.win.location.pathname,'/review');assert.equal(view.win.location.search,'?module=reading');assert.match(view.app.textContent,/未完成阅读/);assert.doesNotMatch(view.app.textContent,/未完成词汇/);
    await view.win.workbench.go('/banks/wrong?bankId=bank');await settle();assert.equal(view.win.location.pathname,'/review/wrong');assert.equal(view.win.location.search,'?bankId=bank');assert.match(view.app.textContent,/Which word/);
    const request=view.calls.findLast(c=>c.url.startsWith('/api/wrong-questions?'));assert.equal(new URL('http://test'+request.url).searchParams.get('track'),'');
    await view.win.workbench.go('/');assert.equal(view.win.document.querySelector('#siteHeader').classList.contains('inner-page'),false);
  }finally{view.close();}
});
