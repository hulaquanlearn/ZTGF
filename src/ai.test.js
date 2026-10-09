import test from 'node:test';
import assert from 'node:assert/strict';

test('OpenClaw 出题固定使用回环 Gateway 并带超时请求',async()=>{
  process.env.AI_PROVIDER='openclaw';process.env.OPENCLAW_BASE_URL='http://127.0.0.1:18789';process.env.OPENCLAW_GATEWAY_TOKEN='test-token';process.env.OPENCLAW_QUESTION_AGENT='openclaw/quizforge-question';
  const original=global.fetch;let called='';global.fetch=async(url,options)=>{called=String(url);assert.ok(options.signal);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({title:'材料练习',questions:[{type:'boolean',question:'材料是否存在？',options:[],answer:true,explanation:'依据材料',rubric:'',points:100,sourceLocator:'第一段'}]})}}]}),{status:200,headers:{'content-type':'application/json'}});};
  try{const {generateQuestions}=await import('./ai.js');const result=await generateQuestions('有效材料'.repeat(30),{count:1,difficulty:'easy'});assert.equal(called,'http://127.0.0.1:18789/v1/chat/completions');assert.equal(result.questions.length,1);}finally{global.fetch=original;}
});
