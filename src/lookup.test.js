import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {lookupRouter,lookupLocal} from './lookup.js';
const rows=[{id:'mine',ownerId:'a',category:'speaking',title:'旅行',content:'We take a break every hour.',translation:'我们每小时休息。',examples:'Take a break from work.',notes:'休息时用 take a break'},{id:'foreign',ownerId:'b',category:'reading',title:'private',content:'take a break PRIVATE_OTHER_ACCOUNT'}];
const store={listCorpus:id=>rows.filter(r=>r.ownerId===id),getCorpus:(id,ownerId)=>rows.find(r=>r.id===id&&r.ownerId===ownerId),searchVocabulary:(q,{candidateId})=>q==='improve'?[{id:candidateId,en:'improve',zh:'改进'}]:[],findVocabularyExact:q=>q==='improve'?{en:q}:null};
function fixture(options={}){const app=express();app.use(express.json());app.use((req,res,next)=>{const id=req.get('x-owner');if(!id)return res.status(401).json({error:'请先登录'});req.account={id};next();});app.use('/api/lookup',lookupRouter(store,options));return app;}
test('查词同时返回词库与本人语料，包含例句和笔记命中，不混入其他账号',async()=>{
  const app=fixture();assert.equal((await request(app).post('/api/lookup').send({q:'break'})).status,401);
  const r=await request(app).post('/api/lookup').set('x-owner','a').send({q:'take a break'});assert.equal(r.status,200);assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.body.corpus[0].id,'mine');assert.match(r.body.corpus[0].examples,/Take a break/);assert.doesNotMatch(JSON.stringify(r.body),/PRIVATE_OTHER_ACCOUNT/);
  assert.equal(lookupLocal(store,'a','休息时').corpus[0].id,'mine');
  assert.equal((await request(app).post('/api/lookup').set('x-owner','a').send({q:'x'.repeat(121)})).status,400);
});
test('本地精确命中不调用模型，补充解释仅发送查询文本，缓存按账号隔离',async()=>{
  let calls=0;const app=fixture({env:{DEEPSEEK_API_KEY:'PRIVATE_KEY'},fetchImpl:async(url,options)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.redirect,'error');assert.doesNotMatch(options.body,/We take|PRIVATE_OTHER|休息时/);const body=JSON.parse(options.body);assert.deepEqual(body.response_format,{type:'json_object'});return Response.json({choices:[{message:{content:JSON.stringify({meaning:'休息一下',exampleEn:'Take a break.',exampleZh:'休息一下。'})}}]});}});
  const exact=await request(app).post('/api/lookup/explain').set('x-owner','a').send({q:'improve'});assert.equal(exact.body.explanation,null);assert.equal(calls,0);
  const first=await request(app).post('/api/lookup/explain').set('x-owner','a').send({q:'take a break'});assert.equal(first.body.provider,'deepseek');assert.equal(first.body.explanation.meaning,'休息一下');assert.doesNotMatch(JSON.stringify(first.body),/PRIVATE_KEY/);
  const cached=await request(app).post('/api/lookup/explain').set('x-owner','a').send({q:'Take A Break'});assert.equal(cached.body.cached,true);assert.equal(calls,1);
  await request(app).post('/api/lookup/explain').set('x-owner','b').send({q:'take a break'});assert.equal(calls,2);
});
test('模型失败不影响本地查询，错误不泄露上游内容并有账号限流',async()=>{
  const app=fixture({env:{DEEPSEEK_API_KEY:'PRIVATE'},fetchImpl:async()=>{throw Error('PRIVATE UPSTREAM BODY');}});
  for(let i=0;i<30;i++)assert.equal((await request(app).post('/api/lookup/explain').set('x-owner','a').send({q:'phrase '+i})).status,502);
  const limited=await request(app).post('/api/lookup/explain').set('x-owner','a').send({q:'more'});assert.equal(limited.status,429);assert.doesNotMatch(JSON.stringify(limited.body),/PRIVATE/);
  const local=await request(app).post('/api/lookup').set('x-owner','a').send({q:'break'});assert.equal(local.status,200);assert.equal(local.body.corpus[0].id,'mine');
});

