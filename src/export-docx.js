import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageNumber, Footer, SectionType } from 'docx';

const labels = { boolean:'判断题',choice:'单选题',multiple:'多选题',fill:'填空题',short:'简答题' };

export async function examDocx(exam, includeAnswers = false) {
  const children = header(exam.title, `题目数量：${exam.questions.length}${includeAnswers?' · 含标准答案':''}`);
  const seen=new Set();exam.questions.forEach((q,i) => {if(q.materialText&&(!q.groupId||!seen.has(q.groupId))){children.push(...materialParagraphs(q));if(q.groupId)seen.add(q.groupId);}children.push(...questionParagraphs(q,i,includeAnswers));});
  return pack(children);
}

export async function attemptDocx(attempt, wrongOnly = false) {
  const percentage = attempt.maxScore ? Math.round(attempt.score/attempt.maxScore*1000)/10 : 0;
  const children = header(`${attempt.title} · ${wrongOnly?'错题':'答题'}报告`, `考生：${attempt.candidateName} · 成绩：${attempt.score.toFixed(1)}/${attempt.maxScore.toFixed(1)} · ${percentage}%`);
  const seen=new Set();
  for (const result of attempt.results || []) {
    if (wrongOnly && result.score >= result.maxPoints) continue;
    const q = attempt.questions?.[result.index]; if (!q) continue;
    if(q.materialText&&!seen.has(q.materialText)){children.push(...materialParagraphs(q));seen.add(q.materialText);}
    children.push(...questionParagraphs({ ...q, answer:result.correctAnswer, explanation:result.explanation }, result.index, true, attempt.answers?.[result.index], result.score));
  }
  return pack(children);
}

export async function wrongQuestionsDocx(name, questions) {
  const children = header(`${name} · 错题本`, `错题数量：${questions.length}`);
  const seen=new Set();questions.forEach((q,i)=>{if(q.materialText&&!seen.has(q.materialText)){children.push(...materialParagraphs(q));seen.add(q.materialText);}children.push(...questionParagraphs({ ...q,answer:q.correctAnswer },i,true,undefined,undefined,`累计答错 ${q.wrongCount} 次`));});
  return pack(children);
}

function header(title, subtitle) {
  return [new Paragraph({ heading:HeadingLevel.TITLE,alignment:AlignmentType.CENTER,spacing:{after:120},children:[new TextRun({text:title,bold:true,size:36,font:'Calibri'})] }),new Paragraph({alignment:AlignmentType.CENTER,spacing:{after:240},children:[new TextRun({text:subtitle,color:'666666',size:20,font:'Calibri'})]})];
}

function questionParagraphs(q,index,includeAnswers,userAnswer,score,note) {
  const out=[new Paragraph({heading:HeadingLevel.HEADING_2,spacing:{before:160,after:80},children:[new TextRun({text:`${index+1}. [${labels[q.type]||q.type}] ${q.question}`,bold:true,font:'Calibri',size:22})]})];
  (q.options||[]).forEach((option,i)=>out.push(new Paragraph({indent:{left:360},spacing:{after:50},children:[new TextRun({text:`${String.fromCharCode(65+i)}. ${option}`,font:'Calibri',size:21})]})));
  if (q.type==='fill' && !includeAnswers) (q.blanks||[]).forEach((_b,i)=>out.push(new Paragraph({indent:{left:360},children:[new TextRun({text:`第${i+1}空：____________________`,size:21})]})));
  if (q.type==='short' && !includeAnswers) out.push(new Paragraph({spacing:{after:80},children:[new TextRun({text:'答：\n\n',size:21})]}));
  if (includeAnswers) {
    out.push(new Paragraph({spacing:{before:60,after:40},children:[new TextRun({text:`标准答案：${answerText(q)}`,bold:true,color:'1F6B55',size:21})]}));
    if (userAnswer !== undefined) out.push(new Paragraph({children:[new TextRun({text:`考生答案：${userAnswerText(q,userAnswer)}${score===undefined?'':` · 得分 ${score}`}`,size:21})]}));
    if (q.explanation) out.push(new Paragraph({children:[new TextRun({text:`解析：${q.explanation}`,color:'555555',size:20})]}));
  }
  if (note) out.push(new Paragraph({children:[new TextRun({text:note,color:'9B1C1C',bold:true,size:20})]}));
  return out;
}

function materialParagraphs(q){return [new Paragraph({heading:HeadingLevel.HEADING_2,spacing:{before:220,after:100},children:[new TextRun({text:q.materialTitle||'阅读材料',bold:true,color:'1F6B55',size:25})]}),...String(q.materialText).split(/\n+/).filter(Boolean).map(text=>new Paragraph({spacing:{after:90,line:330},children:[new TextRun({text,font:'Calibri',size:21})]}))];}

function answerText(q) {
  if(q.type==='boolean') return q.answer?'正确':'错误';
  if(q.type==='choice'||q.type==='multiple') return (Array.isArray(q.answer)?q.answer:[q.answer]).map(i=>String.fromCharCode(65+Number(i))).join('、');
  if(q.type==='fill') return (q.answer||[]).map((a,i)=>`第${i+1}空 ${(Array.isArray(a)?a:[a]).join('/')}`).join('；');
  return (Array.isArray(q.answer)?q.answer:[q.answer]).join(' / ');
}

function userAnswerText(q,answer) {
  if(q.type==='boolean') return String(answer)==='true'?'正确':String(answer)==='false'?'错误':'未作答';
  if(q.type==='choice'||q.type==='multiple') return (Array.isArray(answer)?answer:[answer]).filter(x=>x!==undefined&&x!=='').map(i=>String.fromCharCode(65+Number(i))).join('、')||'未作答';
  if(q.type==='fill') return (Array.isArray(answer)?answer:[]).map((x,i)=>`第${i+1}空 ${x||'未作答'}`).join('；');
  return String(answer||'未作答');
}

function pack(children) {
  const doc=new Document({styles:{default:{document:{run:{font:'Calibri',size:22},paragraph:{spacing:{after:120,line:300}}}},paragraphStyles:[{id:'Title',name:'Title',basedOn:'Normal',next:'Normal',run:{size:36,bold:true,color:'0B2545'},paragraph:{spacing:{after:120}}},{id:'Heading2',name:'Heading 2',basedOn:'Normal',next:'Normal',run:{size:26,bold:true,color:'2E74B5'},paragraph:{spacing:{before:280,after:140}}}]},sections:[{properties:{type:SectionType.CONTINUOUS,page:{size:{width:12240,height:15840},margin:{top:1440,right:1440,bottom:1440,left:1440,header:708,footer:708}}},footers:{default:new Footer({children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({children:['第 ',PageNumber.CURRENT,' 页'],color:'777777',size:18})]})]})},children}]});
  return Packer.toBuffer(doc);
}
