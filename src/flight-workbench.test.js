import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { showFlights } from '../public/flight-workbench.js';
import { buildRows, headers } from './flights.js';
import { timetableDuties, analyzeStandby } from './standby.js';

const id = '12345678-1234-4321-8765-123456789012';
const flights = [
  { id:'0',number:'NX632',from:'MFM',to:'TPE',departure:'0800',arrival:'0935',toName:'台北桃园' },
  { id:'1',number:'NX631',from:'TPE',to:'MFM',departure:'1035',arrival:'1235',toName:'澳门' },
  { id:'2',number:'NX822',from:'MFM',to:'ICN',departure:'0825',arrival:'1205',toName:'首尔仁川' },
  { id:'3',number:'NX825',from:'ICN',to:'MFM',departure:'0730',arrival:'1130',toName:'澳门' },
].map(f=>({...f,days:'1234567',start:'2026-10-25',end:'2027-03-27',fromName:f.from,fromZone:'Asia/Shanghai',toZone:'Asia/Shanghai'}));
const esc = value => String(value ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const settle = () => new Promise(resolve=>setImmediate(resolve));

async function fixture(excluded = [],{beforeSave,initial={}}={}) {
  const dom = new JSDOM('<main id="app"></main>', {url:'http://example.test/flights'});
  const app = dom.window.document.querySelector('#app');
  const previous = new Map();
  for(const key of ['sessionStorage','localStorage']){
    previous.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
    Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]});
  }
  dom.window.sessionStorage.setItem('quizforge-candidate-name','workbench-test');
  let stored = {id,revision:1,title:'人工配对测试',data:{sourceName:'sample.pdf',start:'2026-10-25',end:'2027-03-27',flights:structuredClone(flights)},pairs:[],excluded,reviewed:[],mode:'season',date:'2026-10-25',...initial};
  const messages = [],requests=[];
  const api = async(url,options={})=>{
    if(url==='/api/flights/drafts')return [{id,title:stored.title}];
    if(url==='/api/flights/drafts/trash')return [];
    if(url==='/api/flights/drafts/'+id){
      if(options.method==='PUT'){if(beforeSave)await beforeSave();const next=JSON.parse(options.body);assert.equal(next.revision,stored.revision,'stale revision must not overwrite a draft');stored={...next,revision:stored.revision+1};return {revision:stored.revision};}
      return structuredClone(stored);
    }
    const payload=JSON.parse(options.body);
    if(url==='/api/flights/standby/from-timetable')return timetableDuties(buildRows(payload));
    if(url==='/api/flights/standby/analyze'){requests.push(payload);return analyzeStandby(payload,{generate:payload.generate!==false});}
    const rows=buildRows(payload);
    if(url==='/api/flights/preview')return {headers:headers.slice(0,9),rows};
    if(url==='/api/flights/validate')return {headers:headers.slice(0,9),rows,issues:[],rowPairs:rows.map(row=>row.pair)};
    throw Error('Unexpected API '+url);
  };
  const params={app,api,esc,json:body=>({body:JSON.stringify(body)}),toast:(message,error)=>messages.push({message,error}),dialog:(title,content)=>{
    const node=dom.window.document.createElement('dialog');node.innerHTML=`<h2>${esc(title)}</h2>${content}`;node.close=()=>node.remove();dom.window.document.body.append(node);return node;
  }};let cleanup=await showFlights(params);
  return {app,dom,messages,requests,stored:()=>stored,async remount(){cleanup();cleanup=await showFlights(params);},async close(){cleanup();await settle();await settle();dom.window.close();for(const [key,descriptor] of previous){if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];}}};
}

test('clicking a flight row reveals manual return choices and confirms a same-day pair', async()=>{
  const view=await fixture();
  try{
    view.app.querySelector('[data-flight-row="0"] td:nth-child(2)').click();
    assert.ok(view.app.querySelector('[data-flight-row="0"]').classList.contains('is-selected'));
    const daily=view.app.querySelector('[name="returnMode"][value="0"]');
    assert.ok(daily);
    assert.equal(daily.checked,false);
    assert.equal(view.app.querySelector('#confirmPair').disabled,true);
    daily.click();
    view.app.querySelector('[data-back="1"]').click();
    assert.equal(view.app.querySelector('[value="0"]').checked,true);
    assert.equal(view.app.querySelector('#confirmPair').disabled,false);
    await view.app.querySelector('#confirmPair').onclick({currentTarget:view.app.querySelector('#confirmPair')});
    assert.ok(view.app.querySelector('.result-table'));
    await view.close();
    assert.equal(view.stored().pairs[0].returnDays,0);
    assert.equal(view.stored().pairs[0].backId,'1');
  }catch(error){await view.close();throw error;}
});