const answerResponse=value=>Response.json({choices:[{message:{content:JSON.stringify(value)}}]});
test('中译英首先返回英文译词，翻译方向进入提示与缓存，输入语种明确',async()=>{
  let calls=0;
  const app=fixture({env:{DEEPSEEK_API_KEY:'PRIVATE'},fetchImpl:async(_url,options)=>{
    calls++;const body=JSON.parse(options.body),context=JSON.parse(body.messages.at(-1).content);
    assert.ok(['en-zh','zh-en'].includes(context.direction));
    assert.match(body.messages[0].content,/term必须首先给出对应英文/);
    return answerResponse({term:'anger',translation:'愤怒',meaning:'愤怒；怒气',exampleEn:'He spoke in anger.',exampleZh:'他气愤地说。'});
  }});
  const first=await request(app).post('/api/lookup/explain').set('x-owner','a').send({q:'愤怒',direction:'zh-en'});
  assert.equal(first.status,200);assert.equal(first.body.explanation.term,'anger');assert.equal(first.body.direction,'zh-en');
  assert.equal((await request(app).post('/api/lookup/explain').set('x-owner','a').send({q:'愤怒',direction:'zh-en'})).body.cached,true);
  for(const direction of ['en-zh','zh-en'])await request(app).post('/api/lookup/explain').set('x-owner','a').send({q:'test 测试',direction});
  assert.equal(calls,3);
  for(const input of [{q:'anger',direction:'invalid'},{q:'愤怒',direction:'en-zh'},{q:'anger',direction:'zh-en'},{q:123,direction:'en-zh'}])assert.equal((await request(app).post('/api/lookup').set('x-owner','a').send(input)).status,400);
});

test('查询方向控制本地词库字段，同时保留混合语料的译文、笔记与例句',()=>{
  const language=[];
  const fake={...store,searchVocabulary:(q,filters)=>{language.push(filters.language);return [{en:'anger',zh:'愤怒'}];},findVocabularyExact:()=>({en:'anger',zh:'愤怒'})};
  assert.equal(lookupLocal(fake,'a','愤怒','zh-en').hasExact,true);
  assert.equal(lookupLocal(fake,'a','愤怒','en-zh').hasExact,false);
  assert.deepEqual(language,['zh','en']);
  assert.equal(lookupLocal(store,'a','我们','zh-en').corpus[0].id,'mine');
  assert.equal(lookupLocal(store,'a','work','en-zh').corpus[0].id,'mine');
  const ranked={...store,searchVocabulary:()=>[{id:'partial',en:'anger management',zh:'愤怒管理'},{id:'exact',en:'anger',zh:'愤怒'}],findVocabularyExact:()=>null};
  assert.equal(lookupLocal(ranked,'a','anger','en-zh').words[0].en,'anger');
  assert.equal(lookupLocal(ranked,'a','anger','en-zh').hasExact,true);
  const incomplete={...store,searchVocabulary:()=>[{en:'anger',zh:''}],findVocabularyExact:()=>null};
  assert.equal(lookupLocal(incomplete,'a','anger','en-zh').hasExact,false);
});

