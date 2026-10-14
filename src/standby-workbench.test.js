import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {showStandby} from '../public/standby-workbench.js';
import {RULE_VERSION,PLAN_VERSION} from '../public/standby-calculator.js';
import {analyzeStandby} from './standby.js';
const duty={id:'first',label:'NX632 + NX631',point:'桃园',airport:'TPE',outbound:'NX632',returnFlight:'NX631',type:'turnaround',sectors:2,briefing:410,departure:480,arrival:755};
const settle=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(source={}, {saved,importResult}={}){
 const dom=new JSDOM('<main></main>',{url:'http://localhost/flights/standby'}),prior=Object.getOwnPropertyDescriptor(globalThis,'localStorage');Object.defineProperty(globalThis,'localStorage',{configurable:true,value:dom.window.localStorage});
 let stored={duties:[duty],confirmed:true,ruleVersion:RULE_VERSION,planVersion:PLAN_VERSION,...source},requests=[],messages=[];
 if(saved)dom.window.localStorage.setItem('test',JSON.stringify(saved));
 const root=dom.window.document.querySelector('main');const cleanup=showStandby({root,api:async(url,opts)=>{if(url.endsWith('/import'))return importResult||{duties:[{...duty,id:'new'}],warnings:[]};const body=JSON.parse(opts.body);requests.push(body);return analyzeStandby(body);},esc:String,json:body=>({body:JSON.stringify(body)}),toast:(message,error)=>messages.push({message,error}),getSnapshot:()=>stored,isStale:()=>false,onChange:x=>stored=x,key:'test'});await settle();
 return {root,dom,stored:()=>stored,requests,messages,async close(){cleanup();await settle();dom.window.close();if(prior)Object.defineProperty(globalThis,'localStorage',prior);else delete globalThis.localStorage;}};
}
test('confirmed source automatically generates 4, 5 and 6 plans with one selected editor',async()=>{const f=await fixture();try{assert.ok(f.stored().shifts.length>=4);assert.match(f.root.querySelector('#standbyGoal').textContent,/1 \/ 1/);assert.equal(f.root.querySelector('#standbyExcel').disabled,false);assert.equal(f.root.querySelector('#viewOriginal'),null);assert.equal(f.root.querySelector('#recalculateStandby'),null);assert.deepEqual([...f.root.querySelectorAll('[data-scheme]')].map(b=>Number(b.dataset.scheme)),[4,5,6]);assert.deepEqual(Object.keys(f.stored().countPlans),['4','5','6']);assert.equal(f.root.querySelectorAll('#generateStandby').length,1);}finally{await f.close();}});

test('selected recommendation regenerates independently and preserves its edited times after switching and reopening',async()=>{
 const f=await fixture();let saved;
 try{
  const original5=structuredClone(f.stored().countPlans[5]);const original6=structuredClone(f.stored().countPlans[6]);
  await f.root.querySelector('[data-scheme="4"]').onclick();
  const start=f.root.querySelector('[data-shift="0"][data-edge="start"]');start.value='06:05';start.dispatchEvent(new f.dom.window.Event('input'));
  const before=f.requests.length;await f.root.querySelector('#generateStandby').onclick();
  assert.equal(f.requests.length,before+1);assert.equal(f.requests.at(-1).requestedCount,4);assert.equal(f.stored().shifts.length,4);assert.equal(f.stored().shifts[0].start,'0605');
  assert.deepEqual(f.stored().countPlans[5],original5);assert.deepEqual(f.stored().countPlans[6],original6);
  await f.root.querySelector('[data-scheme="5"]').onclick();assert.equal(f.stored().shifts.length,5);assert.deepEqual(f.stored().shifts,original5.shifts);assert.deepEqual(f.stored().fixedNames,[]);
  await f.root.querySelector('[data-scheme="4"]').onclick();assert.equal(f.stored().shifts[0].start,'0605');assert.deepEqual(f.stored().fixedNames,['S1']);
  saved=structuredClone(f.stored());
 }finally{await f.close();}
 const reopened=await fixture(saved);try{assert.equal(reopened.stored().selectedCount,4);assert.equal(reopened.stored().shifts[0].start,'0605');assert.deepEqual(reopened.stored().countPlans[5],saved.countPlans[5]);assert.equal(reopened.root.querySelector('#standbyExcel').disabled,false);}finally{await reopened.close();}
});

