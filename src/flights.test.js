import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import {parseFlightText,buildRows,flightWorkbook} from './flights.js';
const text=`WITH EFFECT FROM 25Oct2026 to 27Mar2027
NX9961234567MFM0805BKK0940A321
NX9951234567BKK1035MFM1435A321
NX8221234567MFM0825ICN1305A321
NX8251234567ICN0830MFM1130A321
Between 1Feb and 12FebNX8181_3_5__MFM0840FUK1300A320`;
const data=parseFlightText(text);
const payload={flights:data.flights,pairs:[{outId:'0',backId:'1',returnDays:0}],date:'2026-10-25'};
test('航班提取保留班期、时区和跨年特殊有效期',()=>{assert.equal(data.flights.length,5);assert.equal(data.flights[4].start,'2027-02-01');assert.equal(data.flights[4].end,'2027-02-12');assert.equal(data.flights[4].days,'1_3_5__');});
test('北京时间换算与人工开会时间，默认不计算开会时间',()=>{const r=buildRows(payload);assert.equal(r[0][5],'');assert.equal(r[0][8],'1040');assert.equal(r[1][6],'1135');const manual=buildRows({...payload,pairs:[{...payload.pairs[0],outOpening:'0655',backOpening:'1020'}]});assert.equal(manual[0][5],'0655');assert.equal(manual[1][5],'1020');});
test('过夜必须人工指定，当天不能衔接则拒绝；过夜保留跨日',()=>{assert.throws(()=>buildRows({...payload,pairs:[{outId:'2',backId:'3',returnDays:0}]}),/早于/);const r=buildRows({...payload,pairs:[{outId:'2',backId:'3',returnDays:1}]});assert.equal(r[1][2],'NX825+1');assert.equal(r[1][6],'0730 (+1日)');});
test('拒绝重复配对、错误日期、不执飞的班期和错误开会时间',()=>{assert.throws(()=>buildRows({...payload,pairs:[...payload.pairs,...payload.pairs]}),/重复/);assert.throws(()=>buildRows({...payload,date:'2026-02-30'}),/日期/);assert.throws(()=>buildRows({...payload,date:'2026-10-24'}),/不执飞/);assert.throws(()=>buildRows({...payload,pairs:[{...payload.pairs[0],outOpening:'2460'}]}),/开会时间/);});
test('Excel 主表保持九列、配对相邻、冻结筛选及四位时间文本',async()=>{const book=new ExcelJS.Workbook();await book.xlsx.load(await flightWorkbook(payload));const sheet=book.getWorksheet('航班时刻表');assert.equal(sheet.columnCount,9);assert.equal(sheet.rowCount,3);assert.equal(sheet.getCell('F1').value,'开会时间');assert.equal(sheet.getCell('G2').value,'0805');assert.equal(sheet.getCell('C3').value,'NX995');assert.equal(sheet.views[0].ySplit,1);assert.ok(sheet.autoFilter);assert.equal(book.worksheets.length,3);});
test('整季保留非当天执飞的特殊航班，并按人工过夜天数匹配回程日期',()=>{
  const flights=[{...data.flights[0],id:'a',days:'1______',start:'2027-02-01',end:'2027-02-12'},{...data.flights[1],id:'b',days:'_2_____',start:'2027-02-01',end:'2027-02-12'}];
  const pairs=[{outId:'a',backId:'b',returnDays:1}],rows=buildRows({flights,pairs,mode:'season'});
  assert.equal(rows.length,2);assert.equal(rows[0][15],'2027-02-01, 2027-02-08');assert.equal(rows[1][2],'NX995+1');assert.deepEqual(rows[0].pair,{outId:'a',backId:'b'});
  assert.throws(()=>buildRows({flights,pairs:[{...pairs[0],returnDays:0}],mode:'season'}),/没有同时符合/);
});
test('不同班期的去程可人工共用同一回程记录，重叠日期仍拒绝重复配对',()=>{
 const flights=[{...data.flights[0],id:'a',days:'1______'},{...data.flights[0],id:'c',days:'_2_____'},{...data.flights[1],id:'b'}],pairs=[{outId:'a',backId:'b',returnDays:0},{outId:'c',backId:'b',returnDays:0}];
 const rows=buildRows({flights,pairs,mode:'season'});assert.equal(rows.length,4);assert.equal(rows[0].pair.outId,'a');assert.equal(rows[2].pair.outId,'c');
 assert.throws(()=>buildRows({flights:[flights[0],{...flights[1],days:'1______'},flights[2]],pairs,mode:'season'}),/重复/);
});
