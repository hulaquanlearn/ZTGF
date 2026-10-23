import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';

const settle=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(handler,initialQuery=''){
  const dom=new JSDOM('<main id="app"></main>',{url:'http://example.test/query',runScripts:'outside-only'}),win=dom.window,calls=[];
  win.HTMLElement.prototype.scrollIntoView=()=>{};
  win.eval(fs.readFileSync(new URL('../public/lookup.js',import.meta.url),'utf8').replace(/export (async )?function /g,'$1function ')+'\nwindow.mountQuery=mountQuery;');
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const app=win.document.querySelector('#app');
  const cleanup=win.mountQuery({app,initialQuery,esc,json:value=>({body:JSON.stringify(value)}),api:async(path,options)=>{const body=options?.body?JSON.parse(options.body):undefined;calls.push({path,body});return handler(path,body);},bindWordActions(){},dialog:(title,html)=>{const node=win.document.createElement('dialog');node.innerHTML=html;app.append(node);return node;}});
  const search=(q,direction)=>{if(direction)app.querySelector(`[data-direction="${direction}"]`).click();const form=app.querySelector('.query-form');form.elements.q.value=q;form.dispatchEvent(new win.Event('submit',{cancelable:true}));};
  const chat=message=>{const form=app.querySelector('.query-chat-form');form.elements.message.value=message;form.dispatchEvent(new win.Event('submit',{cancelable:true}));};
  return {win,dom,app,calls,search,chat,cleanup,close:()=>dom.window.close()};
}
const empty={words:[],corpus:[],hasExact:false,aiAvailable:true};
const saved={id:'mine',category:'speaking',title:'情绪表达',content:'She could not hide her anger.',translation:'她无法掩饰愤怒。',notes:'注意 anger 的搭配。'};

test('查询前选择方向，中译英首结果是英文；已存语料保留并移除多余说明',async()=>{
  const view=fixture((path,body)=>path==='/api/lookup'?{...empty,corpus:[saved]}:{explanation:{term:'anger',translation:'愤怒',pronunciation:'/ˈæŋɡə(r)/',usage:'in anger — 愤怒地',exampleEn:'He spoke in anger.',exampleZh:'他气愤地说。'}});
  try{
    assert.equal(view.app.querySelector('[data-direction="en-zh"]').getAttribute('aria-pressed'),'true');
    assert.match(view.app.querySelector('[name=q]').placeholder,/英文/);
    assert.equal(view.app.querySelector('.query-text-translation>a').getAttribute('href'),'/english/translate');
    view.search('愤怒','zh-en');await settle();await settle();
    assert.equal(view.calls[0].body.direction,'zh-en');assert.equal(view.calls[1].body.direction,'zh-en');
    assert.equal(view.app.querySelector('.query-word-heading h2').textContent,'anger');
    assert.match(view.app.querySelector('.query-corpus').textContent,/She could not hide/);assert.match(view.app.querySelector('.query-corpus').textContent,/注意 anger/);
    assert.doesNotMatch(view.app.textContent,/仅作学习参考|不会写入|不会覆盖/);
  }finally{view.close();}
});

test('在线解释等待或失败时已存词库与语料仍可阅读',async()=>{
  let release;const view=fixture(path=>path==='/api/lookup'?{...empty,words:[{id:'w',en:'angry',zh:'生气的'}],corpus:[saved]}:new Promise((_resolve,reject)=>release=reject));
  try{
    view.search('anger');await settle();
    assert.match(view.app.querySelector('.query-saved-words').textContent,/angry/);assert.match(view.app.querySelector('.query-corpus').textContent,/情绪表达/);assert.match(view.app.querySelector('[data-ai-result]').textContent,/正在补充/);
    release(Error('暂时失败'));await settle();assert.match(view.app.querySelector('[data-ai-result]').textContent,/暂时失败/);assert.match(view.app.querySelector('.query-corpus').textContent,/情绪表达/);
  }finally{view.close();}
});

