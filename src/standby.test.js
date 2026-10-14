import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import express from 'express';
import multer from 'multer';
import request from 'supertest';
import os from 'node:os';
import path from 'node:path';
import { fdpLimit, calculateDuty, casesFromRows, proposeSchemes } from '../public/standby-calculator.js';
import { analyzeStandby, importStandbyWorkbook, standbyWorkbook, standbyDocument, standbyRouter, validateStandbyInput, timetableDuties } from './standby.js';
import { buildRows, parseFlightText } from './flights.js';
import mammoth from 'mammoth';

const duty={id:'tpe',label:'NX632 + NX631',point:'台北桃园',airport:'TPE',outbound:'NX632',returnFlight:'NX631',type:'turnaround',sectors:2,briefing:410,departure:480,arrival:755,enabled:true};
test('default four-hour rule matches both user examples with revised 14-hour cap',()=>{
  const shift={name:'S3',start:'1000',end:'1700'};
  const czx=calculateDuty({...duty,briefing:740,departure:810,arrival:1175},shift);
  assert.equal(czx.start,740);assert.equal(czx.limit,795);assert.equal(czx.buffer,360);assert.equal(czx.pass,true);
  const tao=calculateDuty({...duty,briefing:845,departure:915,arrival:1395},shift);
  assert.equal(tao.start,840);assert.equal(tao.limit,735);assert.equal(tao.buffer,180);
  assert.equal(tao.standbyElapsed,795);assert.equal(tao.elapsedPass,true);assert.equal(tao.pass,true);
  assert.equal(tao.elapsedLimit,840);
});
test('exactly four hours and one minute over both use the smaller limit, while start time follows the four-hour boundary',()=>{
  const shift={name:'S1',start:'0600',end:'1300'};
  const exact=calculateDuty({...duty,briefing:600,departure:670,arrival:1020},shift);
  assert.equal(exact.limit,615);assert.equal(exact.start,600);assert.equal(exact.elapsedPass,true);
  const over=calculateDuty({...duty,briefing:601,departure:671,arrival:1020},shift);
  assert.equal(over.limit,615);assert.equal(over.start,600);assert.equal(over.buffer,195);
});
test('NX862 plus NX861 uses 12:15 at 0700 standby, including Excel MIN formula and Word example',async()=>{
  const d={...duty,id:'nrt',label:'NX862 + NX861',point:'东京成田',airport:'NRT',briefing:500,departure:570,arrival:1205};
  const report=analyzeStandby({duties:[d],shifts:[{name:'S2',start:'0700',end:'1400'}]});
  const r=report.selected.rows[0];assert.equal(r.normal.limit,795);assert.equal(r.normal.buffer,90);
  assert.equal(r.best.start,500);assert.equal(r.best.limit,735);assert.equal(r.best.buffer,30);assert.equal(r.best.pass,true);assert.equal(r.best.preferred,false);
  assert.equal(calculateDuty(d,{name:'S1',start:'0605',end:'1305'}).buffer,-90);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await standbyWorkbook(report));const detail=book.getWorksheet('逐备份计算');
  assert.equal(detail.getCell('K2').result,735);assert.match(detail.getCell('K2').formula,/^MIN\(/);assert.doesNotMatch(detail.getCell('K2').formula,/>240/);assert.equal(detail.getCell('M2').result,30);
  const text=(await mammoth.extractRawText({buffer:await standbyDocument(report)})).value;assert.match(text,/0820＋12:15－2005＝00:30/);assert.match(text,/两种情况的 FDP MAX 均取/);
});
test('the smaller Table A cap makes NX856 a genuine 10-minute buffer conflict without dropping the task',()=>{
  const d={...duty,id:'kix-v2',label:'NX856 + NX855',briefing:425,departure:495,arrival:1030};
  const report=analyzeStandby({duties:[d]});assert.equal(report.selected.total,1);assert.equal(report.selected.covered,0);
  assert.equal(report.proposal.impossible[0].bestPossible.buffer,10);assert.equal(report.proposal.impossible[0].conflict.code,'fdp');
  assert.match(report.proposal.impossible[0].conflict.explanation,/00:10.*00:30/);assert.match(report.proposal.impossible[0].conflict.action,/1650/);
});
test('14-hour turnaround and 9-hour layover limits include exact boundary and retain next-day elapsed time',()=>{
  const shift={name:'S1',start:'1000',end:'1700'};
  for(const [type,sectors,cap] of [['turnaround',2,840],['layover',1,540]]){
    const d={...duty,type,sectors,briefing:780,departure:850,arrival:600+cap};
    assert.equal(calculateDuty(d,shift).pass,true);
    const fail=calculateDuty({...d,arrival:d.arrival+1},shift);
    assert.equal(fail.buffer>30,true);assert.equal(fail.elapsedPass,false);assert.equal(fail.pass,false);
  }
  const overnight=calculateDuty({...duty,type:'layover',sectors:1,briefing:1230,departure:1300,arrival:1620},{name:'S5',start:'1730',end:'2330'});
  assert.equal(overnight.standbyElapsed,570);assert.equal(overnight.elapsedPass,false);
});
test('NX658 cannot use 1330 standby despite positive buffer, but can use 1730',()=>{
  const d={...duty,type:'layover',sectors:1,briefing:1215,departure:1285,arrival:1380};
  const bad=calculateDuty(d,{name:'S5',start:'1330',end:'2030'});
  assert.equal(bad.start,1050);assert.equal(bad.buffer,390);assert.equal(bad.timeEligible,true);
  assert.equal(bad.standbyElapsed,570);assert.equal(bad.pass,false);
  const boundary=calculateDuty(d,{name:'S4',start:'1400',end:'2100'});assert.equal(boundary.standbyElapsed,540);assert.equal(boundary.pass,true);
  assert.equal(calculateDuty(d,{name:'S5',start:'1730',end:'2330'}).pass,true);
});
test('comparison offers 4/5/6 candidates when disjoint capped start windows need six shifts',()=>{
  const duties=[420,510,600,690,780,870].map((briefing,i)=>({...duty,id:'six-'+i,type:'layover',sectors:1,briefing,departure:briefing+70,arrival:briefing+495}));
  const proposal=proposeSchemes(duties);
  assert.equal(proposal.minimumCount,6);assert.equal(proposal.searchLimited,false);assert.equal(proposal.separateWindows.length,6);
  assert.deepEqual(proposal.schemes.map(s=>[s.shifts.length,s.covered]),[[4,4],[5,5],[6,6]]);
  for(const scheme of proposal.schemes)for(const row of scheme.rows)if(row.best)assert.equal(row.best.elapsedPass,true);
});
test('Excel formulas, Word explanation and server decisions all enforce fixed total-duration caps',async()=>{
  const d={...duty,id:'nx658',label:'NX658 + NX667+1',type:'layover',sectors:1,briefing:1215,departure:1285,arrival:1380};
  const report=analyzeStandby({duties:[d],shifts:[{name:'S5',start:'1330',end:'2030'}],taskLimits:{layover:9999}},{generate:false});
  assert.equal(report.options.model,'user-four-hour');assert.equal(report.selected.covered,0);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await standbyWorkbook(report));
  const detail=book.getWorksheet('逐备份计算');assert.equal(detail.getCell('M2').result,390);
  assert.equal(detail.getCell('Q2').result,570);assert.equal(detail.getCell('R2').result,540);
  assert.equal(detail.getCell('S2').result,false);assert.equal(detail.getCell('I2').result,false);assert.equal(detail.getCell('O2').result,false);
  assert.match(detail.getCell('I2').formula,/S2/);assert.match(detail.getCell('T2').value,/09:30.*09:00/);
  const text=(await mammoth.extractRawText({buffer:await standbyDocument(report)})).value;
  assert.match(text,/往返.*14:00/);assert.match(text,/过夜.*09:00/);
});
test('Table A bands include all minute boundaries and use the single-sector column for layover',()=>{
  const samples=[[419,660,615],[420,780,735],[479,780,735],[480,840,795],[779,840,795],[780,780,735],[1079,780,735],[1080,720,675],[1319,720,675],[1320,660,615]];
  for(const [t,one,two] of samples){assert.equal(fdpLimit(t,1).minutes,one);assert.equal(fdpLimit(t,2).minutes,two);}
  assert.throws(()=>fdpLimit(480,0));
});
test('airport standby starts FDP immediately; four-hour comparison does not apply that rule',()=>{
  assert.equal(calculateDuty(duty).buffer,270);
  const airport=calculateDuty(duty,{name:'S1',start:'0605',end:'1305'},{model:'airport'});
  assert.equal(airport.start,365);assert.equal(airport.buffer,225);assert.equal(airport.pass,true);
  const q={...duty,briefing:845,departure:915,arrival:1395};
  const s={name:'S3',start:'1000',end:'1700'};
  assert.equal(calculateDuty(q,s,{model:'user-four-hour'}).buffer,180);
  assert.equal(calculateDuty(q,s,{model:'airport'}).buffer,0);
  assert.equal(calculateDuty({...duty,type:'layover',sectors:1,briefing:520,departure:590,arrival:695}).buffer,665);
});
test('45-minute lead, shift end and mandatory buffer are independent checks',()=>{
  assert.equal(calculateDuty(duty,{start:'0606',end:'1306'}).eligible,false);
  assert.equal(calculateDuty(duty,{start:'0605',end:'0649'}).eligible,false);
  assert.equal(calculateDuty({...duty,arrival:951},{start:'0605',end:'1305'},{model:'airport'}).pass,false);
});
test('manual +1 alternatives remain separate and NX002 special treatment counts one sector',()=>{
  const rows=[{number:'NX008',briefing:'1415',departure:'1525',arrival:'1830',airport:'PEK',point:'北京',sourceRow:2},{number:'NX009',departure:'1935',arrival:'2310',airport:'PEK',sourceRow:3},{number:'NX001+1',departure:'0830',arrival:'1215',airport:'PEK',sourceRow:4},{number:'NX002',briefing:'0700',departure:'0810',arrival:'1110',airport:'PEK',point:'北京',sourceRow:5}];
  const {duties}=casesFromRows(rows);assert.equal(duties.length,3);assert.deepEqual(duties.map(d=>d.sectors),[2,1,1]);assert.equal(duties[1].arrival,1110);assert.equal(duties[2].arrival,670);
});
test('explicit same-outbound alternate pairing permits separate scenarios without permitting duplicates',()=>{
  const d=parseFlightText('WITH EFFECT FROM 25Oct2026 to 27Mar2027\nNX0081234567MFM1525PEK1830A321\nNX0091234567PEK1935MFM2310A321\nNX0011234567PEK0830MFM1215A321');
  const pair={outId:'0',backId:'1',returnDays:0,outOpening:'1415'};
  assert.throws(()=>buildRows({flights:d.flights,pairs:[pair,{outId:'0',backId:'2',returnDays:1,outOpening:'1415'}],mode:'season'}),/重复/);
  const rows=buildRows({flights:d.flights,pairs:[pair,{outId:'0',backId:'2',returnDays:1,outOpening:'1415',alternative:true}],mode:'season'});
  const result=timetableDuties(rows);assert.deepEqual(result.duties.map(x=>x.sectors),[2,1]);assert.equal(result.duties[1].arrival,1110);
});
test('XLSX import retains numeric times and manually confirmed +1 arrangements',async()=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('航班时刻表');sheet.addRow(['航点','航点代码','航班号','BFTM','STD','STA']);
  sheet.addRow(['台中','RMQ','NX672',520/1440,590/1440,695/1440]);sheet.addRow(['台中','RMQ','NX671+1',null,'0825','1010']);
  const r=await importStandbyWorkbook(await book.xlsx.writeBuffer());assert.equal(r.duties[0].briefing,520);assert.equal(r.duties[0].sectors,1);assert.equal(r.duties[0].arrival,695);
});
test('validation rejects inconsistent sectors, excessive duration, duplicate IDs and invalid rules',()=>{
  assert.throws(()=>validateStandbyInput({duties:[{...duty,sectors:1}]}),/两段/);
  assert.throws(()=>validateStandbyInput({duties:[duty,duty]}),/重复/);
  assert.throws(()=>validateStandbyInput({duties:[duty],shifts:[{name:'S1',start:'0600',end:'1400'}]}),/上限/);
  assert.throws(()=>validateStandbyInput({duties:[duty],options:{minimumBuffer:0}}),/规则/);
  assert.throws(()=>validateStandbyInput({duties:[duty],options:{leadMinutes:180,maxMinutes:60}}),/不能小于提前/);
});
test('scheme and export files include holes and full standby calculations, using the same selected shifts',async()=>{
  const gap={...duty,id:'kix',label:'NX856 + NX855',airport:'KIX',point:'大阪',briefing:425,departure:495,arrival:1030};
  const r=analyzeStandby({duties:[duty,gap],options:{model:'airport'},shifts:[{name:'S1',start:'0605',end:'1305'}]});
  assert.equal(r.selected.covered,1);assert.equal(r.proposal.impossible[0].bestPossible.buffer,-35);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await standbyWorkbook(r));
  const main=book.getWorksheet('航班 FDP buffer');assert.equal(main.getCell('M2').value,'03:45');assert.equal(main.getCell('O3').value,'无可用备份');
  const detail=book.getWorksheet('逐备份计算');assert.equal(detail.getCell('M2').result,225);assert.equal(detail.getCell('G2').value.formula,"'规则与时段'!B12");assert.equal(detail.getCell('O3').result,false);
  assert.equal(book.worksheets[0].name,'航班 FDP buffer');
  const doc=await standbyDocument(r);assert.equal(doc.subarray(0,2).toString(),'PK');
});
test('HTTP analyze and export reject invalid inputs, and upload cleanup runs even on parser errors',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'quizforge-standby-')),app=express();app.use(express.json());app.use(standbyRouter(multer({dest:folder})));app.use((e,req,res,next)=>res.status(e.status||500).json({error:e.message}));
  try{await request(app).post('/analyze').send({duties:[]}).expect(400);await request(app).post('/analyze').send({duties:[duty]}).expect(200);await request(app).post('/export/docx').send({duties:[duty]}).expect('Content-Type',/wordprocessingml/).expect(200);await request(app).post('/import').attach('file',Buffer.from('bad'),'bad.xlsx').expect(400);assert.deepEqual(await fs.readdir(folder),[]);}finally{await fs.rm(folder,{recursive:true,force:true});}
});

