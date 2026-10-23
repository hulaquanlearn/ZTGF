import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const script=fs.readFileSync(new URL('./app/src/main/assets/app-controls.js',import.meta.url),'utf8');
const markup='<form id="loginForm"><input name="username"><input name="password" type="password"><label id="rememberPasswordOption" hidden><input name="rememberPassword" id="rememberPassword" type="checkbox">保存密码</label></form>';
function fixture({url='https://study.example.com',remember=false,chrome=false}={}) {
  const shell=`<header id="siteHeader"><details id="accountMenu"><summary>账号</summary><div class="account-dropdown"><strong>synthetic-user</strong><button id="logoutButton">退出登录</button></div></details></header><main id="app">${markup}<div class="login-access-foot"></div></main>`;
  const dom=new JSDOM(chrome?shell:markup,{url,runScripts:'outside-only'}),w=dom.window,messages=[],appMessages=[];
  const result=w.eval(script.replace('__QUIZFORGE_APP_CONTROLS__',()=>JSON.stringify({origin:'https://study.example.com',nonce:'unique-document-channel',remember})));
  const port={start(){},close(){},postMessage(value){const parsed=JSON.parse(value);appMessages.push(parsed);if(['save','forget'].includes(parsed.action))messages.push(parsed);}};
  const connect=(nonce='unique-document-channel')=>w.dispatchEvent(new w.MessageEvent('message',{data:nonce,ports:[port]}));
  const form=()=>w.document.querySelector('form');
  const submit=()=>{form().elements.username.value='synthetic-user';form().elements.password.value='synthetic-password';form().dispatchEvent(new w.Event('submit'));};
  const success=()=>{w.sessionStorage.setItem('quizforge-session-token','synthetic-token');w.document.dispatchEvent(new w.Event('quizforge-login-success'));};
  const choice=checked=>{const input=w.document.querySelector('#rememberPassword');input.checked=checked;input.dispatchEvent(new w.Event('change'));};
  return {dom,w,messages,appMessages,port,result,connect,form,submit,success,choice,close(){w.quizforgeAppControlsCleanup?.();w.close();}};
}

test('remember is opt-in, becomes available only after the matching native channel, and saves only a successful submitted login',()=>{
  const v=fixture();try{
    v.connect('spoofed-channel');assert.equal(v.w.document.querySelector('#rememberPasswordOption').hidden,true);
    v.connect();assert.equal(v.w.document.querySelector('#rememberPasswordOption').hidden,false);
    assert.equal(v.form().elements.rememberPassword.checked,false);
    v.submit();v.success();assert.deepEqual(v.messages,[]);
    v.choice(true);v.submit();assert.deepEqual(v.messages,[],'failed or unfinished login never saves');
    v.success();assert.deepEqual(v.messages,[{action:'save',username:'synthetic-user',password:'synthetic-password'}]);
    assert.equal(v.w.localStorage.length,0);assert.equal(v.w.sessionStorage.length,1);
  }finally{v.close();}
});
test('unchecking immediately forgets the record and cancels credentials pending for that login',()=>{
  const v=fixture({remember:true});try{v.connect();assert.equal(v.form().elements.rememberPassword.checked,true);v.submit();v.choice(false);v.success();assert.deepEqual(v.messages,[{action:'forget'}]);}finally{v.close();}
});
test('a changed form, an unsolicited success, and a foreign origin cannot save credentials',()=>{
  const v=fixture({remember:true});try{v.connect();v.success();assert.deepEqual(v.messages,[]);v.submit();v.w.document.body.innerHTML=markup;v.success();assert.deepEqual(v.messages,[]);}finally{v.close();}
  const other=fixture({url:'https://other.example.com',remember:true});try{assert.equal(other.result,false);other.connect();other.submit();other.success();assert.deepEqual(other.messages,[]);}finally{other.close();}
});
test('native changes and SPA navigation keep the save choice synchronized without reading or modifying typed passwords',async()=>{
  const v=fixture({remember:true});try{v.connect();v.form().elements.password.value='typing-in-progress';v.w.document.dispatchEvent(new v.w.CustomEvent('quizforge-remember-changed',{detail:false}));assert.equal(v.form().elements.rememberPassword.checked,false);assert.equal(v.form().elements.password.value,'typing-in-progress');v.w.document.body.innerHTML=markup;await Promise.resolve();assert.equal(v.w.document.querySelector('#rememberPasswordOption').hidden,false);assert.equal(v.form().elements.rememberPassword.checked,false);}finally{v.close();}
});

