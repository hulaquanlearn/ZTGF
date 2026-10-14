import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {bindLoginMotion,loginSceneMarkup} from '../public/login-motion.js';
import {bindPasswordVisibility} from '../public/password-visibility.js';

function fixture(query='',reduced=true){
  const dom=new JSDOM(`<section>${loginSceneMarkup()}<aside class="login-intro"><h2></h2></aside><form><label for="username">账号</label><input id="username"><label for="password">密码</label><input id="password" type="password"><button id="passwordToggle" type="button">显示</button><button id="loginSubmit" type="button">登录</button></form></section>`,{url:`http://localhost/login${query}`,pretendToBeVisual:true});
  const globals=['window','document','MutationObserver','requestAnimationFrame','cancelAnimationFrame'];
  const prior=new Map(globals.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const key of globals)Object.defineProperty(globalThis,key,{configurable:true,value:typeof dom.window[key]==='function'&&key.endsWith('AnimationFrame')?dom.window[key].bind(dom.window):dom.window[key]});
  dom.window.matchMedia=()=>({matches:reduced});
  const root=dom.window.document.querySelector('section');
  const account=root.querySelector('#username'),password=root.querySelector('#password'),pet=root.querySelector('.login-pet');
  const cleanup=bindLoginMotion(root);
  bindPasswordVisibility(password,root.querySelector('#passwordToggle'));
  return {dom,root,account,password,pet,cleanup,close(){cleanup();dom.window.close();for(const key of globals){if(prior.get(key))Object.defineProperty(globalThis,key,prior.get(key));else delete globalThis[key];}}};
}

test('selected B is the only login concept, including old review URLs',()=>{
  const f=fixture('?style=aurora');try{
    assert.equal(f.root.dataset.loginStyle,'pet');assert.equal(f.root.querySelector('.login-variant-picker'),null);
    f.account.value='demo-user';f.password.value='test-only';f.account.focus();f.password.focus();
    assert.equal(f.account.value,'demo-user');assert.equal(f.password.value,'test-only');
  }finally{f.close();}
});

test('account caret moves eyes; password focus looks away without reading its contents',()=>{
  const f=fixture();try{
    f.pet.getBoundingClientRect=()=>({left:100,top:250,width:370,height:370});
    f.account.getBoundingClientRect=()=>({left:750,top:300,width:280,height:50});
    f.account.value='demo';f.account.focus();f.account.setSelectionRange(0,0);f.account.dispatchEvent(new f.dom.window.Event('keyup'));
    assert.equal(f.pet.dataset.mood,'curious');const first=f.pet.style.getPropertyValue('--eye-x');
    assert.ok(parseFloat(first)>0,'desktop account is on the right');assert.ok(parseFloat(f.pet.style.getPropertyValue('--eye-y'))<0,'account is above the eyes');
    f.account.setSelectionRange(4,4);f.account.dispatchEvent(new f.dom.window.Event('keyup'));
    assert.notEqual(f.pet.style.getPropertyValue('--eye-x'),first);
    Object.defineProperty(f.password,'value',{get(){throw new Error('Password contents must not be accessed');},configurable:true});
    f.password.focus();assert.equal(f.pet.dataset.mood,'shy');
    assert.equal(f.pet.style.getPropertyValue('--eye-x'),'-9px');
    assert.match(f.root.querySelector('.pet-speech').textContent,/才没有偷看/);
  }finally{f.close();}
});

test('revealed passwords keep mascot looking away even after field loses focus',async()=>{
  const f=fixture();try{
    f.password.focus();f.root.querySelector('#passwordToggle').click();
    await Promise.resolve();assert.equal(f.password.type,'text');
    f.root.querySelector('#loginSubmit').focus();assert.equal(f.pet.dataset.mood,'shy');
    f.root.querySelector('#passwordToggle').click();await Promise.resolve();
    assert.equal(f.password.type,'password');assert.equal(f.pet.dataset.mood,'idle');
  }finally{f.close();}
});

test('reduced motion retains focus interaction; disposal removes all listeners and observers',async()=>{
  const f=fixture('',true);try{
    f.password.focus();assert.equal(f.pet.dataset.mood,'shy');
    f.cleanup();f.account.focus();f.password.type='text';await Promise.resolve();
    assert.equal(f.pet.dataset.mood,'shy');
    assert.equal(f.pet.classList.contains('is-blinking'),false);
  }finally{f.close();}
});

test('mobile account beneath the mascot receives downward gaze and resize updates direction',()=>{
  const f=fixture();try{
    f.pet.getBoundingClientRect=()=>({left:100,top:60,width:174,height:174});
    let field={left:40,top:350,width:310,height:48};f.account.getBoundingClientRect=()=>field;
    f.account.focus();assert.ok(parseFloat(f.pet.style.getPropertyValue('--eye-y'))>0);
    field={left:750,top:20,width:280,height:48};f.dom.window.dispatchEvent(new f.dom.window.Event('resize'));
    assert.ok(parseFloat(f.pet.style.getPropertyValue('--eye-x'))>0);assert.ok(parseFloat(f.pet.style.getPropertyValue('--eye-y'))<0);
  }finally{f.close();}
});