test('future imports retain a one-minute valid window instead of missing it on a five-minute grid',()=>{
  const d={...duty,id:'narrow',type:'layover',sectors:1,briefing:602,departure:672,arrival:1097};
  const report=analyzeStandby({duties:[d]});
  assert.equal(report.proposal.minimumCount,1);assert.equal(report.goal.achieved,true);
  assert.deepEqual(report.proposal.startWindows[0].ranges,[{first:557,last:557}]);
  assert.ok(report.shifts.some(s=>s.start==='0917'));assert.equal(report.selected.rows[0].best.elapsedLimit,540);
});
test('seven mutually exclusive start windows trigger a full-coverage extension and export all seven shifts',async()=>{
  const duties=[420,480,540,600,660,720,780].map((briefing,i)=>({...duty,id:'seven-'+i,label:'任务 '+i,type:'layover',sectors:1,briefing,departure:briefing+70,arrival:briefing+495}));
  const report=analyzeStandby({duties});
  assert.equal(report.proposal.minimumCount,7);assert.equal(report.goal.achieved,true);assert.equal(report.goal.withinSix,false);
  assert.deepEqual(report.proposal.schemes.map(s=>[s.shifts.length,s.covered]),[[4,4],[5,5],[6,6],[7,7]]);
  assert.equal(validateStandbyInput(report).shifts.length,7);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await standbyWorkbook(report));
  const detail=book.getWorksheet('逐备份计算');assert.equal(detail.rowCount,50);
  assert.equal(detail.getCell('G8').formula,"'规则与时段'!B18");assert.equal(detail.getCell('R8').result,540);
  assert.equal(book.getWorksheet('覆盖结论').getCell('B2').value,'已实现全覆盖');
  assert.match((await mammoth.extractRawText({buffer:await standbyDocument(report)})).value,/全覆盖最少需要 7 个/);
});
test('individually impossible tasks remain in the coverage denominator and diagnostics across exports',async()=>{
  const conflict={...duty,id:'conflict',label:'冲突过夜',type:'layover',sectors:1,briefing:602,departure:672,arrival:1102};
  const report=analyzeStandby({duties:[duty,conflict]});
  assert.equal(report.selected.total,2);assert.equal(report.selected.covered,1);assert.equal(report.goal.status,'rule-conflict');
  assert.equal(report.proposal.impossible[0].conflict.code,'total-duration');
  assert.match(report.proposal.impossible[0].conflict.explanation,/没有交集/);
  assert.throws(()=>validateStandbyInput({duties:[{...duty,enabled:false}]}),/全部已确认/);
  const book=new ExcelJS.Workbook();await book.xlsx.load(await standbyWorkbook(report));
  assert.equal(book.getWorksheet('航班 FDP buffer').rowCount,3);assert.equal(book.getWorksheet('覆盖结论').getCell('B2').value,'未实现全覆盖');
  const text=(await mammoth.extractRawText({buffer:await standbyDocument(report)})).value;
  assert.match(text,/未实现全覆盖 · 诊断说明/);assert.match(text,/冲突过夜/);assert.match(text,/不会自动修改时刻表/);
});

