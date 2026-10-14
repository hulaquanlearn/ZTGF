import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {showData} from '../public/data-manager.js';
import {downloadFile,showDownload,copyDownloadLink} from '../public/downloads.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function environment(path='/data'){
  const dom=new JSDOM('<main id="app"></main>',{url:'http://localhost:3188'+path});
  const names=['document','window','navigator','location','sessionStorage'],previous=new Map(names.map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  names.forEach(key=>Object.defineProperty(globalThis,key,{configurable:true,value:dom.window[key]}));
  dom.window.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
  dom.window.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new dom.window.Event('close'));};
  const messages=[],dialog=(title,body)=>{const node=dom.window.document.createElement('dialog');node.innerHTML=body;dom.window.document.body.append(node);node.showModal();return node;};
  return {dom,app:dom.window.document.querySelector('#app'),messages,dialog,close(){dom.window.close();for(const key of names){if(previous.get(key))Object.defineProperty(globalThis,key,previous.get(key));else delete globalThis[key];}}};
}

test('trash cleanup waits for confirmation, cancellation keeps files and clearing includes filtered-out trash',async()=>{
  const f=environment();let rows=['first','second'].map((id,i)=>({id,name:i?'另一个.txt':'待清理.txt',category:'banks',kind:'import',size:10,status:'已导入',createdAt:'2026-10-12T00:00:00Z',deletedAt:'2026-10-12T01:00:00Z',links:[]}));const calls=[];
  const api=async(url,options={})=>{if(url==='/api/data')return structuredClone(rows);calls.push({url,...options});const ids=url==='/api/data/trash'?JSON.parse(options.body).ids:[url.split('/')[3]];rows=rows.filter(x=>!ids.includes(x.id));return {deleted:ids.length};};
  try{
    await showData({app:f.app,api,esc,json:body=>({body:JSON.stringify(body)}),toast:message=>f.messages.push(message),dialog:f.dialog});f.app.querySelector('#dataTrash').click();
    await f.app.querySelector('[data-purge="first"]').onclick();assert.equal(calls.length,0);f.dom.window.document.querySelector('#cancelPurgeData').click();assert.equal(rows.length,2);
    f.dom.window.document.querySelectorAll('dialog').forEach(node=>node.remove());
    const search=f.app.querySelector('#dataSearch');search.value='待清理';search.dispatchEvent(new f.dom.window.Event('input'));assert.equal(f.app.querySelectorAll('.data-row').length,1);
    f.app.querySelector('#emptyDataTrash').click();assert.equal(calls.length,0);assert.match(f.dom.window.document.querySelector('dialog').textContent,/全部 2 个文件/);
    const confirm=f.dom.window.document.querySelector('#confirmPurgeData');await confirm.onclick({currentTarget:confirm});assert.equal(calls[0].url,'/api/data/trash');assert.deepEqual(JSON.parse(calls[0].body).ids,['first','second']);assert.equal(rows.length,0);assert.equal(f.app.querySelector('#emptyDataTrash').disabled,true);
  }finally{f.close();}
});