test('切换方向或离开页面后忽略旧查询结果，旧解释不覆盖新查询',async()=>{
  let explainRelease,localRelease;
  const view=fixture((path,body)=>{
    if(path==='/api/lookup'&&body.q==='slow')return new Promise(resolve=>localRelease=resolve);
    if(path==='/api/lookup')return empty;
    if(body.q==='first')return new Promise(resolve=>explainRelease=resolve);
    return {explanation:{term:'second',translation:'第二'}};
  });
  try{
    view.search('first');await settle();view.search('second');await settle();await settle();
    explainRelease({explanation:{term:'first',translation:'第一'}});await settle();assert.equal(view.app.querySelector('h2').textContent,'second');
    view.search('slow');await settle();view.app.querySelector('[data-direction="zh-en"]').click();localRelease(empty);await settle();assert.equal(view.app.querySelector('h2'),null);assert.equal(view.app.querySelector('.query-chat'),null);
    view.search('second','en-zh');await settle();view.cleanup();view.app.innerHTML='<p>其他页面</p>';await settle();assert.equal(view.app.textContent,'其他页面');
  }finally{view.close();}
});

test('连续追问携带上下文，默认无语料；显式引用时仅发送id，失败可重试',async()=>{
  let chatCount=0;
  const view=fixture((path,body)=>{
    if(path==='/api/lookup')return {...empty,words:[{id:'w',en:'anger',zh:'愤怒'}],hasExact:true,corpus:[saved]};
    chatCount++;if(chatCount===4)throw Error('追问失败');return {answer:'<script>危险文本</script> 例句 '+chatCount};
  });
  try{
    view.search('anger');await settle();view.chat('口语中怎么用？');await settle();
    const first=view.calls.find(c=>c.path.endsWith('/chat'));assert.deepEqual(first.body.history,[]);assert.equal(first.body.referenceId,undefined);assert.doesNotMatch(JSON.stringify(first.body),/She could/);
    view.chat('换一个场景');await settle();const second=view.calls.filter(c=>c.path.endsWith('/chat'))[1];assert.equal(second.body.history.length,2);assert.equal(second.body.history[0].content,'口语中怎么用？');
    assert.equal(view.app.querySelector('script'),null);assert.match(view.app.querySelector('.query-message-ai').textContent,/<script>/);
    view.app.querySelector('[data-reference="mine"]').click();view.chat('改写这句');await settle();const third=view.calls.filter(c=>c.path.endsWith('/chat'))[2];assert.equal(third.body.referenceId,'mine');assert.deepEqual(third.body.history,[]);assert.doesNotMatch(JSON.stringify(third.body),/She could/);
    view.chat('再试试');await settle();assert.match(view.app.querySelector('[data-chat-status]').textContent,/追问失败/);assert.equal(view.app.querySelector('[name=message]').disabled,false);assert.equal(view.app.querySelector('[name=message]').value,'再试试');
    view.chat('再试试');await settle();assert.equal(view.app.querySelector('[name=message]').value,'');
    view.app.querySelector('[aria-label="取消引用"]').click();view.chat('独立问题');await settle();const last=view.calls.at(-1);assert.equal(last.body.referenceId,undefined);assert.deepEqual(last.body.history,[]);
  }finally{view.close();}
});

test('新查询忽略旧追问回复；无密钥仍展示词库，追问不可发送',async()=>{
  let reply;const view=fixture((path,body)=>{
    if(path==='/api/lookup')return {...empty,hasExact:true,words:[{id:body.q,en:body.q,zh:'已有释义'}],aiAvailable:body.q!=='offline'};
    return new Promise(resolve=>reply=resolve);
  });
  try{
    view.search('anger');await settle();view.chat('怎么用？');await settle();view.search('offline');await settle();reply({answer:'过期回复'});await settle();
    assert.equal(view.app.querySelector('h2').textContent,'offline');assert.doesNotMatch(view.app.textContent,/过期回复/);assert.equal(view.app.querySelector('[name=message]').disabled,true);assert.match(view.app.textContent,/已有释义/);
  }finally{view.close();}
});