test('manual revisions preserve times and export missing flights with before and after coverage',async()=>{
  const baseShifts=[{name:'S1',start:'0605',end:'1305'},{name:'S2',start:'0945',end:'1645'},{name:'S3',start:'1115',end:'1815'},{name:'S4',start:'1400',end:'2100'}];
  const shifts=structuredClone(baseShifts);shifts[0]={name:'S1',start:'0630',end:'1305'};
  const report=analyzeStandby({duties:[duty],baseShifts,shifts,generate:false});
  assert.deepEqual(report.shifts,shifts);assert.equal(report.selected.covered,0);assert.equal(report.selected.total,1);
  assert.equal(report.revision.baseline.covered,1);assert.deepEqual(report.revision.newlyUncovered,[duty.id]);
  assert.equal(report.revision.changes.length,1);assert.equal(report.revision.changes[0].after.start,'0630');
  const book=new ExcelJS.Workbook();await book.xlsx.load(await standbyWorkbook(report));
  assert.equal(book.getWorksheet('规则与时段').getCell('B12').value,390);
  assert.equal(book.getWorksheet('逐备份计算').getCell('G2').result,390);
  assert.equal(book.getWorksheet('航班 FDP buffer').getCell('O2').value,'无可用备份');
  const gaps=book.getWorksheet('冲突与开始范围').getSheetValues();assert.ok(gaps.some(r=>r?.[1]==='当前方案未覆盖'&&r[2]===duty.label));
  const text=(await mammoth.extractRawText({buffer:await standbyDocument(report)})).value;
  assert.match(text,/人工修订说明/);assert.match(text,/修订前覆盖 1\/1，修订后覆盖 0\/1/);assert.match(text,/0630/);assert.match(text,/此次修订新增缺口/);
  assert.throws(()=>validateStandbyInput({duties:[duty],shifts,baseShifts:[{name:'S1',start:'0600',end:'1500'}]}),/上限/);
});