test('custom quantity offers 3–6, immediately loads matching times and returns to recommendations',async()=>{
 const f=await fixture();try{
  assert.equal(f.root.querySelector('[data-count-mode="auto"]').getAttribute('aria-pressed'),'true');assert.equal(f.root.querySelector('.standby-count-field').hidden,true);
  await f.root.querySelector('[data-count-mode="custom"]').onclick();assert.equal(f.root.querySelector('.standby-count-field').hidden,false);assert.deepEqual([...f.root.querySelector('#standbyCount').options].filter(o=>!o.disabled).map(o=>o.value),['3','4','5','6']);
  const count=f.root.querySelector('#standbyCount');count.value='3';await count.onchange({target:count});assert.equal(f.stored().shifts.length,3);assert.equal(f.requests.at(-1).requestedCount,3);
  const start=f.root.querySelector('[data-shift="0"][data-edge="start"]');start.value='06:05';start.dispatchEvent(new f.dom.window.Event('input'));await f.root.querySelector('#generateStandby').onclick();assert.equal(f.stored().shifts.length,3);assert.equal(f.stored().shifts[0].start,'0605');
  await f.root.querySelector('[data-count-mode="auto"]').onclick();assert.equal(f.stored().requestedCount,null);assert.equal(f.root.querySelectorAll('[data-scheme]').length,3);
  await f.root.querySelector('[data-count-mode="custom"]').onclick();const three=f.root.querySelector('#standbyCount');three.value='3';await three.onchange({target:three});assert.equal(f.stored().shifts[0].start,'0605');assert.deepEqual(f.stored().fixedNames,['S1']);
 }finally{await f.close();}
});

test('legacy rules migrate while retaining fixed manual times and confirmation',async()=>{const shifts=[{name:'S1',start:'0605',end:'1305'}];const f=await fixture({ruleVersion:'old',planVersion:'old',options:{model:'airport',leadMinutes:45,minimumBuffer:30,maxMinutes:420},shifts,manualRevision:true,baseSummary:{covered:1,total:1}});try{assert.equal(f.stored().options.model,'user-four-hour');assert.equal(f.stored().confirmed,true);assert.deepEqual(f.stored().shifts,shifts);assert.deepEqual(f.stored().fixedNames,['S1']);assert.equal(f.stored().baseSummary,null);assert.equal(f.root.querySelector('#standbyExcel').disabled,false);}finally{await f.close();}});

test('new imports invalidate prior results, require confirmation and automatically generate after confirmation',async()=>{const f=await fixture();try{const file=new Blob(['fixture']);Object.defineProperty(file,'name',{value:'new.xlsx'});await f.root.querySelector('#standbyUpload').onchange({target:{files:[file]}});assert.equal(f.stored().confirmed,false);assert.equal(f.root.querySelector('#generateStandby').disabled,true);assert.equal(f.root.querySelector('#standbyDownloads').hidden,true);assert.equal(f.stored().shifts.length,0);const checked=f.root.querySelector('#standbyTimeZone');checked.checked=true;checked.dispatchEvent(new f.dom.window.Event('change'));f.root.querySelector('#confirmStandbySource').click();await settle();assert.equal(f.stored().confirmed,true);assert.equal(f.stored().duties[0].id,'new');assert.equal(f.root.querySelector('#standbyExcel').disabled,false);}finally{await f.close();}});

test('editing locks exact times, disables stale downloads and preserves them during regeneration',async()=>{const f=await fixture();try{const start=f.root.querySelector('[data-shift="0"][data-edge="start"]');start.value='06:30';start.dispatchEvent(new f.dom.window.Event('input'));const end=f.root.querySelector('[data-shift="0"][data-edge="end"]');end.value='12:30';end.dispatchEvent(new f.dom.window.Event('input'));assert.equal(f.root.querySelector('#standbyExcel').disabled,true);assert.equal(f.root.querySelector('#standbyDownloads').hidden,true);assert.match(f.root.querySelector('#standbyGoal').textContent,/待重新计算/);await f.root.querySelector('#generateStandby').onclick();assert.deepEqual(f.stored().shifts.find(s=>s.name==='S1'),{name:'S1',start:'0630',end:'1230'});assert.deepEqual(f.requests.at(-1).fixedShifts,[{name:'S1',start:'0630',end:'1230'}]);assert.equal(f.root.querySelector('#standbyExcel').disabled,false);f.root.querySelector('[data-unlock="S1"]').click();assert.deepEqual(f.stored().fixedNames,[]);assert.equal(f.root.querySelector('#standbyExcel').disabled,true);}finally{await f.close();}});