test('explicit outbound selection supports overnight days, return selection and saved +1 rows', async()=>{
  const view=await fixture();
  try{
    view.app.querySelector('[data-out="2"]').click();
    view.app.querySelector('[name="returnMode"][value="overnight"]').click();
    assert.equal(view.app.querySelector('#returnDays').value,'1');
    view.app.querySelector('#returnDays').value='2';
    view.app.querySelector('#returnDays').dispatchEvent(new view.dom.window.Event('change'));
    assert.equal(view.app.querySelector('#returnDays').value,'2');
    view.app.querySelector('#returnDays').value='1';
    view.app.querySelector('#returnDays').dispatchEvent(new view.dom.window.Event('change'));
    view.app.querySelector('[data-back="3"]').click();
    assert.equal(view.app.querySelector('[value="overnight"]').checked,true);
    assert.equal(view.app.querySelector('#confirmPair').disabled,false);
    await view.app.querySelector('#confirmPair').onclick({currentTarget:view.app.querySelector('#confirmPair')});
    assert.match(view.app.querySelector('#flightResult').textContent,/NX825\+1/);
    await view.close();
    assert.equal(view.stored().pairs[0].returnDays,1);
  }catch(error){await view.close();throw error;}
});

test('excluded reverse flights can be restored explicitly without restoring unrelated flights', async()=>{
  const view=await fixture(['1','2']);
  try{
    view.app.querySelector('[data-out="0"]').click();
    assert.equal(view.app.querySelector('[data-back="1"]'),null);
    assert.match(view.app.querySelector('#flightPairing').textContent,/1 班反向航班已被排除/);
    view.app.querySelector('#restoreReturns').click();
    assert.ok(view.app.querySelector('[data-back="1"]'));
    assert.equal(view.app.querySelector('[value="0"]').checked,false);
    await view.close();
    assert.deepEqual(view.stored().excluded,['2']);
  }catch(error){await view.close();throw error;}
});

