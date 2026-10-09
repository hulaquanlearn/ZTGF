import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import ExcelJS from 'exceljs';

const args=Object.fromEntries(process.argv.slice(2).map(value=>{const [key,...rest]=value.replace(/^--/,'').split('=');return [key,rest.join('=')||true];}));
if(!args.input)throw new Error('请提供 --input=英文词表.txt');
const input=path.resolve(String(args.input));
const track=String(args.track||'postgraduate');
if(!['general','english','postgraduate','ielts'].includes(track))throw new Error('学习方向仅支持 general、english、postgraduate 或 ielts');
const limit=Math.min(20000,Math.max(1,Number(args.limit||5500)));
const output=path.resolve(String(args.output||`seed-data/${track}-core-source-${limit}.xlsx`));

const text=await fs.readFile(input,'utf8');
const sourceRows=text.split(/\r?\n/).map(line=>{
  const parts=line.trim().split(/[\t,]/);
  return {term:String(parts[0]||'').trim(),frequency:Number(parts[1])||0};
}).filter(row=>row.term&&!row.term.startsWith('#'));

const seen=new Set(),rows=[];
for(const row of sourceRows){const key=row.term.normalize('NFKC').toLocaleLowerCase('en');if(seen.has(key))continue;seen.add(key);rows.push(row);if(rows.length>=limit)break;}
if(rows.length<limit)console.warn(`警告：清洗后只有 ${rows.length} 个唯一词，少于目标 ${limit}`);

const workbook=new ExcelJS.Workbook(),sheet=workbook.addWorksheet('待翻译审核词表');
const headers=['中文','英文','学习方向','词性','音标/读音','释义','中文可接受答案','英文可接受答案','英文例句','例句翻译','章节','难度','词频排名','标签','来源','来源网址','许可协议','署名','审核状态'];
sheet.addRow(headers);
const source=String(args.source||path.basename(input));
const sourceUrl=String(args['source-url']||'');
const license=String(args.license||'REVIEW-REQUIRED');
const attribution=String(args.attribution||'');
rows.forEach((row,index)=>sheet.addRow(['',row.term,track,'','','','','','','','核心词表',Math.min(5,1+Math.floor(index/1000)),index+1,'核心；待翻译',source,sourceUrl,license,attribution,'needs-review']));
sheet.getRow(1).font={bold:true};sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:'A1',to:'S1'};
sheet.columns=[18,18,16,12,18,24,20,20,30,28,18,10,12,18,26,36,16,34,16].map(width=>({width}));
await fs.mkdir(path.dirname(output),{recursive:true});await workbook.xlsx.writeFile(output);
console.log(JSON.stringify({ok:true,output,count:rows.length,language:'en',track,source,license},null,2));
