import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

const args=Object.fromEntries(process.argv.slice(2).map(value=>{const [key,...rest]=value.replace(/^--/,'').split('=');return [key,rest.join('=')||true];}));
if(!args.input)throw new Error('请提供 --input=seed-data/xxx.xlsx');
const input=path.resolve(String(args.input)),output=path.resolve(String(args.output||input.replace(/\.xlsx$/i,'-enriched.xlsx'))),batchSize=Math.min(30,Math.max(5,Number(args.batch||20)));
const base=String(process.env.OPENCLAW_BASE_URL||'http://127.0.0.1:18789').replace(/\/$/,'');
if(!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/i.test(base)&&process.env.ALLOW_REMOTE_OPENCLAW!=='1')throw new Error('OpenClaw 入口必须使用服务器回环地址');
const token=process.env.OPENCLAW_GATEWAY_TOKEN,model=process.env.OPENCLAW_TRANSLATION_AGENT||'openclaw/quizforge-translator';
if(!token)throw new Error('请在 .env 配置 OPENCLAW_GATEWAY_TOKEN');

const workbook=new ExcelJS.Workbook();await workbook.xlsx.readFile(input);const sheet=workbook.worksheets[0];if(!sheet)throw new Error('词表没有工作表');
const headers={};sheet.getRow(1).eachCell((cell,col)=>headers[String(cell.text||'').trim()]=col);
for(const required of ['中文','英文','审核状态'])if(!headers[required])throw new Error(`缺少列：${required}`);
const pending=[];
for(let rowNo=2;rowNo<=sheet.rowCount;rowNo++){
  const row=sheet.getRow(rowNo),zh=String(row.getCell(headers['中文']).text||'').trim(),en=String(row.getCell(headers['英文']).text||'').trim();
  if((zh||en)&&(!zh||!en))pending.push({rowNo,term:en||zh,source:en?'en':'zh'});
}

for(let offset=0;offset<pending.length;offset+=batchSize){
  const batch=pending.slice(offset,offset+batchSize),system='你是 QuizForge 中英词典编辑。只返回 JSON 对象，不要 Markdown，格式为 {"entries":[...]}。逐项给出准确、简洁、适合学习的中英文对应，不增加或删除条目。字段必须为 key,zh,en。无法确认时仍返回并把 uncertain 设为 true。';
  const response=await fetch(`${base}/v1/chat/completions`,{method:'POST',headers:{'content-type':'application/json','authorization':`Bearer ${token}`},body:JSON.stringify({model,messages:[{role:'system',content:system},{role:'user',content:JSON.stringify(batch.map((item,index)=>({key:index,source:item.source,term:item.term})))}],temperature:0.1,response_format:{type:'json_object'}}),signal:AbortSignal.timeout(120000)});
  if(!response.ok)throw new Error(`OpenClaw 批量翻译失败：HTTP ${response.status} ${(await response.text()).slice(0,300)}`);
  const payload=await response.json(),content=payload.choices?.[0]?.message?.content||'[]';let parsed;try{parsed=JSON.parse(content);}catch{throw new Error(`OpenClaw 返回的不是 JSON：${content.slice(0,300)}`);}const items=Array.isArray(parsed)?parsed:(parsed.items||parsed.entries||[]);
  for(const item of items){const target=batch[Number(item.key)];if(!target)continue;const row=sheet.getRow(target.rowNo);row.getCell(headers['中文']).value=String(item.zh||'').trim();row.getCell(headers['英文']).value=String(item.en||'').trim();row.getCell(headers['审核状态']).value='needs-review';}
  console.log(`已处理 ${Math.min(offset+batch.length,pending.length)} / ${pending.length}`);
}
await fs.mkdir(path.dirname(output),{recursive:true});await workbook.xlsx.writeFile(output);console.log(JSON.stringify({ok:true,input,output,processed:pending.length},null,2));
