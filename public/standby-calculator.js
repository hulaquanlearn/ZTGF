export const TABLE_A = [
  {label:'0700–0759',start:420,end:480,limits:[780,735,690,645,600,555,540,540]},
  {label:'0800–1259',start:480,end:780,limits:[840,795,750,705,660,615,570,540]},
  {label:'1300–1759',start:780,end:1080,limits:[780,735,690,645,600,555,540,540]},
  {label:'1800–2159',start:1080,end:1320,limits:[720,675,630,585,540,540,540,540]},
  {label:'2200–0659',start:1320,end:420,limits:[660,615,570,540,540,540,540,540]},
];
export const SOURCE_URL = 'https://www.aacm.gov.mo/uploads/download1/AC-OPS-013-R00.pdf';
export const RULE_VERSION = 'four-hour-min-table-total-14-9-v2';
export const TASK_LIMITS = Object.freeze({turnaround:840,layover:540});
export function minutes(value){
  const text=String(value??'').trim().replace(':','').padStart(4,'0');
  if(!/^\d{4}$/.test(text)||Number(text.slice(0,2))>23||Number(text.slice(2))>59||value===null||value===undefined||value==='')throw Error('时间应为四位数字，例如 0650');
  return Number(text.slice(0,2))*60+Number(text.slice(2));
}
export function clock(value){const n=((value%1440)+1440)%1440;return String(Math.floor(n/60)).padStart(2,'0')+String(n%60).padStart(2,'0')+(value>=1440?` (+${Math.floor(value/1440)}日)`:'');}
export function duration(value){const n=Math.abs(value);return (value<0?'-':'')+String(Math.floor(n/60)).padStart(2,'0')+':'+String(n%60).padStart(2,'0');}
export function fdpLimit(start,sectors){
  if(!Number.isInteger(sectors)||sectors<1||sectors>8)throw Error('航段数须为 1–8；8 代表八段及以上');
  const t=((start%1440)+1440)%1440;
  const band=TABLE_A.find(b=>b.start<b.end?t>=b.start&&t<b.end:t>=b.start||t<b.end);
  return {minutes:band.limits[sectors-1],band:band.label};
}
export function casesFromRows(rows,{nx002Layover=true}={}){
  const cases=[],warnings=[];let outbound;
  for(const row of rows){
    const m=/^NX(\d{3,4})(?:\+(\d+))?$/.exec(String(row.number).trim());
    if(!m)throw Error(`第 ${row.sourceRow} 行航班号无效`);
    if(Number(m[1])%2===0){
      if(row.briefing===null||row.briefing===undefined||row.briefing==='')throw Error(`${row.number} 缺少 BFTM`);
      outbound={...row,returns:[]};cases.push(outbound);
    }else{
      if(!outbound||outbound.airport!==row.airport)throw Error(`第 ${row.sourceRow} 行回程没有相邻同航点的去程，请人工确认配对`);
      outbound.returns.push({...row,returnDays:Number(m[2]||0)});
    }
  }
  const duties=[];
  for(const out of cases){
    const briefing=minutes(out.briefing),std=minutes(out.departure);
    if(std-briefing!==70)warnings.push(`${out.number} 的 STD－BFTM 不等于 70 分钟，保留原表 BFTM`);
    const returns=out.number==='NX002'&&nx002Layover?[{number:'待确认回程',returnDays:1}]:out.returns;
    if(!returns.length)throw Error(`${out.number} 缺少回程或过夜确认`);
    for(const back of returns){
      const layover=back.returnDays>0,sectors=layover?1:2;
      let arrival=minutes(layover?out.arrival:back.arrival)+1440*Number((layover?out:back).arrivalOffset||0);
      if(arrival<briefing)arrival+=1440;
      if(!layover&&minutes(back.departure)<minutes(out.arrival))throw Error(`${out.number}/${back.number} 当天回程早于去程到港，请人工确认跨日`);
      duties.push({id:out.number+'/'+back.number+'/'+out.sourceRow,label:out.number+(out.number==='NX002'&&nx002Layover?'（暂按过夜）':' + '+back.number),point:out.point,airport:out.airport,outbound:out.number,returnFlight:back.number,type:layover?'layover':'turnaround',sectors,briefing,departure:std,arrival,sourceRow:out.sourceRow,enabled:true});
    }
  }
  return {duties,warnings};
}
export function calculateDuty(duty,shift=null,options={}){
  const {model='user-four-hour',leadMinutes=45,minimumBuffer=30}=options;
  const baseline=fdpLimit(duty.briefing,duty.sectors),normalBuffer=duty.briefing+baseline.minutes-duty.arrival;
  let start=duty.briefing,limit=baseline,eligible=true,timeEligible=true,elapsedPass=true,reason='正常机组',standbyStart=null,standbyEnd=null,standbyElapsed=null;
  const elapsedLimit=TASK_LIMITS[duty.type]??(duty.sectors===1?TASK_LIMITS.layover:TASK_LIMITS.turnaround);
  if(shift){
    standbyStart=minutes(shift.start);standbyEnd=minutes(shift.end);if(standbyEnd<=standbyStart)standbyEnd+=1440;
    if(standbyEnd-standbyStart>720)throw Error('备份时段不能超过 12 小时');
    timeEligible=duty.briefing-standbyStart>=leadMinutes&&duty.briefing<=standbyEnd;
    standbyElapsed=duty.arrival-standbyStart;
    elapsedPass=standbyElapsed>=0&&standbyElapsed<=elapsedLimit;
    eligible=timeEligible&&elapsedPass;
    if(!timeEligible)reason=duty.briefing>standbyEnd?'BFTM 晚于备份结束':'不足提前 '+leadMinutes+' 分钟';
    else if(!elapsedPass)reason=`备份开始至本次 STA ${duration(standbyElapsed)}，超过${duty.sectors===1?'过夜':'往返'} ${duration(elapsedLimit)} 上限`;
    const atStandby=fdpLimit(standbyStart,duty.sectors);
    if(model==='airport'){start=standbyStart;limit=atStandby;}
    else if(model==='home'){start=Math.min(duty.briefing,standbyStart+240);limit=atStandby.minutes<baseline.minutes?atStandby:baseline;}
    else if(model==='user-four-hour'){start=Math.min(duty.briefing,standbyStart+240);limit=atStandby.minutes<baseline.minutes?atStandby:baseline;}
    else throw Error('未知备份计算口径');
  }
  const deadline=start+limit.minutes,buffer=deadline-duty.arrival;
  const pass=eligible&&normalBuffer>=minimumBuffer&&buffer>=minimumBuffer;
  if(eligible&&normalBuffer<minimumBuffer)reason='正常机组 buffer 不足';
  else if(eligible&&buffer<minimumBuffer)reason='备份 buffer 不足';
  else if(shift&&pass)reason='提前量、buffer 与总时长均通过';
  return {start,limit:limit.minutes,band:limit.band,deadline,buffer,normalBuffer,eligible,timeEligible,elapsedPass,standbyElapsed,elapsedLimit,pass,preferred:pass&&buffer>60,reason,standbyStart,standbyEnd};
}
export function evaluateScheme(duties,shifts,options={}){
  const rows=duties.filter(d=>d.enabled!==false).map(d=>{
    const results=shifts.map(s=>({shift:s.name,...calculateDuty(d,s,options)}));
    const passing=results.filter(r=>r.pass).sort((a,b)=>b.buffer-a.buffer);
    return {...d,normal:calculateDuty(d,null,options),results,coverage:passing.length,best:passing[0]||null};
  });
  const covered=rows.filter(r=>r.best),lowest=covered.length?Math.min(...covered.map(r=>r.best.buffer)):null;
  return {rows,covered:covered.length,total:rows.length,missing:rows.filter(r=>!r.best),lowest,preferred:covered.filter(r=>r.best.preferred).length,shifts};
}
export const PLAN_VERSION = 'full-coverage-prefer-six-v1';
export const PREFERRED_COUNTS = Object.freeze([4,5,6]);