test('login exposes no app settings; updates and server settings live in the authenticated personal center',async()=>{
  const v=fixture({chrome:true});try{
    v.connect();await Promise.resolve();
    assert.equal(v.w.document.querySelectorAll('[data-native-action="update"]').length,0);
    assert.equal(v.w.document.querySelectorAll('[data-native-action]').length,0);
    assert.equal(v.w.document.querySelector('.native-login-settings'),null);
    assert.deepEqual(v.appMessages,[{action:'session',signedIn:false}]);
    v.w.sessionStorage.setItem('quizforge-session-token','synthetic-token');
    v.w.document.querySelector('#app').innerHTML='<section id="profileAppSection" hidden><div id="profileAppActions"></div></section>';await Promise.resolve();
    assert.equal(v.w.document.querySelectorAll('#siteHeader').length,1);
    assert.equal(v.w.document.querySelectorAll('#accountMenu [data-native-action]').length,0);
    assert.equal(v.w.document.querySelectorAll('#profileAppActions [data-native-action]').length,3);
    assert.equal(v.w.document.querySelector('#profileAppSection').hidden,false);
    assert.equal(v.w.document.querySelector('[data-native-action="reload"]'),null);
    assert.equal(v.w.document.querySelector('[data-native-action="credentials"]'),null);
    assert.equal(v.w.document.querySelector('[data-native-action="browser"]'),null);
    assert.deepEqual(v.appMessages.at(-1),{action:'session',signedIn:true});
    v.w.document.querySelector('#accountMenu').open=true;
    v.w.document.querySelector('[data-native-action="update"]').click();
    assert.deepEqual(v.appMessages.at(-1),{action:'update'});
    assert.equal(v.w.document.querySelector('#accountMenu').open,false);
    v.w.document.querySelector('#app').innerHTML=markup+'<div class="login-access-foot"></div>';await Promise.resolve();
    assert.equal(v.w.document.querySelectorAll('[data-native-action="update"]').length,0);
    assert.deepEqual(v.appMessages.at(-1),{action:'session',signedIn:false});
  }finally{v.close();}
});

test('native update status changes existing account actions without creating duplicate controls',async()=>{
  const v=fixture({chrome:true});try{
    v.w.sessionStorage.setItem('quizforge-session-token','synthetic-token');v.w.document.querySelector('#app').innerHTML='<p>首页</p>';
    v.connect();await Promise.resolve();
    v.port.onmessage({data:JSON.stringify({type:'state',appUpdate:true,pageUpdate:true})});await Promise.resolve();
    assert.equal(v.w.document.querySelector('[data-native-action="update"]').textContent,'应用更新 · 有新版本');
    assert.equal(v.w.document.querySelector('[data-native-action="reload"]').textContent,'加载新内容');
    v.port.onmessage({data:JSON.stringify({type:'state',appUpdate:true,pageUpdate:false})});await Promise.resolve();
    assert.equal(v.w.document.querySelector('[data-native-action="reload"]'),null);
    v.w.document.querySelector('#app').append(v.w.document.createElement('div'));await Promise.resolve();
    assert.equal(v.w.document.querySelectorAll('.native-app-actions').length,1);
    const button=v.w.document.querySelector('[data-native-action="update"]'),count=v.appMessages.length;
    v.w.quizforgeAppControlsCleanup();button.click();
    assert.equal(v.appMessages.length,count);assert.equal(v.w.document.querySelectorAll('.native-app-actions').length,0);
  }finally{v.close();}
});