test('custom count is exact and automatic slots never replace fixed start or end times',()=>{
  const fixedShifts=[{name:'S2',start:'0630',end:'1230'},{name:'S4',start:'1400',end:'2000'}];
  const report=analyzeStandby({duties:[duty],requestedCount:4,fixedShifts});
  assert.equal(report.shifts.length,4);assert.deepEqual(report.shifts.map(s=>s.name),['S1','S2','S3','S4']);
  for(const fixed of fixedShifts)assert.deepEqual(report.shifts.find(s=>s.name===fixed.name),fixed);
  assert.equal(report.selected.covered,1);
  assert.throws(()=>analyzeStandby({duties:[duty],requestedCount:3,fixedShifts}),/超出指定数量/);
  assert.throws(()=>analyzeStandby({duties:[duty],requestedCount:4.5}),/1–20/);
  assert.throws(()=>analyzeStandby({duties:[duty],fixedShifts:[fixedShifts[0],fixedShifts[0]]}),/不同编号/);
  assert.throws(()=>analyzeStandby({duties:[duty],fixedShifts:[{name:'S1',start:'1200',end:'1100'}]}),/结束须晚于开始/);
});

test('automatic count expands beyond six when fixed unused time leaves seven mutually exclusive windows',()=>{
  const duties=[420,480,540,600,660,720,780].map((briefing,i)=>({...duty,id:'fixed-seven-'+i,type:'layover',sectors:1,briefing,departure:briefing+70,arrival:briefing+495}));
  const fixedShifts=[{name:'S1',start:'1800',end:'2100'}];
  const auto=analyzeStandby({duties,fixedShifts});
  assert.equal(auto.selected.covered,7);assert.equal(auto.selected.total,7);assert.equal(auto.shifts.length,8);assert.deepEqual(auto.shifts[0],fixedShifts[0]);
  assert.match(auto.proposal.explanation,/自动扩展/);assert.equal(auto.proposal.minimumProven,false);
  const limited=analyzeStandby({duties,fixedShifts,requestedCount:6});
  assert.equal(limited.shifts.length,6);assert.equal(limited.selected.covered,5);assert.equal(limited.selected.missing.length,2);assert.deepEqual(limited.shifts[0],fixedShifts[0]);assert.equal(limited.goal.status,'not-achieved');
});

