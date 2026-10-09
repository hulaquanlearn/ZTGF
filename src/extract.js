import fs from 'node:fs/promises';
import path from 'node:path';
import mammoth from 'mammoth';
import pdf from 'pdf-parse';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import WordExtractor from 'word-extractor';

const execFileAsync = promisify(execFile);

export async function extractText(file) {
  const ext = path.extname(file.originalname).toLowerCase();
  const buffer = await fs.readFile(file.path);
  if (ext === '.pdf') return cleanDocumentText((await pdf(buffer)).text);
  if (ext === '.doc') return extractLegacyDoc(file.path);
  // mammoth只读取正文语义内容，Word页眉中的艺术字/背景水印通常不会混入。
  if (ext === '.docx') return cleanDocumentText((await mammoth.extractRawText({ buffer })).value);
  if (ext === '.md' || ext === '.markdown' || ext === '.txt') return cleanDocumentText(buffer.toString('utf8'));
  throw new Error('仅支持 PDF、DOC、DOCX、MD 和 TXT 文件');
}

async function extractLegacyDoc(inputPath) {
  try {
    const document = await new WordExtractor().extract(inputPath);
    const text = cleanDocumentText(document.getBody());
    if (text.length >= 50) return text;
  } catch {
    // 少数加密或特殊 DOC 交给 LibreOffice 备用转换。
  }
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'quizforge-doc-'));
  const source = path.join(workDir, 'source.doc');
  const executable = process.env.LIBREOFFICE_PATH || (process.platform === 'win32' ? 'soffice.exe' : 'libreoffice');
  try {
    await fs.copyFile(inputPath, source);
    await execFileAsync(executable, ['--headless', '--convert-to', 'docx', '--outdir', workDir, source], { timeout: 120000, windowsHide: true });
    const buffer = await fs.readFile(path.join(workDir, 'source.docx'));
    return cleanDocumentText((await mammoth.extractRawText({ buffer })).value);
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('该 DOC 无法由纯 Node 解析，且服务器未安装备用转换组件 LibreOffice；请将文件另存为 DOCX 后重试');
    throw new Error(`DOC 转换失败：${error.message}`);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}

function normalize(text) {
  return text.replace(/\u0000/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export function cleanDocumentText(text) {
  const normalized = normalize(text);
  const lines = normalized.split('\n').map(x => x.trim()).filter(Boolean);
  const counts = new Map();
  for (const line of lines) counts.set(line, (counts.get(line) || 0) + 1);
  const optionRe = /^([A-FＡ-Ｆ])[.．、：:]\s*\S/;
  return lines.filter((line, idx) => {
    // 答案在整份题库中经常重复，不能按“高频短行”当成页眉或水印删除。
    // 同时兼容“答案：A”“参考答案：A”“正确答案：A”及判断题答案。
    const isAnswerLine = /^(?:(?:答案|参考答案|正确答案)[：:]?\s*)?(?:正确|错误|对|错|√|×|[A-FＡ-Ｆ]{1,6})$/i.test(line);
    const isOptionLine = optionRe.test(line);
    const repeatedNoise = line.length <= 40 && (counts.get(line) || 0) >= 3 && !isAnswerLine && !isOptionLine;
    // 页码：纯数字、"第N页"、"N/10"、"- N -"
    // 但纯数字如果前后行是选项行或选项续行，可能是被拆行的下标（如 gCO₂ 的 2），不删
    const isPureNumber = /^\d{1,4}$/.test(line);
    const prevLine = idx > 0 ? lines[idx - 1] : '';
    const nextLine = idx < lines.length - 1 ? lines[idx + 1] : '';
    const prevIsOption = optionRe.test(prevLine) || /gCO$/.test(prevLine) || /[A-Za-z]$/.test(prevLine);
    const nextIsContinuation = /^\//.test(nextLine) || /^[（(]/.test(nextLine);
    const isFragment = isPureNumber && (prevIsOption || nextIsContinuation);
    const pageNumber = !isFragment && (/^(第\s*)?\d{1,4}\s*(页|\/\s*\d+)?$/.test(line) || /^-\s*\d{1,4}\s*-$/.test(line));
    const isolatedWatermark = line.length >= 2 && line.length <= 12 && !isAnswerLine && !isOptionLine && !/[，。！？：；,.!?;:（）()\d]/.test(line) && (counts.get(line) || 0) >= 2;
    return !repeatedNoise && !pageNumber && !isolatedWatermark;
  }).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
