import express from 'express';
import fs from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, Footer, PageNumber, AlignmentType } from 'docx';
import { TABLE_A, SOURCE_URL, TASK_LIMITS, RULE_VERSION, casesFromRows, calculateDuty, evaluateScheme, proposeSchemes, minutes, clock, duration } from '../public/standby-calculator.js';

function timeCell(value){
  if(value&&typeof value==='object')value=value.result??value.text;
  if(value instanceof Date)return {time:String(value.getUTCHours()).padStart(2,'0')+String(value.getUTCMinutes()).padStart(2,'0'),offset:0};
  if(typeof value==='number'){if(Number.isInteger(value)&&value>=1){const time=String(value).padStart(4,'0');minutes(time);return {time,offset:0};}const total=Math.round(value*1440);return {time:clock(total%1440),offset:Math.floor(total/1440)};}
  const match=/^(\d{1,2}):?(\d{2})(?:\s*\(\+(\d+)日\))?$/.exec(String(value??'').trim());
  if(!match)throw Error('无法识别时间：'+String(value??'空白'));
  const time=match[1].padStart(2,'0')+match[2];minutes(time);return {time,offset:Number(match[3]||0)};
}
export function timetableDuties(rows,options={}){
  const records=rows.map((r,i)=>{const arrival=timeCell(r[8]),departure=timeCell(r[6]);return {sourceRow:i+2,point:r[0],airport:r[1],number:r[2],briefing:r[5],departure:departure.time,arrival:arrival.time,arrivalOffset:arrival.offset};});
  return casesFromRows(records,options);
}
export async function importStandbyWorkbook(bytes){
  const book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
  const sheet=book.getWorksheet('航班时刻表')||book.worksheets[0];if(!sheet||sheet.rowCount>1002)throw Error('表格为空或超过 1000 行');
  const headings=sheet.getRow(1).values.slice(1).map(x=>String(x??'').trim());
  const wide=headings.includes('方向')&&headings.includes('出发地');
  if(!headings.includes('航班号')||!headings.some(x=>/BFTM|开会时间/.test(x)))throw Error('请导入已确认的航班表，表头应包含航班号、BFTM／开会时间、STD／离港时间、STA／到港时间');
  const records=[];
  sheet.eachRow((row,n)=>{if(n===1||!row.getCell(3).value)return;const cell=i=>row.getCell(i).value;const departure=timeCell(cell(wide?7:5)),arrival=timeCell(cell(wide?9:6));records.push({sourceRow:n,point:String(cell(1)||''),airport:String(cell(2)||''),number:String(cell(3)||'').trim(),briefing:cell(wide?6:4)?timeCell(cell(wide?6:4)).time:'',departure:departure.time,arrival:arrival.time,arrivalOffset:arrival.offset});});
  return {records,...casesFromRows(records)};
}
export function validateStandbyInput(body){
  if(!Array.isArray(body.duties)||!body.duties.length||body.duties.length>150)throw Error('请确认 1–150 组航班后计算');
  const seen=new Set();
  const duties=body.duties.map(d=>{
    if(!d||typeof d.id!=='string'||seen.has(d.id))throw Error('航班组合编号缺失或重复');seen.add(d.id);
    if(!['layover','turnaround'].includes(d.type)||d.sectors!==(d.type==='layover'?1:2))throw Error('当天往返为两段，过夜去程为一段');
    if(![d.briefing,d.departure,d.arrival].every(Number.isInteger)||d.briefing<0||d.briefing>=1440||d.departure<d.briefing||d.departure>=1440||d.arrival<d.departure||d.arrival>=2880)throw Error('BFTM、离港或到港时间无效');
    for(const field of ['label','point','airport','outbound','returnFlight'])if(typeof d[field]!=='string'||d[field].length>200)throw Error('航班信息格式无效');
    if(d.enabled===false)throw Error('全覆盖分析必须保留全部已确认组合；请返回航班时刻表核对纳入范围');
    return {...d,enabled:true};
  });
  if(!duties.some(d=>d.enabled))throw Error('至少保留一组航班');
  const raw=body.options||{},options={model:raw.model||'user-four-hour',leadMinutes:Number(raw.leadMinutes??45),minimumBuffer:Number(raw.minimumBuffer??30),maxMinutes:Number(raw.maxMinutes??420)};
  if(!['airport','home','user-four-hour'].includes(options.model)||!Number.isInteger(options.leadMinutes)||options.leadMinutes<45||options.leadMinutes>180||!Number.isInteger(options.minimumBuffer)||options.minimumBuffer<30||options.minimumBuffer>180||!Number.isInteger(options.maxMinutes)||options.maxMinutes<60||options.maxMinutes>420)throw Error('请检查规则：提前至少 45 分钟、buffer 至少 30 分钟，每段最多 7 小时');
  if(options.maxMinutes<options.leadMinutes)throw Error('单段时长上限不能小于提前 BFTM 的分钟数');
  const shifts=body.shifts;
  if(shifts){if(!Array.isArray(shifts)||!shifts.length||shifts.length>150||new Set(shifts.map(s=>s.name)).size!==shifts.length)throw Error('请选择 1–150 个不同编号的备份，优先不超过 6 个');for(const s of shifts){const start=minutes(s.start),end=minutes(s.end);if(!/^S[1-9]\d{0,2}$/.test(s.name)||Number(s.name.slice(1))>150||end<=start||end-start>options.maxMinutes)throw Error('备份结束须晚于开始，且不超过设置的时长上限');}}
  let baseShifts;
  if(body.baseShifts!==undefined){
    if(!shifts)throw Error('修订方案须提供当前时段');
    baseShifts=validateStandbyInput({duties,shifts:body.baseShifts,options:{...options,maxMinutes:420}}).shifts;
  }
  const requestedCount=body.requestedCount==null||body.requestedCount===''?null:Number(body.requestedCount);
  if(requestedCount!==null&&(!Number.isInteger(requestedCount)||requestedCount<1||requestedCount>20))throw Error('定制备份数量须为 1–20 个');
  const fixedShifts=body.fixedShifts||[];
  if(!Array.isArray(fixedShifts)||fixedShifts.length>20)throw Error('固定时段格式无效');
  if(fixedShifts.length){validateStandbyInput({duties,options,shifts:fixedShifts});if(requestedCount&&fixedShifts.some(s=>Number(s.name.slice(1))>requestedCount))throw Error('固定备份编号超出指定数量，请先恢复自动安排或增加数量');if(fixedShifts.some(s=>Number(s.name.slice(1))>20))throw Error('定制备份编号须为 S1–S20');}
  if(shifts&&requestedCount&&(shifts.length!==requestedCount||shifts.some(s=>Number(s.name.slice(1))>requestedCount)))throw Error('当前时段与定制备份数量不一致，请重新生成方案');
  if(shifts&&fixedShifts.some(f=>!shifts.some(s=>s.name===f.name&&minutes(s.start)===minutes(f.start)&&minutes(s.end)===minutes(f.end))))throw Error('当前方案未保留固定时间，请重新生成方案');
  return {duties,options,shifts,baseShifts,requestedCount,fixedShifts,title:String(body.title||'冬季航班备份方案').slice(0,100),sourceName:String(body.sourceName||'已确认的航班时刻表').slice(0,150)};
}
export function analyzeStandby(body){
  const input=validateStandbyInput(body);
  const proposal=proposeSchemes(input.duties,input.options,{requestedCount:input.requestedCount,fixedShifts:input.fixedShifts});
  const shifts=input.shifts||proposal.recommended?.shifts;
  if(!shifts)throw Error('当前规则无法生成备份候选，请调整输入');
  const selected=evaluateScheme(input.duties,shifts,input.options),achieved=selected.covered===selected.total;
  const goal={objective:'full-coverage',preferredCounts:[4,5,6],achieved,withinSix:shifts.length<=6,feasible:proposal.completePossible,status:achieved?'achieved':proposal.completePossible?'not-achieved':'rule-conflict',message:achieved?`全部 ${selected.total} 组均有可接替备份，使用 ${shifts.length} 个待命时段${shifts.length>6?'，超过优先数量 6 个':''}。`:proposal.explanation};
  const baseline=input.baseShifts?evaluateScheme(input.duties,input.baseShifts,input.options):null;
  const revision=baseline?{
    baseline:{shifts:baseline.shifts,covered:baseline.covered,total:baseline.total,lowest:baseline.lowest},
    changes:shifts.flatMap(s=>{const before=input.baseShifts.find(b=>b.name===s.name);return !before||before.start!==s.start||before.end!==s.end?[{name:s.name,before:before||null,after:s}]:[]}).concat(input.baseShifts.filter(b=>!shifts.some(s=>s.name===b.name)).map(before=>({name:before.name,before,after:null}))),
    newlyUncovered:selected.missing.filter(d=>baseline.rows.find(r=>r.id===d.id)?.best).map(d=>d.id),
    restored:selected.rows.filter(r=>r.best&&!baseline.rows.find(b=>b.id===r.id)?.best).map(d=>d.id)
  }:null;
  return {...input,ruleVersion:RULE_VERSION,planVersion:proposal.planVersion,taskLimits:TASK_LIMITS,goal,shifts,proposal,selected,revision};
}
export const modelName=model=>({airport:'其他算法：FDP 从备份开始起算',home:'其他算法：始终比较两时段上限','user-four-hour':'指定四小时规则'})[model];
const formulaNote=model=>model==='airport'?'FDP 开始＝备份开始；FDP MAX＝Table A 备份开始时段对应列。':'间隔不超过四小时（含恰好四小时）：FDP 从 BFTM 起算；超过四小时：从备份开始＋四小时起算。两种情况的 FDP MAX 均取 Table A 中备份开始与 BFTM 对应航段列的较小上限。';
const status=r=>!r.best?'无可用备份':r.best.preferred?'充足（>01:00）':'临界（≥最低值）';
const quantityNote=report=>report.requestedCount?`指定 ${report.requestedCount} 个备份；固定时间保持不变`:report.fixedShifts?.length?`保留 ${report.fixedShifts.length} 个固定时段，其余自动安排；全覆盖需要时增加数量`:'自动安排以全覆盖为目标，优先 4／5／6 个；数量不足继续搜索';
function groupedReasons(results){
  const groups=new Map();for(const x of results){const names=groups.get(x.reason)||[];names.push(x.shift);groups.set(x.reason,names);}
  return [...groups].map(([reason,names])=>names.join('、')+'：'+reason).join('；');
}
function styleSheet(sheet,widths){sheet.columns.forEach((col,i)=>col.width=widths?.[i]||22);sheet.views=[{state:'frozen',ySplit:1,showGridLines:false}];sheet.autoFilter={from:'A1',to:{row:sheet.rowCount,column:sheet.columnCount}};sheet.eachRow((row,n)=>{row.height=n===1?32:28;row.eachCell(c=>{c.font={name:'微软雅黑',size:11,bold:n===1,color:{argb:n===1?'FFFFFFFF':'FF243746'}};c.alignment={vertical:'middle',wrapText:true};if(n===1)c.fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF176B57'}};});});}
export async function standbyWorkbook(report){
  const book=new ExcelJS.Workbook();book.creator='智题工坊';book.calcProperties.fullCalcOnLoad=true;
  const params=book.addWorksheet('规则与时段');params.addRow(['项目','值','说明']);params.addRow(['来源',report.sourceName,'已由人工确认']);params.addRow(['计算口径',modelName(report.options.model),formulaNote(report.options.model)]);params.addRow(['最少提前分钟',report.options.leadMinutes,'备份开始至 BFTM']);params.addRow(['最低 buffer 分钟',report.options.minimumBuffer,'正常机组和备份均须满足']);params.addRow(['单段上限分钟',report.options.maxMinutes,'自动与固定时段均须满足']);params.addRow(['可用时段','BFTM 不晚于备份结束','单次替补覆盖，不等于并发容量']);params.addRow(['法规来源',SOURCE_URL,'§10.1.1 Table A；§19.4、19.5']);params.addRow(['范围','过夜仅计算去程一段','不含次日返程职责、累计 duty 和休息审查']);params.addRow([]);params.addRow(['备份','开始分钟','结束分钟']);report.shifts.forEach(s=>params.addRow([s.name,minutes(s.start),minutes(s.end)]));params.addRow([]);params.addRow(['开始时段','一段 FDP 分钟','两段 FDP 分钟']);TABLE_A.forEach(b=>params.addRow([b.label,...b.limits.slice(0,2)]));styleSheet(params,[28,62,80]);params.getColumn(2).numFmt='General';
  const turnaroundLimitRow=params.addRow(['往返开始至 STA 上限分钟',TASK_LIMITS.turnaround,'用户指定硬条件；以回程 STA 为终点']).number;
  const layoverLimitRow=params.addRow(['过夜开始至 STA 上限分钟',TASK_LIMITS.layover,'用户指定硬条件；以去程 STA 为终点']).number;
  params.addRow(['目标','全部已确认航班组合均可接替','优先 4／5／6 个；数量不足继续搜索，不排除冲突任务']);params.addRow(['规则版本',RULE_VERSION,'总时长从备份开始起算，与 FDP 开始时间分开判断']);styleSheet(params,[28,62,80]);
  const detail=book.addWorksheet('逐备份计算');detail.addRow(['航班组合','备份','类型','航段','BFTM 分钟','本次 STA 分钟','备份开始分钟','备份结束分钟','可接替','FDP 开始分钟','FDP MAX 分钟','FDP 截止分钟','备份 buffer 分钟','正常 buffer 分钟','达到最低值','开始时段','备份开始至 STA 分钟','总时长上限分钟','总时长通过','判定说明']);
  const summary=book.addWorksheet('航班 FDP buffer');summary.addRow(['航点','航班组合','安排','航段','BFTM','本次到港','正常 buffer','建议备份','备份开始','备份结束','FDP MAX','FDP 截止','备份 buffer','可用备份数','结果','建议备份开始至 STA','总时长上限','未覆盖原因']);
  let detailRow=2;
  for(const [i,r] of report.selected.rows.entries()){
    const first=detailRow,last=detailRow+report.shifts.length-1,normal=r.normal;
    for(const [j,result] of r.results.entries()){
      const n=detailRow++,p=12+j;
      const airport=report.options.model==='airport',home=report.options.model==='home';
      const limitFormula=sectors=>`IF(AND(MOD(G${n},1440)>=480,MOD(G${n},1440)<780),${sectors===1?840:795},IF(AND(MOD(G${n},1440)>=420,MOD(G${n},1440)<1080),${sectors===1?780:735},IF(AND(MOD(G${n},1440)>=1080,MOD(G${n},1440)<1320),${sectors===1?720:675},${sectors===1?660:615})))`;
      const standbyLimit=limitFormula(r.sectors),normalLimit=normal.limit;
      const maxFormula=airport?standbyLimit:`MIN(${standbyLimit},${normalLimit})`;
      detail.addRow([r.label,result.shift,r.type==='layover'?'过夜去程':'当天往返',r.sectors,r.briefing,r.arrival,{formula:`'规则与时段'!B${p}`,result:result.standbyStart},{formula:`'规则与时段'!C${p}`,result:result.standbyEnd},{formula:`AND(E${n}-G${n}>='规则与时段'!B4,E${n}<=H${n},S${n})`,result:result.eligible},{formula:airport?`G${n}`:`MIN(E${n},G${n}+240)`,result:result.start},{formula:maxFormula,result:result.limit},{formula:`J${n}+K${n}`,result:result.deadline},{formula:`L${n}-F${n}`,result:result.buffer},normal.buffer,{formula:`AND(I${n},M${n}>='规则与时段'!B5,N${n}>='规则与时段'!B5)`,result:result.pass},result.band,{formula:`F${n}-G${n}`,result:result.standbyElapsed},{formula:`IF(D${n}=1,'规则与时段'!B${layoverLimitRow},'规则与时段'!B${turnaroundLimitRow})`,result:result.elapsedLimit},{formula:`AND(Q${n}>=0,Q${n}<=R${n})`,result:result.elapsedPass},result.reason]);
    }
    summary.addRow([r.point,r.label,r.type==='layover'?'过夜去程':'当天往返',r.sectors,clock(r.briefing),clock(r.arrival),duration(normal.buffer),r.best?.shift||'—',r.best?clock(r.best.standbyStart):'—',r.best?clock(r.best.standbyEnd):'—',r.best?duration(r.best.limit):'—',r.best?clock(r.best.deadline):'—',r.best?duration(r.best.buffer):'—',r.coverage,status(r),r.best?duration(r.best.standbyElapsed):'—',duration(TASK_LIMITS[r.type]),r.best?'':r.results.map(x=>`${x.shift}：${x.reason}`).join('；')]);
    summary.getCell(i+2,13).note=`生成时推荐结果；逐备份计算第 ${first}–${last} 行包含完整公式。更改时段后请在网页重新计算并导出，推荐列为生成时快照。`;
  }
  styleSheet(summary,[18,35,16,9,12,16,15,13,13,13,14,18,16,14,24,24,18,80]);styleSheet(detail,[35,10,16,8,16,18,18,18,12,18,18,18,20,20,16,18,24,24,16,65]);
  const conclusion=book.addWorksheet('覆盖结论');conclusion.addRow(['项目','结论','说明']);
  conclusion.addRow(['全覆盖目标',report.goal.achieved?'已实现全覆盖':'未实现全覆盖',`全部已确认 ${report.selected.total} 组；当前覆盖 ${report.selected.covered} 组，不因冲突减少分母`]);
  conclusion.addRow(['待命数量',report.shifts.length,quantityNote(report)]);
  conclusion.addRow(['覆盖结果',`${report.selected.covered}/${report.selected.total}`,report.selected.missing.length?'当前时段存在缺口，详见冲突与开始范围':'全部已确认组合均有可接替时段']);
  conclusion.addRow(['冲突任务',report.proposal.impossible.length,'增加备份也不能解决的任务；仍保留在主表']);
  conclusion.addRow(['口径','任意单次替补均有可接替备份','不表示多班同时缺员，也不要求一组任务绑定一套专属备份']);
  if(report.revision){
    conclusion.addRow(['人工修订',`修订前 ${report.revision.baseline.covered}/${report.selected.total} → 修订后 ${report.selected.covered}/${report.selected.total}`,'按当前计算规则比较；保留人工填写时间，未全覆盖也提供方案']);
    conclusion.addRow(['时段变化',report.revision.changes.map(c=>`${c.name} ${c.before?c.before.start+'–'+c.before.end:'无'} → ${c.after?c.after.start+'–'+c.after.end:'删除'}`).join('；'),'当前时段与逐备份公式均采用修改后的时间']);
  }
  styleSheet(conclusion,[25,50,95]);conclusion.eachRow((r,n)=>{if(n>1)r.height=55;});
  const conflicts=book.addWorksheet('冲突与开始范围');conflicts.addRow(['类别','航班组合','最晚开始／可用范围','总时长要求最早开始','结论或原因','待人工核对的处理条件']);
  for(const d of report.proposal.impossible)conflicts.addRow(['规则冲突',d.label,clock(d.conflict.latestStart),clock(d.conflict.requiredStart),d.conflict.explanation,d.conflict.action]);
  for(const w of report.proposal.startWindows)conflicts.addRow(['可用开始范围',w.label,w.ranges.map(r=>`${clock(r.first)}–${clock(r.last)}`).join('；'),'','所有范围逐分钟核查，不包含中间无效时间','仅用于划分备份，不要求每日实际出勤']);
  for(const r of report.selected.missing)conflicts.addRow(['当前方案未覆盖',r.label,'','',r.results.map(x=>`${x.shift}：${x.reason}`).join('；'),report.revision?.newlyUncovered.includes(r.id)?'此次修订后新增缺口；保留人工时间供核对':'保留当前时段及未覆盖航班供核对']);
  styleSheet(conflicts,[20,35,40,25,90,100]);conflicts.eachRow((r,n)=>{if(n>1)r.height=55;});
  if(report.revision){
    const comparison=book.addWorksheet('方案比较');comparison.addRow(['方案','时段','覆盖','总组合','缺口','最小通过 buffer','>01:00 组合数','备份总时长']);
    for(const s of [{name:'修订前',...evaluateScheme(report.duties,report.revision.baseline.shifts,report.options)},{name:'当前选定方案',...report.selected}])comparison.addRow([s.name,s.shifts.map(x=>`${x.name} ${x.start}–${x.end}`).join('；'),s.covered,s.total,s.missing.map(d=>d.label).join('；'),s.lowest===null?'—':duration(s.lowest),s.preferred,duration(s.shifts.reduce((n,x)=>n+minutes(x.end)-minutes(x.start),0))]);styleSheet(comparison,[30,95,10,12,70,24,24,22]);comparison.eachRow((r,n)=>{if(n>1)r.height=60;});comparison.orderNo=5;
  }
  summary.orderNo=0;conclusion.orderNo=1;params.orderNo=2;detail.orderNo=3;conflicts.orderNo=4;
  return book.xlsx.writeBuffer();
}
export async function standbyDocument(report){
  const text=(value,bold=false)=>new TextRun({text:String(value),bold,font:'微软雅黑',size:21,color:'000000'});
  const p=(value,bold=false)=>new Paragraph({spacing:{after:120,line:300},keepNext:bold,keepLines:true,children:[text(value,bold)]});
  const table=rows=>new Table({width:{size:100,type:WidthType.PERCENTAGE},rows:rows.map((cells,i)=>new TableRow({tableHeader:i===0,children:cells.map(v=>new TableCell({shading:i===0?{fill:'E7F0EC'}:undefined,children:[p(v,i===0)]}))}))});
  const selected=report.selected,missing=selected.missing;
  const children=[new Paragraph({style:'Title',alignment:AlignmentType.CENTER,spacing:{after:240},children:[new TextRun({text:report.title+(report.revision?' 修订版':'')+(report.goal.achieved?'':'（未实现全覆盖 · 诊断说明）'),bold:true,font:'微软雅黑',size:34,color:'000000'})]}),p(`来源：${report.sourceName}。计算口径：${modelName(report.options.model)}。`),p('全覆盖目标与数量选择',true),p(quantityNote(report)+'。全部已确认任务计入覆盖总数；本次验证任意单次替补。'),p(report.goal.achieved?report.proposal.explanation:'当前时段未实现全覆盖，缺口及原因保留供核对。'),p('方案结论',true),p(`当前方案使用 ${selected.shifts.length} 个备份，覆盖 ${selected.covered}/${selected.total} 个已确认航班组合。${missing.length?'存在未满足条件的组合，下文逐一列出缺口及原因。':'所有已纳入的组合均满足本次计算条件。'}被覆盖的组合在任意单次替补时有合格备份，未覆盖组合没有可用备份；本次不计算多班同时缺员的容量。`),table([['备份','开始','结束','时长'],...selected.shifts.map(s=>[s.name,s.start,s.end,duration(minutes(s.end)-minutes(s.start))])]),p('划分依据',true),p(`备份开始至少早于 BFTM ${report.options.leadMinutes} 分钟，BFTM 不晚于备份结束；每段不超过 ${duration(report.options.maxMinutes)}。正常机组与替补机组 buffer 均须至少 ${duration(report.options.minimumBuffer)}，超过 01:00 为优选。`),p(formulaNote(report.options.model)),p('另行核查硬条件：往返从备份开始至回程 STA 不超过 14:00；过夜从备份开始至去程 STA 不超过 09:00。总时长从原备份开始计算，不能改用 FDP 开始时间；即使 buffer 充足，超限也不可接替。'),p('FDP buffer＝FDP 开始＋FDP MAX－本次任务 STA。当天往返按两段及回程 STA；过夜只按去程一段及去程 STA。NX002 按已确认的临时过夜假设计算。'),p('各时段覆盖理由',true)];
  if(report.revision){const rev=report.revision;children.splice(2,0,p('人工修订说明',true),p(`本方案保留人工填写的开始和结束时间。按当前规则比较：修订前覆盖 ${rev.baseline.covered}/${selected.total}，修订后覆盖 ${selected.covered}/${selected.total}；新增缺口 ${rev.newlyUncovered.length} 组，恢复覆盖 ${rev.restored.length} 组。未覆盖组合及原因一并保留，未自动替换所填时段。`),...(rev.changes.length?[table([['备份','修订前','修订后'],...rev.changes.map(c=>[c.name,c.before?c.before.start+'–'+c.before.end:'无',c.after?c.after.start+'–'+c.after.end:'删除'])])]:[]));}
  if(report.proposal?.separateWindows.length){const windows=report.proposal.separateWindows;children.push(p(`下列 ${windows.length} 个组合允许的开始范围互不重叠，因此至少需要 ${windows.length} 个不同开始时段才可能全部覆盖。范围按每一分钟核查，已同时考虑提前量、FDP、备份时长及开始至 STA 的 14／9 小时上限。`),table([['关键组合','可用开始范围'],...windows.map(w=>[w.label,`${clock(w.first)}–${clock(w.last)}`])]));}
  for(const s of selected.shifts){const assigned=selected.rows.filter(r=>r.best?.shift===s.name),available=selected.rows.filter(r=>r.results.some(x=>x.shift===s.name&&x.pass));children.push(p(`${s.name} ${s.start}–${s.end}：可接替 ${available.length} 个组合，其中 ${assigned.length} 个以其为最大 buffer 的首选。${assigned.length?`首选任务 BFTM 范围 ${clock(Math.min(...assigned.map(r=>r.briefing)))}–${clock(Math.max(...assigned.map(r=>r.briefing)))}，最低 buffer ${duration(Math.min(...assigned.map(r=>r.best.buffer)))}。`:'此时段提供重叠可接替选择。'}`));}
  const examples=selected.rows.filter(r=>r.best).sort((a,b)=>a.best.buffer-b.best.buffer).slice(0,3);children.push(p('关键计算示例',true));for(const r of examples)children.push(p(`${r.label}：${r.best.shift} 开始 ${clock(r.best.standbyStart)}；BFTM ${clock(r.briefing)}；${r.sectors} 段，Table A ${r.best.band} 上限 ${duration(r.best.limit)}。${clock(r.best.start)}＋${duration(r.best.limit)}－${clock(r.arrival)}＝${duration(r.best.buffer)}；备份开始至 STA ${duration(r.best.standbyElapsed)}，不超过 ${duration(r.best.elapsedLimit)}。`));
  children.push(p('缺口与处理',true));if(!missing.length)children.push(p('当前全部已确认任务已实现单次替补覆盖。'));
  for(const r of missing){const conflict=report.proposal.impossible.find(d=>d.id===r.id)?.conflict;const window=report.proposal.startWindows.find(w=>w.id===r.id);
    children.push(p(`${r.label}（${r.point}）：未覆盖${report.revision?.newlyUncovered.includes(r.id)?'，为此次修订新增缺口':''}。${groupedReasons(r.results)}。${conflict?conflict.explanation:window?'可用开始范围：'+window.ranges.map(w=>clock(w.first)+'–'+clock(w.last)).join('；')+'（结束时间还须覆盖 BFTM）。':'请核对输入。'}${conflict?conflict.action:'当前人工时段予以保留；如需恢复全覆盖，可参考可用范围调整后重算。'}`));
  }
  children.push(p('使用范围与来源',true),p('FDP 是飞行值勤期，不是纯飞行小时。这里以计划 STA 作为本次任务终点；累计值勤、航后职责、延误、适应时区、休息与多班并发未纳入。本公司经批准的 FTL 方案及运行手册仍需核对。'),p(`Table A 来源：AACM AC/OPS/013R00 §10.1.1。指定四小时算法及往返 14 小时／过夜 9 小时上限为本次用户明确的计算条件，并非对完整法规适用性的认定。${SOURCE_URL}`),p('Excel 包含逐备份公式、可接替判定和未覆盖组合。修改网页时段后重新计算，并重新导出，保留对应的已确认航班版本。'));
  const doc=new Document({styles:{default:{document:{run:{font:'微软雅黑',size:21},paragraph:{spacing:{after:120}}}}},sections:[{properties:{page:{size:{width:11906,height:16838},margin:{top:1100,bottom:1100,left:1100,right:1100}}},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({children:['第 ',PageNumber.CURRENT,' 页'],size:18})]})]})},children}]});return Packer.toBuffer(doc);
}
export function standbyRouter(upload){
  const router=express.Router(),wrap=fn=>(req,res,next)=>Promise.resolve().then(()=>fn(req,res)).catch(e=>{e.status=400;next(e);});
  router.post('/import',upload.single('file'),wrap(async(req,res)=>{try{if(!req.file||!req.file.originalname.toLowerCase().endsWith('.xlsx'))throw Error('请选择已确认的 XLSX 航班表');res.json(await importStandbyWorkbook(await fs.readFile(req.file.path)));}finally{if(req.file)await fs.unlink(req.file.path).catch(()=>{});}}));
  router.post('/analyze',wrap((req,res)=>res.json(analyzeStandby(req.body))));
  router.post('/export/:format',wrap(async(req,res)=>{const format=req.params.format;if(!['xlsx','docx'].includes(format))throw Error('不支持此格式');const report=analyzeStandby(req.body),bytes=format==='xlsx'?await standbyWorkbook(report):await standbyDocument(report);res.type(format==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/vnd.openxmlformats-officedocument.wordprocessingml.document');res.set('Content-Disposition',`attachment; filename="standby-plan.${format}"`);res.send(Buffer.from(bytes));}));
  return router;
}