test('data management filters functional categories and types, renames, previews, reimports, and restores linked originals',async()=>{
  const f=environment(),rows=[
    {id:'a',name:'原始题目.md',category:'banks',kind:'import',size:100,status:'已关联',createdAt:'2026-10-12T00:00:00Z',links:[{label:'题库',url:'/bank/one'}]},
    {id:'b',name:'当前方案.docx',category:'flights',kind:'export',size:5000,status:'已生成',createdAt:'2026-10-12T00:00:00Z',links:[]},
    {id:'c',name:'英语词汇.xlsx',category:'ielts',kind:'import',size:4000,status:'待确认',createdAt:'2026-10-12T00:00:00Z',links:[],duplicateOf:'prior'},
  ];let reimported;
  const api=async(url,options={})=>{
    if(url==='/api/data')return structuredClone(rows);
    const match=/^\/api\/data\/([^/]+)(?:\/(.+))?$/.exec(url),row=rows.find(x=>x.id===match?.[1]);assert.ok(row,'Known file action');
    if(match[2]==='preview')return {name:row.name,text:'<脚本>必须原样显示'};
    if(match[2]==='reimport')return {dataFileId:row.id,questions:[{question:'重新解析原件'}]};
    if(match[2]==='restore'){row.deletedAt=null;return structuredClone(row);}
    if(options.method==='PATCH'){row.name=JSON.parse(options.body).name;return structuredClone(row);}
    if(options.method==='DELETE'){row.deletedAt='2026-10-12T01:00:00Z';return structuredClone(row);}
    throw Error('Unexpected action');
  };
  try{
    await showData({app:f.app,api,esc,json:body=>({body:JSON.stringify(body)}),toast:message=>f.messages.push(message),dialog:f.dialog,onReimport:async result=>{reimported=result;}});
    assert.equal(f.app.querySelectorAll('.data-row').length,3);assert.equal(f.app.querySelector('.data-links a').getAttribute('href'),'/bank/one');assert.equal(f.app.querySelector('.data-duplicate').textContent,'重复内容');
    f.app.querySelector('[data-category="flights"]').click();assert.equal(f.app.querySelectorAll('.data-row').length,1);assert.equal(f.app.querySelector('.data-info h3').textContent,'当前方案.docx');
    f.app.querySelector('[data-category=""]').click();const kind=f.app.querySelector('#dataKind');kind.value='import';kind.dispatchEvent(new f.dom.window.Event('change'));assert.equal(f.app.querySelectorAll('.data-row').length,2);
    const search=f.app.querySelector('#dataSearch');search.value='英语';search.dispatchEvent(new f.dom.window.Event('input'));assert.equal(f.app.querySelectorAll('.data-row').length,1);search.value='';search.dispatchEvent(new f.dom.window.Event('input'));
    await f.app.querySelector('[data-preview="a"]').onclick();assert.equal(f.dom.window.document.querySelector('.data-preview').textContent,'<脚本>必须原样显示');assert.equal(f.dom.window.document.querySelector('.data-preview').children.length,0);
    await f.app.querySelector('[data-rename="a"]').onclick();const form=f.dom.window.document.querySelector('#renameData');form.querySelector('input').value='改名后的原件.md';await form.onsubmit({preventDefault(){}});assert.equal(f.app.querySelector('.data-info h3').textContent,'改名后的原件.md');
    await f.app.querySelector('[data-reimport="a"]').onclick();assert.equal(reimported.dataFileId,'a');
    await f.app.querySelector('[data-delete="a"]').onclick();const confirm=f.dom.window.document.querySelector('#confirmDeleteData');await confirm.onclick({currentTarget:confirm});assert.equal(f.app.querySelectorAll('.data-row').length,1);
    f.app.querySelector('#dataTrash').click();assert.equal(f.app.querySelector('.data-links a').getAttribute('href'),'/bank/one');await f.app.querySelector('[data-restore="a"]').onclick();assert.equal(f.app.querySelectorAll('.data-row').length,0);
    f.app.querySelector('[data-category="banks"]').click();assert.equal(f.app.querySelectorAll('.data-row').length,1);assert.ok(f.messages.includes('已恢复'));
  }finally{f.close();}
});

