import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
const source=fs.readFileSync(new URL('../public/profile.js',import.meta.url),'utf8');
const settle=()=>new Promise(resolve=>setImmediate(resolve));
const version={webRevision:'a'.repeat(64),android:{versionName:'1.0.5',versionCode:6,apkPath:'/android/quizforge-android-1.0.5.apk'}};
function fixture(handler=async()=>version){
  const dom=new JSDOM('<div id="accountMenu"><div class="account-dropdown"></div></div><button id="logoutButton">退出</button><main id="app"></main>',{url:'https://study.example.com/me',runScripts:'outside-only'}),win=dom.window,app=win.document.querySelector('#app'),calls=[];
  const esc=value=>String(value).replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  win.eval(source.replace('export function mountProfile','function mountProfile')+'\nwindow.mountProfile=mountProfile;');
  const dialog=(title,content)=>{win.document.querySelector('dialog')?.remove();const node=win.document.createElement('dialog');node.setAttribute('aria-label',title);node.innerHTML=content;win.document.body.append(node);return node;};
  let cleanup=win.mountProfile({app,esc,name:'测试账号',api:async(...args)=>{calls.push(args);return handler(...args);},dialog});
  return {win,app,calls,stop(){cleanup();},close(){cleanup();win.close();}};
}

test('网页版我的提供真实版本读取与安卓下载入口，不伪造已安装版本或服务器修改',async()=>{
  const view=fixture();try{
    assert.deepEqual([...view.app.querySelectorAll('[data-web-action]')].map(node=>node.textContent),['应用更新','关于']);
    assert.equal(view.app.querySelector('[data-native-action="server"]'),null);
    view.app.querySelector('[data-web-action="update"]').click();await settle();
    assert.deepEqual(JSON.parse(JSON.stringify(view.calls)),[['/api/app-version',{cache:'no-store'}]]);
    const node=view.win.document.querySelector('dialog');assert.match(node.textContent,/安卓最新版本 1.0.5/);assert.match(node.textContent,/网页版本 a{12}/);
    assert.equal(node.querySelector('a').getAttribute('href'),'/android/');assert.doesNotMatch(node.textContent,/已安装|当前版本/);
    view.app.querySelector('[data-web-action="about"]').click();await settle();assert.match(view.win.document.querySelector('dialog').textContent,/雅思工坊/);
  }finally{view.close();}
});

test('版本接口失败提供可重试反馈，未发布安装包不提供假下载',async()=>{
  let attempt=0;const view=fixture(async()=>{if(!attempt++)throw new Error('upstream secret');return {webRevision:'b'.repeat(64),android:null};});try{
    view.app.querySelector('[data-web-action="update"]').click();await settle();
    const node=view.win.document.querySelector('dialog');assert.match(node.textContent,/暂时无法读取版本信息/);assert.doesNotMatch(node.textContent,/upstream secret/);
    node.querySelector('[data-profile-retry]').click();await settle();assert.match(node.textContent,/安卓安装包暂未发布/);assert.equal(node.querySelector('a'),null);
  }finally{view.close();}
});

test('异步原生注入移除网页重复入口，并沿用原生更新服务器关于动作',async()=>{
  const view=fixture();try{
    const native=view.win.document.createElement('div');native.className='native-app-actions';native.innerHTML=['update','server','about'].map(action=>`<button data-native-action="${action}">${action}</button>`).join('');
    let clicked=0;native.querySelector('[data-native-action="update"]').onclick=()=>clicked++;
    view.app.querySelector('#profileAppActions').append(native);await settle();
    assert.equal(view.app.querySelectorAll('[data-web-action]').length,0);assert.equal(view.app.querySelectorAll('[data-legacy-action]').length,0);
    assert.equal(view.app.querySelectorAll('[data-native-action="update"]').length,1);view.app.querySelector('[data-native-action="update"]').click();assert.equal(clicked,1);assert.equal(view.calls.length,0);
    native.remove();await settle();assert.equal(view.app.querySelectorAll('[data-web-action]').length,2);
  }finally{view.close();}
});

test('旧App代理去重并跟随可用状态，离开页面后停止同步和代理事件',async()=>{
  const view=fixture();try{
    const native=view.win.document.createElement('div');native.innerHTML=['update','server','about','reload'].map(action=>`<button data-native-action="${action}">${action}</button>`).join('');
    let clicked=0;native.querySelector('[data-native-action="update"]').onclick=()=>clicked++;
    view.win.document.querySelector('#accountMenu .account-dropdown').append(native);await settle();
    assert.deepEqual([...view.app.querySelectorAll('[data-legacy-action]')].map(node=>node.dataset.legacyAction),['update','server','about']);assert.equal(view.app.querySelectorAll('[data-web-action]').length,0);
    const update=view.app.querySelector('[data-legacy-action="update"]');update.click();assert.equal(clicked,1);
    const reload=native.querySelector('[data-native-action="reload"]');reload.dataset.available='true';await settle();assert.equal(view.app.querySelector('[data-legacy-action="reload"]').textContent,'加载新内容');
    view.stop();update.click();assert.equal(clicked,1);native.remove();await settle();assert.equal(view.app.querySelectorAll('[data-web-action]').length,0);
  }finally{view.close();}
});

test('离开页面后完成的版本请求不改写旧弹窗',async()=>{
  let finish;const view=fixture(()=>new Promise(resolve=>finish=resolve));try{
    view.app.querySelector('[data-web-action="update"]').click();await settle();const node=view.win.document.querySelector('dialog');view.stop();finish(version);await settle();assert.equal(node.textContent,'正在读取版本…');
  }finally{view.close();}
});
