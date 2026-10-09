import ExcelJS from 'exceljs';

const aliases = {
  zh:['zh','chinese','中文','中文释义'], en:['en','english','英文','英语'], track:['track','学习方向'],
  partOfSpeech:['partofspeech','part_of_speech','词性'], pronunciation:['pronunciation','音标','读音','音标/读音'],
  meanings:['meanings','meaning','释义'], acceptedZh:['acceptedzh','accepted_zh','中文可接受答案'], acceptedEn:['accepteden','accepted_en','英文可接受答案'], exampleEn:['exampleen','example_en','英文例句'],
  exampleZh:['examplezh','example_zh','例句翻译'], chapter:['chapter','章节'], difficulty:['difficulty','难度'], frequencyRank:['frequencyrank','frequency_rank','词频排名'], tags:['tags','标签'],
  source:['source','来源'], sourceUrl:['sourceurl','source_url','来源网址'], license:['license','许可协议'], attribution:['attribution','署名'], reviewStatus:['reviewstatus','review_status','审核状态']
};

export async function parseVocabularyFile(file) {
  const workbook=new ExcelJS.Workbook(),name=file.originalname.toLowerCase();
  if(name.endsWith('.csv')) await workbook.csv.readFile(file.path);
  else await workbook.xlsx.readFile(file.path);
  const sheet=workbook.worksheets[0];
  if(!sheet)throw new Error('表格中没有工作表');
  const headers={};
  let hasRetiredColumns=false;
  const retiredHeaders=new Set(['th','thai','泰文','泰语','罗马音','泰文例句','泰文可接受答案']);
  sheet.getRow(1).eachCell((cell,col)=>{const key=String(cell.text||'').trim().toLowerCase().replace(/\s+/g,'');if(retiredHeaders.has(key))hasRetiredColumns=true;for(const [field,names] of Object.entries(aliases))if(names.includes(key))headers[col]=field;});
  if(hasRetiredColumns)throw new Error('该表格包含已停用的语言字段，请下载并使用当前中英词库模板');
  if(!Object.values(headers).includes('zh')||!Object.values(headers).includes('en'))throw new Error('表格必须同时包含中文列和英文列');
  const entries=[],incomplete=[];
  for(let rowNo=2;rowNo<=sheet.rowCount;rowNo++){
    const row=sheet.getRow(rowNo),entry={};
    for(const [col,field] of Object.entries(headers))entry[field]=String(row.getCell(Number(col)).text||'').trim();
    if(!Object.values(entry).some(Boolean))continue;
    if(!entry.zh||!entry.en){incomplete.push({row:rowNo,reason:'中文或英文为空',entry});continue;}
    entries.push(entry);
  }
  return {entries,incomplete};
}

export async function vocabularyTemplate() {
  const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('中英词库');
  sheet.addRow(['中文','英文','学习方向','词性','音标/读音','释义','中文可接受答案','英文可接受答案','英文例句','例句翻译','章节','难度','词频排名','标签','来源','来源网址','许可协议','署名','审核状态']);
  sheet.addRow(['放弃','abandon','postgraduate','动词','/əˈbændən/','放弃；抛弃','','give up','','','考研核心词汇','3','120','高频；核心','示例数据','','自有','QuizForge 示例','needs-review']);
  sheet.columns=[18,18,16,12,18,24,20,20,30,28,18,10,12,18,20,28,16,24,16].map(width=>({width}));
  sheet.getRow(1).font={bold:true}; sheet.views=[{state:'frozen',ySplit:1}];
  return workbook.xlsx.writeBuffer();
}