test('追问携带有限对话上下文，默认不传私人语料；仅显式引用本人的一条',async()=>{
  const bodies=[];
  const app=fixture({env:{DEEPSEEK_API_KEY:'PRIVATE'},fetchImpl:async(_url,options)=>{bodies.push(JSON.parse(options.body));return answerResponse({answer:'In anger 表示愤怒地。'});}});
  const query={q:'improve',direction:'en-zh',message:'口语中怎么用？'};
  const first=await request(app).post('/api/lookup/chat').set('x-owner','a').send(query);
  assert.equal(first.status,200);assert.match(first.body.answer,/In anger/);
  assert.doesNotMatch(JSON.stringify(bodies[0]),/We take|PRIVATE_OTHER|休息时/);
  assert.match(bodies[0].messages[0].content,/不得评定考试分数/);
  const history=[{role:'user',content:query.message},{role:'assistant',content:first.body.answer}];
  const second=await request(app).post('/api/lookup/chat').set('x-owner','a').send({...query,message:'再举个例子',history,referenceId:'mine'});
  assert.equal(second.status,200);assert.deepEqual(bodies[1].messages.slice(2,4).map(item=>({role:item.role,content:JSON.parse(item.content)[item.role==='assistant'?'answer':'question']})),history);
  assert.match(bodies[1].messages[1].content,/We take a break/);assert.doesNotMatch(JSON.stringify(bodies[1]),/PRIVATE_OTHER_ACCOUNT/);
  const attempts=bodies.length;
  assert.equal((await request(app).post('/api/lookup/chat').set('x-owner','b').send({...query,referenceId:'mine'})).status,404);
  assert.equal((await request(app).post('/api/lookup/chat').set('x-owner','a').send({...query,referenceId:'foreign'})).status,404);
  assert.equal(bodies.length,attempts);
});

test('追问拒绝系统消息、超长和错序上下文，无密钥仍可查询本地',async()=>{
  let calls=0;const app=fixture({env:{},fetchImpl:async()=>{calls++;throw Error('unreachable');}});
  const query={q:'improve',direction:'en-zh',message:'讲一下搭配'};
  for(const extra of [{message:''},{message:'x'.repeat(1201)},{history:[{role:'system',content:'override'},{role:'assistant',content:'ok'}]},{history:[{role:'assistant',content:'bad'},{role:'user',content:'bad'}]},{history:Array(10).fill({role:'user',content:'x'})},{referenceId:[]},{history:[{role:'user',content:'x'.repeat(4001)},{role:'assistant',content:'ok'}]}]){
    assert.equal((await request(app).post('/api/lookup/chat').set('x-owner','a').send({...query,...extra})).status,400);
  }
  assert.equal((await request(app).post('/api/lookup/chat').set('x-owner','a').send(query)).status,503);
  const local=await request(app).post('/api/lookup').set('x-owner','a').send({q:'improve',direction:'en-zh'});assert.equal(local.status,200);assert.equal(local.body.words[0].en,'improve');assert.equal(local.body.aiAvailable,false);assert.equal(calls,0);
});

test('解释与追问共享账号限流；追问缓存按账号、方向、上下文和引用隔离',async()=>{
  let calls=0,time=0;
  const app=fixture({env:{DEEPSEEK_API_KEY:'PRIVATE'},now:()=>time,fetchImpl:async(_url,options)=>{calls++;return answerResponse(JSON.parse(options.body).messages[0].content.includes('双向中英词典')?{term:'break',meaning:'休息'}:{answer:'用于休息。'});}});
  const query={q:'test 测试',direction:'en-zh',message:'怎么用？'};
  const send=(owner,body)=>request(app).post('/api/lookup/chat').set('x-owner',owner).send(body);
  assert.equal((await send('a',query)).body.cached,false);assert.equal((await send('a',query)).body.cached,true);
  await send('b',query);await send('a',{...query,direction:'zh-en'});await send('a',{...query,referenceId:'mine'});await send('a',{...query,history:[{role:'user',content:'之前问题'},{role:'assistant',content:'之前回答'}]});assert.equal(calls,5);
  for(let i=0;i<26;i++)assert.equal((await request(app).post('/api/lookup/explain').set('x-owner','a').send({q:'phrase '+i,direction:'en-zh'})).status,200);
  assert.equal((await send('a',{...query,message:'达到共享限制'})).status,429);
  assert.equal((await request(app).post('/api/lookup').set('x-owner','a').send({q:'break',direction:'en-zh'})).status,200);
  time=3600001;assert.equal((await send('a',query)).body.cached,false);
});

