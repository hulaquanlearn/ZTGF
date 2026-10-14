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
  win.bindLoginMotion=()=>()=>{};win.loginSceneMarkup=()=>'';win.bindPasswordVisibility=()=>{};
  const source=fs.readFileSync(new URL('../public/workspace.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace(/^route\(\);\r?$/m,'');
  win.eval(source+'\nwindow.workbench={api,status,bindForm,bankDetail,importPage,renderImportPreview,practiceFormHtml,bindPractice,dictionary,vocabularyImport,reimportData,go,route};');
  return {dom,win,app:win.document.querySelector('#app'),calls,downloads,close:()=>dom.window.close()};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));

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

function sampleFlightDraft(id) {
  return {id,revision:1,title:'原有航班表',data:{sourceName:'sample.pdf',start:'2026-10-25',end:'2027-03-27',flights:[
    {id:'0',number:'NX632',from:'MFM',to:'TPE',departure:'0800',arrival:'0935',days:'1234567',start:'2026-10-25',end:'2027-03-27',fromName:'澳门',toName:'桃园'},
    {id:'1',number:'NX631',from:'TPE',to:'MFM',departure:'1035',arrival:'1235',days:'1234567',start:'2026-10-25',end:'2027-03-27',fromName:'桃园',toName:'澳门'}
  ]},pairs:[],excluded:[],reviewed:[],mode:'season',date:'2026-10-25'};
}