// Reuse expensive searches for recalculation and exports; bound memory usage.
const proposalCache=new Map();
export function proposeSchemes(duties,options={},constraints={}){
  const key=JSON.stringify([duties,options,constraints]);
  if(proposalCache.has(key))return structuredClone(proposalCache.get(key));
  const proposal=searchSchemes(duties,options,constraints);
  if(proposalCache.size>=8)proposalCache.delete(proposalCache.keys().next().value);
  proposalCache.set(key,structuredClone(proposal));
  return proposal;
}
function searchSchemes(duties,options={},constraints={}){
  const active=duties.filter(d=>d.enabled!==false),maxMinutes=Number(options.maxMinutes??420),lead=Number(options.leadMinutes??45),grid=1;
  if(!active.length||active.length>150)throw Error('请确认 1–150 组航班');
  if(!Number.isInteger(maxMinutes)||maxMinutes<45||maxMinutes>720)throw Error('单段备份时长应为 45–720 分钟');
  const all=(1n<<BigInt(active.length))-1n,allCandidates=[],windows=active.map(d=>({id:d.id,label:d.label,first:null,last:null,ranges:[]})),bestPossible=active.map(()=>null);
  const countBits=m=>{let n=0;while(m){m&=m-1n;n++;}return n;};
  const rank=r=>r.pass?2:r.eligible?1:0;
  // One-minute enumeration includes narrow valid windows in future imported timetables.
  for(let start=0;start<1440;start++){
    const end=Math.min(1439,start+maxMinutes);if(end-start<lead)continue;
    const shift={name:'',start:clock(start),end:clock(end)},buffers=[];let mask=0n,score=0;
    for(const [i,d] of active.entries()){
      const result=calculateDuty(d,shift,options);buffers.push(result.pass?result.buffer:null);
      const best=bestPossible[i];
      if(result.timeEligible&&(!best||rank(result)>rank(best)||rank(result)===rank(best)&&(result.buffer>best.buffer||result.buffer===best.buffer&&result.standbyElapsed<best.standbyElapsed)))bestPossible[i]={...result,shift};
      if(!result.pass)continue;mask|=1n<<BigInt(i);score+=Math.min(result.buffer,180);
      const w=windows[i];w.first??=start;w.last=start;
      const previous=w.ranges.at(-1);if(previous?.last===start-1)previous.last=start;else w.ranges.push({first:start,last:start});
    }
    allCandidates.push({shift,mask,buffers,score});
  }
  const candidates=allCandidates.filter(c=>c.mask),universe=candidates.reduce((m,c)=>m|c.mask,0n),reachable=countBits(universe);
  const startWindows=windows.filter(w=>w.first!==null),separateWindows=[];let previous=-1;
  for(const w of [...startWindows].sort((a,b)=>a.last-b.last))if(w.first>previous){separateWindows.push(w);previous=w.last;}
  const impossible=active.flatMap((d,i)=>{
    if(universe&(1n<<BigInt(i)))return [];
    const latestStart=d.briefing-lead,elapsedLimit=TASK_LIMITS[d.type]??(d.sectors===1?TASK_LIMITS.layover:TASK_LIMITS.turnaround),requiredStart=Math.max(0,d.briefing-maxMinutes,d.arrival-elapsedLimit),normal=calculateDuty(d,null,options);
    let code='fdp',explanation='逐分钟检查所有备份开始时间，均无法同时满足提前量、时段、FDP buffer 与总时长条件。',action='请核对 BFTM、任务到港时间和人工安排；确认任务调整后重新分析。';
    if(normal.buffer<(options.minimumBuffer??30)){code='normal-fdp';explanation=`正常机组 buffer ${duration(normal.buffer)} 小于最低 ${duration(options.minimumBuffer??30)}，增加备份不能消除这一条件冲突。`;}
    else if(d.arrival-elapsedLimit>latestStart){code='total-duration';explanation=`提前 ${lead} 分钟要求备份最晚 ${clock(latestStart)} 开始；总时长 ${duration(elapsedLimit)} 上限要求最早 ${clock(d.arrival-elapsedLimit)} 开始，两者没有交集。最短总时长仍为 ${duration(d.arrival-latestStart)}。`;action=`若保持 BFTM ${clock(d.briefing)} 和当前规则，本次任务 STA 需不晚于 ${clock(latestStart+elapsedLimit)}（较当前提前 ${duration(d.arrival-latestStart-elapsedLimit)}）；这是待人工核对的任务调整条件，不会自动修改时刻表。`;}
    else if(latestStart<0||maxMinutes<lead){code='lead';explanation='现有 BFTM、提前量和可用备份时长之间没有可选开始时间。';}
    else if(bestPossible[i]?.eligible){const best=bestPossible[i];explanation=`提前 ${lead} 分钟要求备份最晚 ${clock(latestStart)} 开始。逐分钟搜索后，最好的备份 buffer 仍只有 ${duration(best.buffer)}，低于最低 ${duration(options.minimumBuffer??30)}；FDP 开始 ${clock(best.start)}，Table A 较小上限 ${duration(best.limit)}，任务 STA ${clock(d.arrival)}。增加备份数量不能解决。`;action=`若保持 BFTM ${clock(d.briefing)} 和当前规则，任务 STA 需不晚于 ${clock(best.deadline-(options.minimumBuffer??30))}，较当前提前 ${duration((options.minimumBuffer??30)-best.buffer)}；请人工核对任务安排，不会自动修改时刻表或放宽 buffer。`;}
    return [{...d,bestPossible:bestPossible[i],conflict:{code,explanation,action,latestStart,requiredStart,elapsedLimit,shortestElapsed:d.arrival-latestStart,normalBuffer:normal.buffer}}];
  });
  const fixed=constraints.fixedShifts||[],requested=constraints.requestedCount;
  if(fixed.length||requested){
    const asCandidate=shift=>{const buffers=active.map(d=>{const r=calculateDuty(d,shift,options);return r.pass?r.buffer:null;});let mask=0n;buffers.forEach((b,i)=>{if(b!==null)mask|=1n<<BigInt(i);});return {shift,mask,buffers,fixed:true};};
    const locked=fixed.map(asCandidate),score=list=>{let covered=0,preferred=0,lowest=180,sum=0;for(let i=0;i<active.length;i++){const values=list.map(c=>c.buffers[i]).filter(x=>x!==null);if(values.length){const best=Math.max(...values);covered++;preferred+=best>60?1:0;lowest=Math.min(lowest,best);sum+=Math.min(best,180);}}const starts=list.map(x=>minutes(x.shift.start)).sort((a,b)=>a-b);const space=starts.slice(1).reduce((v,x,i)=>v+Math.min(90,x-starts[i]),0);return covered*1e12+preferred*1e9+(covered?lowest:0)*1e6+space*1000+sum;};
    const largest=Math.max(0,...fixed.map(x=>Number(x.name.slice(1))));
    const counts=requested?[requested]:Array.from({length:Math.max(6,largest)-Math.max(4,largest)+1},(_,i)=>Math.max(4,largest)+i);
    const schemes=counts.map(n=>{
      let list=[...locked];const free=Array.from({length:n},(_,i)=>'S'+(i+1)).filter(name=>!fixed.some(s=>s.name===name));
      for(const name of free){let best=null,bestScore=-Infinity;for(const c of allCandidates){if(list.some(x=>x.shift.start===c.shift.start))continue;const next=score([...list,c]);if(next>bestScore){best=c;bestScore=next;}}if(!best)throw Error('无法安排指定数量的备份');list.push({...best,shift:{...best.shift,name},fixed:false});}
      for(let pass=0;pass<2;pass++)for(let i=0;i<list.length;i++){if(list[i].fixed)continue;let best=list[i],bestScore=score(list);for(const c of candidates){if(list.some((x,j)=>j!==i&&x.shift.start===c.shift.start))continue;const trial=[...list];trial[i]=c;const next=score(trial);if(next>bestScore){best={...c,shift:{...c.shift,name:list[i].shift.name},fixed:false};bestScore=next;}}list[i]=best;}
      return {name:n+' 个备份',...evaluateScheme(active,list.map(x=>x.shift).sort((a,b)=>Number(a.name.slice(1))-Number(b.name.slice(1))),options)};
    });
    // Fixed times can consume slots without covering a task. With automatic count,
    // extend the feasible plan instead of treating the preferred six as a hard cap.
    if(!requested&&!schemes.some(s=>s.covered===reachable)){
      const seed=schemes.reduce((best,s)=>s.covered>best.covered||s.covered===best.covered&&s.preferred>best.preferred?s:best);
      const list=seed.shifts.map(asCandidate);
      let mask=list.reduce((m,c)=>m|c.mask,0n);
      while(mask!==universe&&list.length<150){
        let best=null,bestScore=-Infinity;
        for(const c of candidates){if(!(c.mask&~mask)||list.some(x=>x.shift.start===c.shift.start))continue;const next=score([...list,c]);if(next>bestScore){best=c;bestScore=next;}}
        if(!best)break;
        list.push({...best,shift:{...best.shift,name:'S'+(list.length+1)}});mask|=best.mask;
      }
      if(list.length>seed.shifts.length)schemes.push({name:list.length+' 个备份 · 自动扩展',...evaluateScheme(active,list.map(x=>x.shift),options)});
    }
    const recommended=schemes.find(s=>s.covered===s.total)||schemes.reduce((best,s)=>s.covered>best.covered||s.covered===best.covered&&s.preferred>best.preferred?s:best);
    const completePossible=universe===all;
    return {planVersion:PLAN_VERSION,objective:'full-coverage',preferredCounts:counts,schemes,recommended,impossible,separateWindows,startWindows,completePossible,reachable,total:active.length,minimumProven:false,requiredCount:recommended.shifts.length,constrained:true,explanation:recommended.covered===recommended.total?`固定时间已保留，使用 ${recommended.shifts.length} 个备份实现全覆盖${!requested&&recommended.shifts.length>6?'；数量自动扩展，超过优先的 6 个':''}。`:impossible.length?impossible.length+' 组任务与计算规则冲突。':'当前固定时间或数量下仍有覆盖缺口；可调整定制要求。'};
  }
  const equalMasks=new Map();for(const c of candidates){const key=c.mask.toString();if(!equalMasks.has(key)||equalMasks.get(key).score<c.score)equalMasks.set(key,c);}
  const unique=[...equalMasks.values()],pool=unique.filter(c=>!unique.some(o=>o!==c&&(c.mask|o.mask)===o.mask));
  // A feasible greedy cover is retained even if proving minimum count hits the search budget.
  let greedy=[],covered=0n;
  while(covered!==universe){let best=null,gain=0;for(const c of pool){const n=countBits(c.mask&~covered);if(n>gain||n===gain&&n>0&&c.score>(best?.score??-1)){best=c;gain=n;}}if(!best)throw Error('备份搜索无法覆盖可接替任务');greedy.push(best);covered|=best.mask;}
  for(let i=greedy.length-1;i>=0;i--){const trial=greedy.filter((_,j)=>i!==j);if(trial.reduce((m,c)=>m|c.mask,0n)===universe)greedy=trial;}
  const maxGain=pool.length?Math.max(...pool.map(c=>countBits(c.mask))):0;
  const lowerBoundCount=reachable?Math.max(separateWindows.length,Math.ceil(reachable/maxGain)):0;
  let answer=greedy,minimumProven=reachable===0||lowerBoundCount===greedy.length,searchSteps=0,searchLimited=false;
  const deadline=Date.now()+2500;
  function search(mask,chosen,remaining,visited){
    if(++searchSteps>60000||Date.now()>deadline){searchLimited=true;return null;}
    if(mask===universe)return chosen;if(!remaining)return null;
    const key=mask.toString();if((visited.get(key)||0)>=remaining)return null;visited.set(key,remaining);
    const uncovered=universe&~mask;let choices=null;
    for(let i=0;i<active.length;i++)if(uncovered&(1n<<BigInt(i))){const list=pool.filter(c=>c.mask&(1n<<BigInt(i)));if(!choices||list.length<choices.length)choices=list;}
    const gain=Math.max(...pool.map(c=>countBits(c.mask&uncovered)));if(Math.ceil(countBits(uncovered)/gain)>remaining)return null;
    choices.sort((a,b)=>countBits(b.mask&uncovered)-countBits(a.mask&uncovered)||b.score-a.score);
    for(const c of choices){const found=search(mask|c.mask,[...chosen,c],remaining-1,visited);if(found)return found;if(searchLimited)return null;}return null;
  }
  if(!minimumProven)for(let n=lowerBoundCount;n<greedy.length;n++){
    const found=search(0n,[],n,new Map());if(found){answer=found;minimumProven=true;break;}if(searchLimited)break;
    if(n===greedy.length-1)minimumProven=true;
  }
  const fitness=list=>{
    let coverage=0,preferred=0,lowest=180,sum=0,overlap=0;
    for(let i=0;i<active.length;i++){let best=-1;for(const c of list)if(c.buffers[i]!==null){best=Math.max(best,c.buffers[i]);overlap++;}if(best>=0){coverage++;preferred+=best>60?1:0;lowest=Math.min(lowest,best);sum+=Math.min(best,180);}}
    const starts=list.map(c=>minutes(c.shift.start)).sort((a,b)=>a-b);
    const spacing=starts.slice(1).reduce((n,s,i)=>n+Math.min(90,s-starts[i]),0);
    return coverage*1e12+preferred*1e9+(coverage?lowest:0)*1e6+spacing*1000+sum+overlap/100;
  };
  function improve(list){
    for(let pass=0;pass<2;pass++)for(let i=0;i<list.length;i++){
      let best=list,bestScore=fitness(list);
      for(const c of candidates){const trial=list.map((x,j)=>j===i?c:x);if(new Set(trial.map(x=>x.shift.start)).size!==trial.length)continue;const score=fitness(trial);if(score>bestScore){best=trial;bestScore=score;}}
      list=best;
    }return list;
  }
  function extend(list,n){
    list=[...list];while(list.length<n){let best=null,score=-Infinity;
      for(const c of allCandidates){if(list.some(x=>x.shift.start===c.shift.start))continue;const next=fitness([...list,c]);if(next>score){score=next;best=c;}}if(!best)break;list.push(best);
    }return list;
  }
  const toScheme=(list,name)=>({name,...evaluateScheme(active,list.map(c=>c.shift).sort((a,b)=>minutes(a.start)-minutes(b.start)).map((s,i)=>({...s,name:'S'+(i+1)})),options)});
  const schemes=PREFERRED_COUNTS.map(n=>{
    let list=n>=answer.length?extend(answer,n):extend([],n);list=improve(list);
    const scheme=toScheme(list,'');scheme.name=`${n} 个备份 · ${scheme.covered===scheme.total?'全覆盖':'未全覆盖候选'}`;return scheme;
  });
  // The fixed goal is all confirmed duties. An impossible duty is never dropped from the denominator.
  const completePossible=universe===all,requiredCount=answer.length;
  const automaticScheme=requiredCount?toScheme(improve(answer),`${requiredCount} 个备份 · ${completePossible?'全覆盖扩展方案':'可接替任务覆盖（仍有冲突）'}`):null;
  if(automaticScheme&&requiredCount>6)schemes.push(automaticScheme);
  const recommended=schemes.find(s=>s.covered===s.total)||(completePossible?automaticScheme:schemes.find(s=>s.shifts.length===6));
  let explanation;
  if(impossible.length)explanation=`${impossible.length} 组任务与当前规则冲突，增加备份数量也不能实现全部 ${active.length} 组覆盖。优先保留 6 个以内候选；另列 ${requiredCount} 个备份覆盖 ${reachable} 组可接替任务的诊断，冲突任务仍计入总数。`;
  else if(requiredCount>6)explanation=minimumProven?`全覆盖最少需要 ${requiredCount} 个备份，4／5／6 个不足；增加到 ${requiredCount} 个是为了满足全部任务的可用开始范围和 FDP 条件。`:`已找到 ${requiredCount} 个备份的全覆盖方案，暂未证明最少数量；4／5／6 个候选仍有缺口。`;
  else explanation=`已找到 6 个以内的全覆盖方案，优先选用数量较少的候选。备份无需每天实际执飞，但任意单次替补均有合格时段可用。`;
  return {planVersion:PLAN_VERSION,objective:'full-coverage',preferredCounts:PREFERRED_COUNTS,schemes,automaticScheme,recommended,impossible,separateWindows,startWindows,gridMissing:0,reachable,total:active.length,completePossible,minimumCount:minimumProven?requiredCount:null,minimumProven,requiredCount,lowerBoundCount,searchLimited,gridMinutes:grid,maxMinutes,explanation};
}
