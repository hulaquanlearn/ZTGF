import express from 'express';
import fs from 'node:fs/promises';
import pdf from 'pdf-parse';
import ExcelJS from 'exceljs';
import { flightDraftRouter } from './flight-drafts.js';
import { standbyRouter, timetableDuties } from './standby.js';

const names = {MFM:'澳门',PEK:'北京首都',SHA:'上海虹桥',PVG:'上海浦东',NKG:'南京',CZX:'常州',TAO:'青岛',HGH:'杭州',NGB:'宁波',WNZ:'温州',XMN:'厦门',FOC:'福州',CTU:'成都双流',CKG:'重庆',KWE:'贵阳',KHH:'高雄',TPE:'台北桃园',RMQ:'台中',BKK:'曼谷素万那普',SIN:'新加坡',KUL:'吉隆坡',HAN:'河内',DAD:'岘港',ICN:'首尔仁川',NRT:'东京成田',KIX:'大阪关西',FUK:'福冈'};
const zones = {BKK:'Asia/Bangkok',HAN:'Asia/Ho_Chi_Minh',DAD:'Asia/Ho_Chi_Minh',ICN:'Asia/Seoul',NRT:'Asia/Tokyo',KIX:'Asia/Tokyo',FUK:'Asia/Tokyo'};
const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function parseDate(value, start, end) {
  const m = /^(\d{1,2})([A-Za-z]{3})(\d{4})?$/.exec(value);
  if (!m) throw new Error('有效日期无法识别');
  const month = months.findIndex(x=>x.toLowerCase()===m[2].toLowerCase())+1;
  if (!month) throw new Error('有效月份无法识别');
  const year = m[3] || (month < Number(start.slice(5,7)) ? end.slice(0,4) : start.slice(0,4));
  return `${year}-${String(month).padStart(2,'0')}-${m[1].padStart(2,'0')}`;
}
export function parseFlightText(text) {
  const period = /WITH EFFECT FROM\s+(\d{1,2}[A-Za-z]{3}\d{4})\s+to\s+(\d{1,2}[A-Za-z]{3}\d{4})/i.exec(text);
  if (!period) throw new Error('未识别到时刻表有效期，请使用含 WITH EFFECT FROM 的时刻表');
  const start = parseDate(period[1],'2000-01-01','2000-12-31'), end = parseDate(period[2],start,start);
  const flights=[], warnings=[];
  const re=/([A-Z]{2}\d{3,4})\s*([1-7_](?:\s*[1-7_]){6})\s*([A-Z]{3})\s*(\d{4})\s*([A-Z]{3})\s*(\d{4})\s*([A-Z]\d{3})/g;
  for (const match of text.matchAll(re)) {
    const prefix=text.slice(text.lastIndexOf('\n',match.index)+1,match.index);
    const range=/Between\s+(\d{1,2}[A-Za-z]{3}(?:\d{4})?)\s+and\s+(\d{1,2}[A-Za-z]{3}(?:\d{4})?)/i.exec(prefix);
    const [,number,days,from,departure,to,arrival,aircraft]=match;
    if (![departure,arrival].every(t=>Number(t.slice(0,2))<24&&Number(t.slice(2))<60)) throw new Error(`${number} 时间无效`);
    flights.push({id:String(flights.length),number,days:days.replace(/\s/g,''),from,to,departure,arrival,aircraft,start:range?parseDate(range[1],start,end):start,end:range?parseDate(range[2],start,end):end,source:match[0],fromName:names[from]||from,toName:names[to]||to,fromZone:zones[from]||(names[from]?'Asia/Shanghai':''),toZone:zones[to]||(names[to]?'Asia/Shanghai':'')});
  }
  // Some PDFs position the date annotation after the notes rather than beside its row.
  const last=flights.at(-1);
  const tail=text.slice([...text.matchAll(re)].at(-1)?.index||0);
  const dangling=/\nBetween\s+(\d{1,2}[A-Za-z]{3}(?:\d{4})?)\s+and\s+(\d{1,2}[A-Za-z]{3}(?:\d{4})?)\s*$/.exec(tail);
  if(dangling&&last){last.start=parseDate(dangling[1],start,end);last.end=parseDate(dangling[2],start,end);last.reviewNote='日期注释位于页尾，请对照原文确认有效期。';warnings.push(`${last.number} 的日期注释位于页尾，已归入最后一条记录，请对照原文确认。`);}
  if(!flights.length) throw new Error('未提取到航班。扫描 PDF 需先 OCR；当前支持此类七位班期时刻表。');
  const mentions=[...text.matchAll(/[A-Z]{2}\d{3,4}/g)].length;
  if(mentions>flights.length)warnings.push('文档有未形成完整航班记录的航班号（可能为待公布计划），请核对原文。');
  return {start,end,flights,warnings};
}
export function addDays(date,days){return new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);}
export function operates(f,date){const d=new Date(date+'T00:00:00Z');return date>=f.start&&date<=f.end&&f.days.includes(String(d.getUTCDay()||7));}
export function instant(date,time,zone){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{4}$/.test(time)||Number(time.slice(0,2))>23||Number(time.slice(2))>59)throw new Error('日期或时间无效');
  const target=Date.parse(`${date}T${time.slice(0,2)}:${time.slice(2)}:00Z`);
  if(!Number.isFinite(target)||new Date(target).toISOString().slice(0,10)!==date)throw new Error('日期无效');
  const format=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  let guess=target;
  for(let i=0;i<3;i++){const p=Object.fromEntries(format.formatToParts(guess).map(x=>[x.type,x.value]));const local=Date.parse(`${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00Z`);guess+=target-local;}
  return guess;
}
function leg(f,date){const dep=instant(date,f.departure,f.fromZone);let arr=instant(date,f.arrival,f.toZone);if(arr<dep)arr=instant(addDays(date,1),f.arrival,f.toZone);return {dep,arr};}
function display(ms,base){const d=new Date(ms+8*3600000);const day=d.toISOString().slice(0,10),offset=Math.round((Date.parse(day)-Date.parse(base))/86400000);return d.toISOString().slice(11,16).replace(':','')+(offset?` (${offset>0?'+':''}${offset}日)`:'');}
export function buildRows({flights,pairs,date,mode='daily'}){
  if(!Array.isArray(flights)||flights.length>1000||!Array.isArray(pairs)||!pairs.length||pairs.length>500)throw new Error('请选择至少一组航班');
  if(mode!=='season')instant(date,'0000','Asia/Shanghai');
  if(new Set(flights.map(f=>f.id)).size!==flights.length)throw new Error('航班记录编号重复');
  const used=new Map(),groups=[],pairKeys=new Set();
  for(const p of pairs){
    const pairKey=JSON.stringify([p.outId,p.backId,p.returnDays]);if(pairKeys.has(pairKey))throw Error('同一日期航班不能重复配对');pairKeys.add(pairKey);
    const out=flights.find(f=>f.id===p.outId),back=flights.find(f=>f.id===p.backId);
    if(!out||!back||out.from!==back.to||out.to!==back.from)throw new Error('去回程机场不匹配');
    for(const f of [out,back]){
      if(!/^[A-Z]{2}\d{3,4}$/.test(f.number)||!/^[A-Z]{3}$/.test(f.from)||!/^[A-Z]{3}$/.test(f.to)||!/^([1_]([2_])([3_])([4_])([5_])([6_])([7_]))$/.test(f.days))throw new Error('航班号、机场代码或七位班期格式无效');
      instant(f.start,'0000','Asia/Shanghai');instant(f.end,'0000','Asia/Shanghai');
      if(!f.fromZone||!f.toZone)throw new Error(`${f.number} 缺少机场时区，请先填写`);
    }
    if(!Number.isInteger(p.returnDays)||p.returnDays<0||p.returnDays>7)throw new Error('请选择当天或过夜回程天数');
    const validDates=[];
    if(mode==='season'){
      const start=out.start>addDays(back.start,-p.returnDays)?out.start:addDays(back.start,-p.returnDays),end=out.end<addDays(back.end,-p.returnDays)?out.end:addDays(back.end,-p.returnDays);
      if((Date.parse(end)-Date.parse(start))/86400000>730)throw new Error('整季有效期最长支持两年');
      for(let day=start;day<=end;day=addDays(day,1))if(operates(out,day)&&operates(back,addDays(day,p.returnDays)))validDates.push(day);
    }else if(operates(out,date)&&operates(back,addDays(date,p.returnDays)))validDates.push(date);
    if(!validDates.length)throw new Error(mode==='season'?`${out.number}/${back.number} 没有同时符合班期和有效期的日期`:`${out.number}/${back.number} 在所选日期不执飞`);
    for(const t of [p.outOpening,p.backOpening])if(t&&!/^([01]\d|2[0-3])[0-5]\d$/.test(t))throw new Error('开会时间请填写四位时间，例如 0650');
    const variants=new Map();
    for(const day of validDates){
      const returnDate=addDays(day,p.returnDays),a=leg(out,day),b=leg(back,returnDate);
      if(b.dep<a.arr)throw new Error(`${back.number} 离港早于去程到港，请调整回程或过夜天数`);
      for(const [f,d] of [[out,day],[back,returnDate]]){const key=`${f.number}:${f.from}:${f.to}:${d}`;if(used.has(key)&&!(p.alternative===true&&used.get(key)===p.outId))throw new Error('同一日期航班不能重复配对；另一回程方案须人工标记为备选');used.set(key,p.outId);}
      const row=(f,l,isBack)=>[names[out.to]||out.to,out.to,f.number+(isBack&&p.returnDays?`+${p.returnDays}`:''),`${names[f.from]||f.from}→${names[f.to]||f.to}`,f.from,(isBack?p.backOpening:p.outOpening)||'',display(l.dep,day),f.to,display(l.arr,day),mode==='season'?'整季适用日期见配对记录':isBack?returnDate:day,f.days.replaceAll('_',''),f.aircraft,f.start,f.end,p.returnDays?'过夜':'当天往返'];
      const rows=[row(out,a,false),row(back,b,true)],key=JSON.stringify(rows.map(r=>r.slice(0,9)));
      if(!variants.has(key))variants.set(key,{time:a.dep-Date.parse(day),rows,dates:[]});variants.get(key).dates.push(day);
    }
    groups.push(...[...variants.values()].map(g=>({...g,rows:g.rows.map(r=>Object.assign([...r,g.dates.join(', ')],{pair:{outId:p.outId,backId:p.backId}}))})));
  }
  return groups.sort((a,b)=>a.time-b.time).flatMap(x=>x.rows);
}
export const headers=['航点','航点代码','航班号','方向','出发地','开会时间','离港时间（北京时间）','目的地','到港时间（北京时间）','执飞日期（出发地当地）','班期（周一至周日）','机型','有效期开始','有效期结束','人工安排','配对适用日期（去程当地）'];
export async function flightWorkbook(data){
  const rows=buildRows(data),book=new ExcelJS.Workbook(),sheet=book.addWorksheet('航班时刻表');
  sheet.addRow(headers.slice(0,9));rows.forEach(r=>sheet.addRow(r.slice(0,9)));sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:`I${rows.length+1}`};
  sheet.columns.forEach((c,i)=>c.width=[20,12,14,24,12,16,24,12,24,24,22,12,16,16,16][i]);
  sheet.eachRow((r,n)=>{r.height=n===1?36:26;r.eachCell(c=>{c.numFmt='@';c.font={name:'微软雅黑',size:11,color:{argb:n===1?'FFFFFFFF':'FF243746'},bold:n===1};c.alignment={vertical:'middle',horizontal:'center',wrapText:true};c.fill={type:'pattern',pattern:'solid',fgColor:{argb:n===1?'FF176B57':Math.floor((n-2)/2)%2?'FFF0F6F4':'FFFFFFFF'}};});});
  sheet.getCell('F1').note='开会时间由人工填写，未填写时留空；不是 PDF 提取字段。';
  const source=book.addWorksheet('航班原始信息');source.addRow(['航班号','班期','出发地','当地离港','目的地','当地到港','机型','有效期开始','有效期结束','出发时区','到达时区']);
  data.flights.forEach(f=>source.addRow([f.number,f.days,f.from,f.departure,f.to,f.arrival,f.aircraft,f.start,f.end,f.fromZone,f.toZone]));source.columns.forEach(c=>c.width=22);source.views=[{state:'frozen',ySplit:1}];
  const arrangements=book.addWorksheet('人工配对记录');arrangements.addRow(headers);rows.forEach(r=>arrangements.addRow(r));arrangements.columns.forEach(c=>c.width=24);arrangements.views=[{state:'frozen',ySplit:1}];
  return book.xlsx.writeBuffer();
}
export function flightsRouter(upload,dataFiles=null){const router=express.Router();
  router.use('/drafts',flightDraftRouter(undefined,dataFiles));
  router.use('/standby',standbyRouter(upload));
  router.post('/standby/from-timetable',(req,res,next)=>{try{res.json(timetableDuties(buildRows(req.body),{nx002Layover:req.body.nx002Layover!==false}));}catch(e){e.status=400;next(e);}});
  router.post('/validate',(req,res,next)=>{try{const accepted=[],issues=[];for(const pair of req.body.pairs||[]){try{buildRows({...req.body,pairs:[...accepted,pair]});accepted.push(pair);}catch(e){issues.push({outId:pair.outId,backId:pair.backId,message:e.message});}}const rows=accepted.length?buildRows({...req.body,pairs:accepted}):[];res.json({issues,accepted,headers:headers.slice(0,9),rows,rowPairs:rows.map(r=>r.pair)});}catch(e){e.status=400;next(e);}});
  router.post('/preview',(req,res,next)=>{try{res.json({headers:headers.slice(0,9),rows:buildRows(req.body).map(r=>r.slice(0,9))});}catch(e){e.status=400;next(e);}});
  router.post('/extract',upload.single('file'),async(req,res,next)=>{try{if(!req.file||!req.file.originalname.toLowerCase().endsWith('.pdf'))return res.status(400).json({error:'请选择 PDF 文件'});const result=await pdf(Uint8Array.from(await fs.readFile(req.file.path)));const decoded=Buffer.from(req.file.originalname,'latin1').toString('utf8');res.json({...parseFlightText(result.text),sourceName:decoded.includes('\ufffd')?req.file.originalname:decoded});}catch(e){e.status=400;next(e);}finally{if(req.file)await fs.unlink(req.file.path).catch(()=>{});}});
  router.post('/export',async(req,res,next)=>{try{const bytes=await flightWorkbook(req.body);res.set('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');res.set('Content-Disposition','attachment; filename="flight-timetable.xlsx"');res.send(Buffer.from(bytes));}catch(e){e.status=400;next(e);}});return router;
}