test('six-plan custom edits remain in that plan when selecting four',async()=>{const f=await fixture();try{
 await f.root.querySelector('[data-count-mode="custom"]').onclick();const count=f.root.querySelector('#standbyCount');count.value='6';await count.onchange({target:count});assert.equal(f.root.querySelectorAll('.standby-shift').length,6);
 for(const [edge,value] of [['start','10:00'],['end','17:00']]){const input=f.root.querySelector('[data-shift="5"][data-edge="'+edge+'"]');input.value=value;input.dispatchEvent(new f.dom.window.Event('input'));}
 await f.root.querySelector('#generateStandby').onclick();assert.deepEqual(f.stored().shifts[5],{name:'S6',start:'1000',end:'1700'});
 const lower=f.root.querySelector('#standbyCount');lower.value='4';await lower.onchange({target:lower});assert.equal(f.stored().shifts.length,4);assert.deepEqual(f.stored().fixedNames,[]);
 const higher=f.root.querySelector('#standbyCount');higher.value='6';await higher.onchange({target:higher});assert.deepEqual(f.stored().shifts[5],{name:'S6',start:'1000',end:'1700'});assert.deepEqual(f.stored().fixedNames,['S6']);
 }finally{await f.close();}});

test('fully fixed uncovered schedule remains editable and exportable with explicit missing reasons',async()=>{const shifts=[{name:'S1',start:'0630',end:'1230'}],f=await fixture({shifts,requestedCount:1,fixedNames:['S1']});try{await f.root.querySelector('#generateStandby').onclick();assert.match(f.root.querySelector('#standbyGoal').textContent,/0 \/ 1/);assert.equal(f.root.querySelector('#standbyExcel').disabled,false);f.root.querySelector('[data-result-filter="missing"]').click();assert.match(f.root.querySelector('.standby-gap-reasons').textContent,/S1/);assert.match(f.root.querySelector('#standbyResult').textContent,/NX632/);const input=f.root.querySelector('[data-shift="0"][data-edge="start"]');input.value='06:05';input.dispatchEvent(new f.dom.window.Event('input'));await f.root.querySelector('#generateStandby').onclick();assert.match(f.root.querySelector('#standbyGoal').textContent,/1 \/ 1/);assert.match(f.root.querySelector('#standbyResult').textContent,/没有覆盖缺口/);}finally{await f.close();}});

test('new source identity wins over newer cached results and preserves meaningful import warnings',async()=>{
 const saved={duties:[duty],confirmed:true,sourceKind:'excel',dataFileId:'old-source',modifiedAt:'2099-01-01T00:00:00Z',shifts:[{name:'S1',start:'0630',end:'1230'}],requestedCount:1,fixedNames:['S1']};
 const warning='NX632 的 STD－BFTM 不等于 70 分钟，保留原表 BFTM';
 const f=await fixture({duties:[{...duty,id:'fresh'}],confirmed:false,sourceKind:'excel',dataFileId:'new-source',warnings:[warning]},{saved});
 try{assert.equal(f.stored().dataFileId,'new-source');assert.equal(f.stored().duties[0].id,'fresh');assert.deepEqual(f.stored().shifts,[]);assert.deepEqual(f.stored().fixedNames,[]);assert.equal(f.root.querySelector('#standbyExcel').disabled,true);assert.match(f.root.querySelector('.flight-extraction-notes').textContent,/保留原表 BFTM/);assert.equal(f.root.querySelector('.flight-extraction-notes').open,true);}finally{await f.close();}
});

test('reopened mismatched count stays editable without enabling stale exports',async()=>{
 const f=await fixture({shifts:[{name:'S1',start:'0605',end:'1305'}],requestedCount:2,fixedNames:['S1']});
 try{assert.equal(f.root.querySelector('#standbyExcel').disabled,true);assert.match(f.root.querySelector('#standbyError').textContent,/数量不一致/);await f.root.querySelector('#generateStandby').onclick();assert.equal(f.stored().shifts.length,2);assert.deepEqual(f.stored().shifts[0],{name:'S1',start:'0605',end:'1305'});assert.equal(f.root.querySelector('#standbyExcel').disabled,false);}finally{await f.close();}
});
