// Import a reviewed content bundle through owned APIs; never guess or merge users.
import 'dotenv/config';
import fs from 'node:fs/promises';
import { validateCorpus } from '../src/corpus.js';
const base=process.env.LEARNING_BASE_URL||'http://127.0.0.1:3080';
if(!['127.0.0.1','localhost','[::1]'].includes(new URL(base).hostname))throw new Error('内容导入仅允许服务器本机回环地址');
const input=JSON.parse(await fs.readFile(process.argv[2]||'', 'utf8'));
if(input.reviewed!==true)throw new Error('内容须复核后标记 reviewed:true，禁止把未经确认的草稿当标准答案');
if(!process.env.LEARNING_EXPECTED_USER_ID)throw new Error('需设置 LEARNING_EXPECTED_USER_ID 明确内容归属');
const corpus=(input.corpus||[]).map(validateCorpus),banks=input.banks||[],words=input.vocabulary||[];
if(!Array.isArray(banks)||!Array.isArray(words)||banks.length>100||words.length>10000||corpus.length>1000)throw new Error('内容格式或批次大小无效');
for(const bank of banks){if(!bank.title||!Array.isArray(bank.questions)||!bank.questions.length)throw new Error('题库必须有标题及题目');for(const question of bank.questions)if(question.answer==null||question.answer===''||!question.question)throw new Error('每题必须有题干和标准答案');}
const login=await fetch(base+'/api/account/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.LEARNING_ACCOUNT,password:process.env.LEARNING_PASSWORD}),signal:AbortSignal.timeout(15000)});
if(!login.ok)throw new Error('目标账号登录失败');const session=await login.json();
async function api(route,method='GET',body){const response=await fetch(base+route,{method,headers:{'Content-Type':'application/json','x-session-token':session.token},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});const result=await response.json();if(!response.ok)throw new Error(result.error||'导入失败');return result;}
try{
  const me=await api('/api/account/me');if(me.id!==process.env.LEARNING_EXPECTED_USER_ID)throw new Error('账号归属不符，未写入任何内容');
  const oldCorpus=await api('/api/corpus'),oldBanks=await api('/api/banks');
  for(const row of corpus){const previous=oldCorpus.find(x=>x.title===row.title&&x.category===row.category);if(previous&&previous.content!==row.content)throw new Error('已存在同名不同内容的语料，请人工编辑，不自动覆盖');}
  for(const bank of banks)if(oldBanks.some(x=>x.title===bank.title))throw new Error('已存在同名题库，请核对后换名称，不自动覆盖');
  let addedCorpus=0,addedWords=0,addedBanks=0;
  for(let start=0;start<words.length;start+=100){const result=await api('/api/vocabulary/import','POST',{entries:words.slice(start,start+100)});addedWords+=result.added;}
  for(const row of corpus)if(!oldCorpus.some(x=>x.title===row.title&&x.category===row.category)){await api('/api/corpus','POST',row);addedCorpus++;}
  for(const bank of banks){await api('/api/banks','POST',bank);addedBanks++;}
  console.log(JSON.stringify({addedCorpus,addedWords,addedBanks,ownerId:me.id}));
}finally{await api('/api/account/logout','POST').catch(()=>{});delete process.env.LEARNING_PASSWORD;}