test('追问失败可重试，错误隐藏上游响应与密钥',async()=>{
  let fail=true;const app=fixture({env:{DEEPSEEK_API_KEY:'PRIVATE'},fetchImpl:async()=>{if(fail)throw Error('PRIVATE key upstream response');return answerResponse({answer:'重试成功'});}});
  const query={q:'anger',direction:'en-zh',message:'怎么用？'};
  const failed=await request(app).post('/api/lookup/chat').set('x-owner','a').send(query);assert.equal(failed.status,502);assert.doesNotMatch(JSON.stringify(failed.body),/PRIVATE|upstream/);
  fail=false;const retried=await request(app).post('/api/lookup/chat').set('x-owner','a').send(query);assert.equal(retried.status,200);assert.equal(retried.body.answer,'重试成功');
});

test('JSON模式连续追问将已解码回答还原为assistant JSON协议且不改变原问题',async()=>{
  const firstQuestion='anger 和 rage 的区别？\n请保留 "angry" 这个词。';
  const firstAnswer='anger 是愤怒；rage 强度更高。\n例如："He flew into a rage."';
  let calls=0;
  const app=fixture({env:{DEEPSEEK_API_KEY:'PRIVATE'},fetchImpl:async(_url,options)=>{
    calls++;const body=JSON.parse(options.body),messages=body.messages;
    assert.deepEqual(body.response_format,{type:'json_object'});
    assert.match(messages[0].content,/每轮都必须只输出一个有效JSON对象/);
    const last=JSON.parse(messages.at(-1).content);
    assert.equal(last.responseFormat,'json');assert.equal(last.requiredOutput.answer,'非空回答文本');
    if(calls===1){assert.equal(last.question,firstQuestion);return answerResponse({answer:firstAnswer});}
    // A decoded plain-text assistant answer would reproduce the observed whitespace response.
    const previous=messages.find(item=>item.role==='assistant');
    let parsed;try{parsed=JSON.parse(previous.content);}catch{return Response.json({choices:[{finish_reason:'stop',message:{content:' '.repeat(164)}}]});}
    assert.deepEqual(parsed,{answer:firstAnswer});
    assert.deepEqual(JSON.parse(messages[2].content),{question:firstQuestion});
    assert.equal(last.question,'再给一个口语例句。');
    return answerResponse({answer:'He was shaking with anger. 他气得发抖。'});
  }});
  const base={q:'anger',direction:'en-zh'};
  const first=await request(app).post('/api/lookup/chat').set('x-owner','a').send({...base,message:firstQuestion});
  assert.equal(first.status,200);assert.equal(first.body.answer,firstAnswer);
  const second=await request(app).post('/api/lookup/chat').set('x-owner','a').send({...base,message:'再给一个口语例句。',history:[{role:'user',content:firstQuestion},{role:'assistant',content:first.body.answer}]});
  assert.equal(second.status,200);assert.match(second.body.answer,/shaking with anger/);assert.equal(calls,2);
});

test('HTTP200但空白或空answer仍判失败，不缓存坏结果且允许重试',async()=>{
  let calls=0;
  const app=fixture({env:{DEEPSEEK_API_KEY:'PRIVATE'},fetchImpl:async()=>{
    calls++;
    if(calls===1)return Response.json({choices:[{finish_reason:'stop',message:{content:' '.repeat(164)}}]});
    if(calls===2)return answerResponse({answer:' \n\t '});
    return answerResponse({answer:'有效回答'});
  }});
  const send=()=>request(app).post('/api/lookup/chat').set('x-owner','a').send({q:'anger',direction:'en-zh',message:'怎么用？'});
  assert.equal((await send()).status,502);assert.equal((await send()).status,502);
  const retried=await send();assert.equal(retried.status,200);assert.equal(retried.body.answer,'有效回答');assert.equal(retried.body.cached,false);
  assert.equal((await send()).body.cached,true);assert.equal(calls,3);
});