test('keyboard selects a row while source and exclusion buttons retain their own actions', async()=>{
  const view=await fixture();
  try{
    view.app.querySelector('[data-source="0"]').click();
    assert.equal(view.app.querySelector('[name="returnMode"]'),null);
    assert.match(view.dom.window.document.querySelector('dialog').textContent,/核对 NX632/);
    view.app.querySelector('[data-exclude="0"]').click();
    assert.equal(view.app.querySelector('[data-flight-row="0"]'),null);
    view.app.querySelector('[data-flight-row="2"]').dispatchEvent(new view.dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
    assert.ok(view.app.querySelector('[data-flight-row="2"]').classList.contains('is-selected'));
    assert.ok(view.app.querySelector('[value="overnight"]'));
  }finally{await view.close();}
});
test('confirmed timetable gates standby analysis and changing rules invalidates downloadable results',async()=>{
  const view=await fixture();
  try{
    view.app.querySelector('[data-out="0"]').click();view.app.querySelector('[name="returnMode"][value="0"]').click();view.app.querySelector('[data-back="1"]').click();
    view.app.querySelector('#outMeeting').value='0650';
    await view.app.querySelector('#confirmPair').onclick({currentTarget:view.app.querySelector('#confirmPair')});
    await view.app.querySelector('#confirmTimetable').onclick();
    const node=view.dom.window.document.querySelector('dialog');assert.equal(node.querySelector('#acceptTimetable').disabled,true);node.querySelector('#confirmFlightReviewed').checked=true;node.querySelector('#confirmFlightReviewed').dispatchEvent(new view.dom.window.Event('change'));node.querySelector('#acceptTimetable').click();
    assert.equal(view.app.querySelector('#flightTimetable').hidden,true);assert.equal(view.app.querySelector('#generateStandby').disabled,false);assert.equal(view.app.querySelector('#standbyExcel').disabled,true);
    await view.app.querySelector('#generateStandby').onclick();assert.equal(view.app.querySelector('#standbyWord').disabled,false);assert.match(view.app.querySelector('#standbyGoal').textContent,/1 \/ 1/);
    const regenerating=view.app.querySelector('#generateStandby').onclick();assert.equal(view.app.querySelector('#standbyWord').disabled,true);assert.equal(view.app.querySelector('#standbyExcel').disabled,true);await regenerating;
    view.app.querySelector('#standbyBuffer').value='45';view.app.querySelector('#standbyBuffer').dispatchEvent(new view.dom.window.Event('input'));assert.equal(view.app.querySelector('#standbyWord').disabled,true);assert.equal(view.app.querySelector('#standbyExcel').disabled,true);
    await view.close();assert.equal(view.stored().standby.confirmed,true);assert.equal(view.stored().standby.options.minimumBuffer,45);
  }catch(e){await view.close();throw e;}
});

test('page navigation waits for the prior autosave before reopening the draft revision',async()=>{
 let finishSave;const gate=new Promise(resolve=>finishSave=resolve);const view=await fixture([],{beforeSave:()=>gate});
 try{
  const title=view.app.querySelector('#flightTitle');title.value='切换前修改';title.dispatchEvent(new view.dom.window.Event('input'));
  const mounting=view.remount();await settle();assert.equal(view.stored().revision,1);finishSave();await mounting;
  assert.equal(view.app.querySelector('#flightTitle').value,'切换前修改');assert.equal(view.stored().revision,2);
  const next=view.app.querySelector('#flightTitle');next.value='切换后修改';next.dispatchEvent(new view.dom.window.Event('input'));await view.remount();
  assert.equal(view.stored().revision,3);assert.equal(view.messages.some(x=>x.error),false);
 }finally{finishSave();await view.close();}
});

test('candidate window fits five complete cards and preserves scrolling when selecting later returns',async()=>{
  const extra=Array.from({length:7},(_,i)=>({...flights[1],id:'extra-'+i,number:'NX'+(601+i*2),departure:String(1100+i*100),arrival:String(1300+i*100)}));
  const view=await fixture([],{initial:{data:{sourceName:'many.pdf',start:'2026-10-25',end:'2027-03-27',flights:[...flights,...extra]}}});
  try{
    const naturalHeights=[70,90,70,70,70,80,70,70],prototype=view.dom.window.HTMLElement.prototype,original=prototype.getBoundingClientRect;
    prototype.getBoundingClientRect=function(){
      if(this.classList.contains('candidate-list')){const height=Number.parseFloat(this.style.getPropertyValue('--candidate-window'))||382;return {top:0,bottom:height,height,width:320,left:0,right:320};}
      if(this.classList.contains('candidate')){const i=[...this.parentElement.children].indexOf(this),height=naturalHeights[i],top=naturalHeights.slice(0,i).reduce((sum,h)=>sum+h+8,0)-this.parentElement.scrollTop;return {top,bottom:top+height,height,width:320,left:0,right:320};}
      return original.call(this);
    };
    view.app.querySelector('[data-out="0"]').click();view.app.querySelector('[name="returnMode"][value="0"]').click();
    let list=view.app.querySelector('.candidate-list');assert.equal(list.style.getPropertyValue('--candidate-window'),'402px');assert.equal(list.dataset.visibleCount,'5');assert.equal(list.querySelectorAll('.candidate').length,8);assert.equal(view.app.querySelector('#expandCandidates'),null);assert.match(view.app.querySelector('.candidate-head').textContent,/共 8 班 · 下滑查看更多/);
    list.scrollTop=218;const seventh=list.querySelectorAll('.candidate')[6];seventh.click();list=view.app.querySelector('.candidate-list');assert.equal(list.scrollTop,218);assert.equal(list.querySelector('.candidate.active').dataset.back,seventh.dataset.back);
    list.scrollTop=0;list.querySelectorAll('.candidate')[7].click();list=view.app.querySelector('.candidate-list');assert.ok(list.scrollTop>0);assert.ok(list.querySelector('.candidate.active').getBoundingClientRect().bottom<=list.getBoundingClientRect().bottom);assert.equal(view.dom.window.document.activeElement,list.querySelector('.candidate.active'));
  }finally{await view.close();}
});

test('confirming a changed timetable generates fresh times rather than evaluating an old result',async()=>{
  const view=await fixture([],{initial:{pairs:[{outId:'0',backId:'1',returnDays:0,outOpening:'0650'}],standby:{sourceKind:'timetable',sourceKey:'old-timetable',confirmed:true,duties:[],shifts:[{name:'S1',start:'1800',end:'2100'}],fixedNames:['S1'],requestedCount:1}}});
  try{await view.app.querySelector('#confirmTimetable').onclick();const node=view.dom.window.document.querySelector('dialog');node.querySelector('#confirmFlightReviewed').checked=true;node.querySelector('#confirmFlightReviewed').dispatchEvent(new view.dom.window.Event('change'));node.querySelector('#acceptTimetable').click();await settle();assert.equal(view.requests.at(-1).generate,undefined);assert.equal(view.requests.at(-1).shifts,undefined);assert.deepEqual(view.requests.at(-1).fixedShifts,[]);assert.equal(view.requests.at(-1).requestedCount,1);assert.match(view.app.querySelector('#standbyGoal').textContent,/1 \/ 1/);assert.equal(view.app.querySelector('#standbyWord').disabled,false);assert.equal(view.app.querySelectorAll('.standby-shift').length,1);assert.notEqual(view.app.querySelector('[data-shift="0"][data-edge="start"]').value,'18:00');}finally{await view.close();}
});