function useRealFlightScreen(view,id) {
  const timers=new Map();let timerId=0;
  view.win.setTimeout=(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId;};
  view.win.clearTimeout=timer=>timers.delete(timer);
  view.win.createUuid=()=>id;view.win.showStandby=()=>()=>{};
  const source=fs.readFileSync(new URL('../public/flight-workbench.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace('export async function showFlights','async function actualShowFlights');
  view.win.eval(source+'\nwindow.showFlights=actualShowFlights;');
  return async()=>{
    const autosave=[...timers].find(([,timer])=>timer.delay===650);
    assert.ok(autosave,'a draft change schedules an autosave');
    timers.delete(autosave[0]);autosave[1].callback();await settle();
  };
}

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
    assert.equal(view.app.querySelector('#loginForm'),null);assert.equal(view.app.querySelector('h1').textContent,'首页');
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

test('数据管理和带草稿参数的链接在当前工作区内导航',async()=>{
  const view=fixture();
  try {
    assert.equal(view.win.document.querySelector('#mainNav a[href="/data"]'),null);
    const link=view.win.document.querySelector('#accountMenu a[href="/data"]');
    const click=new view.win.MouseEvent('click',{bubbles:true,cancelable:true,button:0});link.dispatchEvent(click);
    await settle();assert.equal(click.defaultPrevented,true);assert.equal(view.win.location.pathname,'/data');assert.ok(view.app.querySelector('[data-manager]'));
    const draft=view.win.document.createElement('a');draft.href='/flights?draft=saved-1';view.app.append(draft);
    const next=new view.win.MouseEvent('click',{bubbles:true,cancelable:true,button:0});draft.dispatchEvent(next);
    await settle();assert.equal(next.defaultPrevented,true);assert.equal(view.win.location.search,'?draft=saved-1');assert.ok(view.app.querySelector('[data-flight-draft]'));
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

test('跨路由的后台草稿保存接收新 revision，随后保存较新的日期安排',async()=>{
  const id='12345678-1234-4321-8765-123456789012',writes=[];
  let release;
  let stored={id,revision:1,title:'原有航班表',data:{sourceName:'sample.pdf',start:'2026-10-25',end:'2027-03-27',flights:[
    {id:'0',number:'NX632',from:'MFM',to:'TPE',departure:'0800',arrival:'0935',days:'1234567',start:'2026-10-25',end:'2027-03-27',fromName:'澳门',toName:'桃园'},
    {id:'1',number:'NX631',from:'TPE',to:'MFM',departure:'1035',arrival:'1235',days:'1234567',start:'2026-10-25',end:'2027-03-27',fromName:'桃园',toName:'澳门'}
  ]},pairs:[],excluded:[],reviewed:[],mode:'season',date:'2026-10-25'};
  const view=fixture(async(url,options)=>{
    if(url==='/api/flights/drafts')return [{id,title:stored.title}];
    if(url==='/api/flights/drafts/'+id){
      if(options.method==='PUT'){
        const snapshot=JSON.parse(options.body);writes.push(snapshot);
        if(writes.length===1)await new Promise(resolve=>{release=resolve;});
        if(snapshot.revision!==stored.revision)return new Response(JSON.stringify({error:'版本冲突'}),{status:409});
        stored={...snapshot,revision:stored.revision+1};return {revision:stored.revision};
      }
      return structuredClone(stored);
    }
    return [];
  });
  const timers=new Map();let timerId=0;
  view.win.setTimeout=(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId;};
  view.win.clearTimeout=timer=>timers.delete(timer);
  try {
    view.win.createUuid=()=>id;view.win.showStandby=()=>()=>{};
    const source=fs.readFileSync(new URL('../public/flight-workbench.js',import.meta.url),'utf8').replace(/^import .*$/gm,'').replace('export async function showFlights','async function actualShowFlights');
    view.win.eval(source+'\nwindow.showFlights=actualShowFlights;');
    await view.win.workbench.go('/flights');
    const title=view.app.querySelector('#flightTitle');title.value='已修改名称';title.dispatchEvent(new view.win.Event('input'));
    const autosave=[...timers].find(([,timer])=>timer.delay===650);timers.delete(autosave[0]);autosave[1].callback();await settle();
    assert.equal(writes.length,1);assert.equal(writes[0].revision,1);
    view.app.querySelector('[data-mode="daily"]').click();
    const date=view.app.querySelector('#flightDate');date.value='2026-11-02';date.dispatchEvent(new view.win.Event('change'));
    await view.win.workbench.go('/data');release();await settle();
    assert.equal(writes.length,2);assert.equal(writes[1].revision,2,'cleanup uses the accepted revision from the earlier in-flight save');
    assert.equal(stored.revision,3);assert.equal(stored.mode,'daily');assert.equal(stored.date,'2026-11-02');
    assert.ok(view.app.querySelector('[data-manager]'),'background saves do not replace the new page');
    assert.equal(view.win.localStorage.getItem('quizforge-flight-pending:界面测试'),null);
    assert.equal(view.calls.filter(call=>call.url==='/api/flights/drafts').length,1,'disposed screens do not refresh the draft list after saving');
    assert.ok(view.calls.filter(call=>call.options.method==='PUT').every(call=>!Object.hasOwn(call.options,'background')),'background is an API option, not a fetch option');
    await view.win.workbench.go('/flights');
    assert.equal(view.app.querySelector('#flightTitle').value,'已修改名称');assert.equal(view.app.querySelector('#flightDate').value,'2026-11-02');
    assert.equal(view.app.querySelector('[data-mode="daily"]').getAttribute('aria-pressed'),'true');assert.equal(view.win.document.querySelector('dialog'),null);
    assert.equal(view.app.querySelector('#flightSave').textContent,'已保存');
  } finally {release?.();view.close();}
});

for(const [boundary,changeSession] of [
  ['token',win=>win.sessionStorage.setItem('quizforge-session-token','replacement-session')],
  ['owner',win=>win.sessionStorage.setItem('quizforge-candidate-name','另一个账号')]
]) {
  test(`排队草稿保存遇到 ${boundary} 变化只保留原账号本地修改，不发送下一笔请求`,async()=>{
    const id='22345678-1234-4321-8765-123456789012',writes=[];let release,stored=sampleFlightDraft(id);
    const view=fixture(async(url,options)=>{
      if(url==='/api/flights/drafts')return [{id,title:stored.title}];
      if(url==='/api/flights/drafts/'+id){
        if(options.method==='PUT'){
          const snapshot=JSON.parse(options.body);writes.push(snapshot);
          await new Promise(resolve=>{release=resolve;});
          stored={...snapshot,revision:stored.revision+1};return {revision:stored.revision};
        }
        return structuredClone(stored);
      }
      return [];
    });
    const runAutosave=useRealFlightScreen(view,id);
    try {
      await view.win.workbench.go('/flights');
      const title=view.app.querySelector('#flightTitle');title.value='正在保存的修改';title.dispatchEvent(new view.win.Event('input'));await runAutosave();
      title.value='排队中的最新修改';title.dispatchEvent(new view.win.Event('input'));
      await view.win.workbench.go('/data');changeSession(view.win);release();await settle();
      assert.equal(writes.length,1,'the queued old-account snapshot cannot use a new session or owner');
      assert.equal(stored.title,'正在保存的修改');
      assert.equal(JSON.parse(view.win.localStorage.getItem('quizforge-flight-pending:界面测试')).title,'排队中的最新修改');
      assert.equal(view.win.localStorage.getItem('quizforge-flight-pending:另一个账号'),null);
      assert.ok(view.calls.filter(call=>call.options.method==='PUT').every(call=>call.options.headers.get('x-session-token')==='isolated-session'));
      assert.equal(view.calls.filter(call=>call.url==='/api/flights/drafts').length,1);
      assert.ok(view.app.querySelector('[data-manager]'));
    } finally {release?.();view.close();}
  });
}

test('保存后的草稿列表刷新跨页返回时不会把已成功保存误报失败',async()=>{
  const id='32345678-1234-4321-8765-123456789012';let stored=sampleFlightDraft(id),release,listReads=0;
  const view=fixture(async(url,options)=>{
    if(url==='/api/flights/drafts'){
      if(++listReads===2)await new Promise(resolve=>{release=resolve;});
      return [{id,title:stored.title}];
    }
    if(url==='/api/flights/drafts/'+id){
      if(options.method==='PUT'){stored={...JSON.parse(options.body),revision:stored.revision+1};return {revision:stored.revision};}
      return structuredClone(stored);
    }
    return [];
  });
  const runAutosave=useRealFlightScreen(view,id);
  try {
    await view.win.workbench.go('/flights');
    const title=view.app.querySelector('#flightTitle');title.value='保存后跳页';title.dispatchEvent(new view.win.Event('input'));await runAutosave();
    assert.equal(listReads,2);assert.equal(view.app.querySelector('#flightSave').textContent,'已保存');
    await view.win.workbench.go('/data');release();await settle();
    assert.ok(view.app.querySelector('[data-manager]'));
    assert.equal(view.win.localStorage.getItem('quizforge-flight-pending:界面测试'),null);
    assert.equal(view.win.document.querySelector('#toast').textContent,'');
    await view.win.workbench.go('/flights');
    assert.equal(view.app.querySelector('#flightTitle').value,'保存后跳页');
    assert.equal(view.app.querySelector('#flightSave').textContent,'已保存');
    assert.equal(view.calls.filter(call=>call.options.method==='PUT').length,1);
  } finally {release?.();view.close();}
});

test('真实航班页首次加载迟到时不会重新渲染或覆盖数据管理',async()=>{
  const id='42345678-1234-4321-8765-123456789012';let release;
  const view=fixture(url=>url==='/api/flights/drafts'?new Promise(resolve=>{release=resolve;}):sampleFlightDraft(id));
  useRealFlightScreen(view,id);
  try {
    const previous=view.win.workbench.go('/flights');await settle();
    await view.win.workbench.go('/data');release([{id,title:'迟到的航班表'}]);await previous;
    assert.equal(view.win.location.pathname,'/data');assert.ok(view.app.querySelector('[data-manager]'));
    assert.equal(view.app.querySelector('#flightTitle'),null);assert.equal(view.win.document.querySelector('#toast').textContent,'');
    assert.equal(view.calls.filter(call=>call.url==='/api/flights/drafts/'+id).length,0);
  } finally {release?.([]);view.close();}
});

test('迟到的航班页清理函数不会替换新页面已经安装的清理函数',async()=>{
  const view=fixture(),disposed=[];let release;
  try {
    view.win.showFlights=async({app,isCurrent})=>{
      const revision=view.win.location.search;
      if(revision==='?draft=old')await new Promise(resolve=>{release=resolve;});
      if(isCurrent())app.innerHTML='<section data-flight-draft>'+revision+'</section>';
      return ()=>disposed.push(revision);
    };
    const old=view.win.workbench.go('/flights?draft=old');
    await view.win.workbench.go('/flights?draft=new');release();await old;
    assert.deepEqual(disposed,['?draft=old']);
    assert.match(view.app.textContent,/draft=new/);
    await view.win.workbench.go('/data');assert.deepEqual(disposed,['?draft=old','?draft=new']);
  } finally {release?.();view.close();}
});

test('会话切换时仅修改日期与范围的本地副本重新登录后也能恢复为新草稿',async()=>{
  const id='52345678-1234-4321-8765-123456789012',newId='62345678-1234-4321-8765-123456789012',original=sampleFlightDraft(id),writes=[];
  const view=fixture((url,options)=>{
    if(url==='/api/flights/drafts')return [{id,title:original.title}];
    if(options.method==='PUT'){writes.push({url,snapshot:JSON.parse(options.body)});return {revision:1};}
    if(url==='/api/flights/drafts/'+id)return structuredClone(original);
    return [];
  });
  useRealFlightScreen(view,id);
  try {
    await view.win.workbench.go('/flights');view.app.querySelector('[data-mode="daily"]').click();
    const date=view.app.querySelector('#flightDate');date.value='2026-11-02';date.dispatchEvent(new view.win.Event('change'));
    view.win.sessionStorage.setItem('quizforge-session-token','replacement-session');await view.win.workbench.go('/data');await settle();
    assert.equal(writes.length,0);
    assert.equal(JSON.parse(view.win.localStorage.getItem('quizforge-flight-pending:界面测试')).date,'2026-11-02');
    view.win.sessionStorage.setItem('quizforge-session-token','isolated-session');await view.win.workbench.go('/flights');
    const button=view.win.document.querySelector('#recoverFlight');assert.ok(button,'mode/date changes alone must expose local recovery');
    view.win.createUuid=()=>newId;await button.onclick();
    assert.equal(writes.length,1);assert.equal(writes[0].url,'/api/flights/drafts/'+newId);assert.equal(writes[0].snapshot.revision,0);
    assert.equal(writes[0].snapshot.mode,'daily');assert.equal(writes[0].snapshot.date,'2026-11-02');
    assert.equal(original.mode,'season');assert.equal(original.date,'2026-10-25');
    assert.equal(view.win.localStorage.getItem('quizforge-flight-pending:界面测试'),null);
    assert.equal(view.win.document.querySelector('#recoverFlight'),null);
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

test('快速切换词汇范围时迟到的响应不会覆盖新范围的题量',async()=>{
  const pending=new Map(),view=fixture(url=>new Promise(resolve=>pending.set(new URL(url,'http://example.test').searchParams.get('track'),resolve)));
  try {
    view.app.innerHTML=view.win.workbench.practiceFormHtml('testPractice','postgraduate');
    const form=view.app.querySelector('form');view.win.workbench.bindPractice(form);
    assert.equal(form.querySelector('[type="submit"]').disabled,true);
    form.elements.track.value='ielts';form.elements.track.dispatchEvent(new view.win.Event('change'));
    pending.get('ielts')({available:3,maxPerExam:3});await settle();
    pending.get('postgraduate')({available:50,maxPerExam:50});await settle();
    assert.equal(form.elements.count.max,'3');assert.equal(form.elements.count.value,'3');
    assert.match(form.querySelector('[data-availability]').textContent,/3 个词/);
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