test('current-only exports retain fixed times and gaps without original or candidate scheme comparisons',async()=>{
  const fixedShifts=[{name:'S1',start:'0630',end:'1230'},{name:'S2',start:'1400',end:'2000'}];
  const report=analyzeStandby({duties:[duty],requestedCount:2,fixedShifts});
  assert.deepEqual(report.shifts,fixedShifts);assert.equal(report.selected.covered,0);
  const selected=analyzeStandby({...report,shifts:report.shifts,generate:false});
  const book=new ExcelJS.Workbook();await book.xlsx.load(await standbyWorkbook(selected));
  assert.equal(book.getWorksheet('方案比较'),undefined);assert.equal(book.getWorksheet('逐备份计算').rowCount,3);
  assert.equal(book.getWorksheet('规则与时段').getCell('B12').value,390);assert.equal(book.getWorksheet('规则与时段').getCell('C13').value,1200);
  assert.equal(book.getWorksheet('逐备份计算').getCell('O2').result,false);assert.equal(book.getWorksheet('航班 FDP buffer').getCell('O2').value,'无可用备份');
  const text=(await mammoth.extractRawText({buffer:await standbyDocument(selected)})).value;
  assert.match(text,/指定 2 个备份/);assert.match(text,/覆盖 0\/1/);assert.match(text,/0630/);assert.match(text,/1400/);assert.doesNotMatch(text,/原五个时段|自动候选比较|人工修订说明/);
  assert.throws(()=>analyzeStandby({...report,shifts:[fixedShifts[0]]}),/数量不一致/);
  assert.throws(()=>analyzeStandby({...report,shifts:[{...fixedShifts[0],start:'0605'},fixedShifts[1]]}),/未保留固定时间/);
});


test('cached proposals are isolated from caller mutation and distinguish calculation options',()=>{
  const duty={id:'cache-regression',label:'Cache',point:'MFM',airport:'MFM',outbound:'NX001',returnFlight:'',type:'layover',sectors:1,briefing:600,departure:650,arrival:780,enabled:true};
  const first=proposeSchemes([duty],{minimumBuffer:30});
  const expected=structuredClone(first);
  first.impossible.push({id:'mutated'});first.recommended.shifts[0].start='0000';
  assert.deepEqual(proposeSchemes([duty],{minimumBuffer:30}),expected);
  assert.notDeepEqual(proposeSchemes([duty],{minimumBuffer:30,maxMinutes:360}),expected);
});
