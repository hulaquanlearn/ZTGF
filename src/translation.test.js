import test from 'node:test';
import assert from 'node:assert/strict';
import {detectLanguage,translateText} from './translation.js';

test('自动识别中文和英文',()=>{assert.equal(detectLanguage('你好'),'zh');assert.equal(detectLanguage('hello'),'en');assert.equal(detectLanguage('12345'),null);});

test('OpenClaw 翻译使用回环 Gateway 并解析中英 JSON',async()=>{
  const old={provider:process.env.TRANSLATION_PROVIDER,token:process.env.OPENCLAW_GATEWAY_TOKEN,base:process.env.OPENCLAW_BASE_URL},originalFetch=global.fetch;
  process.env.TRANSLATION_PROVIDER='openclaw';process.env.OPENCLAW_GATEWAY_TOKEN='test-token';process.env.OPENCLAW_BASE_URL='http://127.0.0.1:18789';
  global.fetch=async(url,options)=>{assert.equal(url,'http://127.0.0.1:18789/v1/chat/completions');assert.equal(options.headers.Authorization,'Bearer test-token');return new Response(JSON.stringify({choices:[{message:{content:'{"source":"zh","translations":{"en":"hello"}}'}}]}),{status:200,headers:{'Content-Type':'application/json'}});};
  try{const result=await translateText('你好',{source:'auto',targets:['en']});assert.equal(result.provider,'openclaw');assert.deepEqual(result.translations,{en:'hello'});}finally{global.fetch=originalFetch;for(const [key,value] of Object.entries({TRANSLATION_PROVIDER:old.provider,OPENCLAW_GATEWAY_TOKEN:old.token,OPENCLAW_BASE_URL:old.base}))value===undefined?delete process.env[key]:process.env[key]=value;}
});

test('OpenClaw 默认拒绝非回环地址',async()=>{const old={provider:process.env.TRANSLATION_PROVIDER,token:process.env.OPENCLAW_GATEWAY_TOKEN,base:process.env.OPENCLAW_BASE_URL};process.env.TRANSLATION_PROVIDER='openclaw';process.env.OPENCLAW_GATEWAY_TOKEN='x';process.env.OPENCLAW_BASE_URL='http://example.com:18789';try{await assert.rejects(()=>translateText('hello',{targets:['zh']}),/回环地址/);}finally{for(const [key,value] of Object.entries({TRANSLATION_PROVIDER:old.provider,OPENCLAW_GATEWAY_TOKEN:old.token,OPENCLAW_BASE_URL:old.base}))value===undefined?delete process.env[key]:process.env[key]=value;}});