test('generated downloads use one real HTTP capability link without putting session credentials in the URL',async()=>{
  const f=environment('/flights/standby'),previous=globalThis.fetch;let captured;
  const grant={url:'/downloads/'+'a'.repeat(64),name:'当前方案.docx'};
  globalThis.fetch=async(url,options)=>{captured={url,options};return {ok:true,json:async()=>grant};};
  try{
    sessionStorage.setItem('quizforge-session-token','session-only-in-header');const node=await downloadFile('/api/flights/standby/export/docx','当前方案.docx',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(captured.options.headers.get('x-session-token'),'session-only-in-header');assert.equal(captured.options.headers.get('x-download-mode'),'managed');assert.equal(captured.options.headers.get('x-data-category'),'flights');assert.equal(captured.options.headers.get('Content-Type'),'application/json');
    const anchor=node.querySelector('a[download]');assert.equal(anchor.href,'http://localhost:3188'+grant.url);assert.ok(!anchor.href.includes('session'));assert.ok(!anchor.href.startsWith('blob:'));assert.equal(anchor.download,'当前方案.docx');anchor.onclick();assert.match(node.querySelector('[data-download-status]').textContent,/已发起下载/);
    assert.throws(()=>showDownload({...grant,url:'http://elsewhere.test/token'}),/无效/);showDownload(grant);assert.equal(document.querySelectorAll('.download-dialog').length,1);
  }finally{globalThis.fetch=previous;f.close();}
});

test('clipboard denial falls back to a selected HTTP link so restricted mobile browsers can copy it',async()=>{
  const f=environment();try{
    Object.defineProperty(f.dom.window,'isSecureContext',{value:true});Object.defineProperty(f.dom.window.navigator,'clipboard',{value:{writeText:async()=>{throw Error('permission denied');}}});
    const link='http://localhost:3188/downloads/'+'b'.repeat(64);document.execCommand=command=>{assert.equal(command,'copy');assert.equal(document.querySelector('textarea').value,link);return true;};
    await copyDownloadLink(link);assert.equal(document.querySelector('textarea'),null);
  }finally{f.close();}
});

test('one source appears in each of its functional categories and counts once in all data, including after trash and restore',async()=>{
  const f=environment(),rows=[
    {id:'mixed',name:'多方向词汇.csv',category:'postgraduate',categories:['postgraduate','ielts','ielts'],kind:'import',size:100,status:'已关联',createdAt:'2026-10-12T00:00:00Z',links:[]},
    {id:'single',name:'雅思原件.txt',category:'ielts',kind:'import',size:100,status:'待确认',createdAt:'2026-10-12T00:00:00Z',links:[]},
    {id:'bank',name:'题库原件.md',category:'banks',kind:'import',size:100,status:'待确认',createdAt:'2026-10-12T00:00:00Z',links:[]},
  ];
  const api=async(url,options={})=>{if(url==='/api/data')return structuredClone(rows);if(options.method==='DELETE')rows[0].deletedAt='2026-10-12T01:00:00Z';else if(url.endsWith('/restore'))rows[0].deletedAt=null;else throw Error('Unexpected action');return structuredClone(rows[0]);};
  const count=category=>Number(f.app.querySelector('[data-category="'+category+'"] span').textContent);
  try{
    await showData({app:f.app,api,esc,json:body=>({body:JSON.stringify(body)}),toast:()=>{},dialog:f.dialog,onReimport:async()=>{}});
    assert.equal(count(''),3);assert.equal(count('postgraduate'),1);assert.equal(count('ielts'),2);assert.equal(count('banks'),1);
    f.app.querySelector('[data-category="postgraduate"]').click();assert.equal(f.app.querySelectorAll('.data-row').length,1);assert.match(f.app.querySelector('.data-info .meta').textContent,/考研英语 \/ 雅思学习/);
    f.app.querySelector('[data-category="ielts"]').click();assert.equal(f.app.querySelectorAll('.data-row').length,2);assert.equal(f.app.querySelectorAll('[data-download="mixed"]').length,1);
    await f.app.querySelector('[data-delete="mixed"]').onclick();const confirm=document.querySelector('#confirmDeleteData');await confirm.onclick({currentTarget:confirm});assert.equal(count(''),2);assert.equal(count('postgraduate'),0);assert.equal(count('ielts'),1);
    f.app.querySelector('#dataTrash').click();await f.app.querySelector('[data-restore="mixed"]').onclick();assert.equal(count(''),3);assert.equal(count('postgraduate'),1);assert.equal(count('ielts'),2);
  }finally{f.close();}
});
