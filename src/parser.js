const ANSWER_PREFIX = '(?:答案|参考答案|正确答案)';
const ANSWER_WORDS = new RegExp(`^(?:${ANSWER_PREFIX}[：:]?\\s*)?(正确|错误|对|错|√|×)$`);
const ANSWER_LETTERS = '[A-FＡ-Ｆ](?:[A-FＡ-Ｆ]|\\s*(?:和|及|与|、|,|，|/|&)\\s*[A-FＡ-Ｆ]){0,5}';
const FULL_ANSWER_LINE = new RegExp(`^(?:${ANSWER_PREFIX}[：:]\\s*)?(${ANSWER_LETTERS})$`, 'i');

const OPTION_LETTER = '[A-FＡ-Ｆ]';

// 分节标题检测：如"二、判断题"、"三、单项选择题"、"四、多项选择题"
const SECTION_HEADER = {
  boolean: /^[一二三四五六七八九十]+[、.．]\s*(?:判断题|是非题|对错题)/,
  choice: /^[一二三四五六七八九十]+[、.．]\s*(?:填空题)?(?:单项选择题|单选题|选择题)/,
  multiple: /^[一二三四五六七八九十]+[、.．]\s*(?:填空题)?(?:多项选择题|多选题)/,
  fill: /^[一二三四五六七八九十]+[、.．]\s*填空题(?!单项|多项)/,
  short: /^[一二三四五六七八九十]+[、.．]\s*(?:简答题|问答题|论述题|名词解释|计算题|案例分析)/
};

// 内嵌答案检测：题干中括号内包含答案标记，如"（ B ）"、"（×）"、"（ CD ）"
// 答案可能在题干末尾"称之为（ B ）"，也可能在中间"可生成（ C ）酒精。"
// 多个括号各含单个字母时是填空题（如"单位是（D），糖化力是（A），液化力是（B）"）
// 单个括号含多个字母时是多选题答案（如"（ ACD ）"）
function extractInlineAnswer(questionText) {
  // 先检测判断题（√×）
  const boolMatch = questionText.match(/[（(]\s*([√×])\s*[）)]/);
  if (boolMatch) {
    const isTrue = boolMatch[1] === '√';
    return { type: 'boolean', answer: isTrue, cleanQuestion: questionText.replace(/[（(]\s*[√×]\s*[）)]\s*/g, '').trim() };
  }
  // 收集所有括号内的字母组合
  const letterMatches = [...questionText.matchAll(new RegExp('[（(]\\s*(' + OPTION_LETTER + '{1,6})\\s*[）)]', 'g'))];
  if (letterMatches.length) {
    const groups = letterMatches.map(m => normalizeLetters(m[1]));
    // 多个括号各含单个字母 → 填空题，每个括号是一个空的答案
    if (groups.length >= 2 && groups.every(g => g.length === 1)) {
      const cleanQuestion = questionText.replace(new RegExp('[（(]\\s*' + OPTION_LETTER + '{1,6}\\s*[）)]\\s*', 'g'), '（  ）').trim();
      return { type: 'fill-letters', letters: groups.join(''), groups, cleanQuestion };
    }
    // 合并所有字母去重 → 选择题答案
    const allLetters = groups.join('');
    const uniqueLetters = [...new Set(allLetters.split(''))].join('');
    const cleanQuestion = questionText.replace(new RegExp('[（(]\\s*' + OPTION_LETTER + '{1,6}\\s*[）)]\\s*', 'g'), '（  ）').trim();
    return { type: 'choice-letters', letters: uniqueLetters, cleanQuestion };
  }
  return null;
}

export function parseExistingQuestions(text) {
  const lines = normalizeExtractedLines(text.split(/\n+/).map(x => x.trim()).filter(Boolean));
  const questions = [];
  const incomplete = [];

  // 当前题型上下文（由分节标题决定）
  let currentType = null;

  for (let i = 0; i < lines.length; i++) {
    if (isDocumentBoundary(lines[i])) { currentType = null; continue; }
    // 检测分节标题，切换题型
    if (SECTION_HEADER.boolean.test(lines[i])) { currentType = 'boolean'; continue; }
    if (SECTION_HEADER.choice.test(lines[i])) { currentType = 'choice'; continue; }
    if (SECTION_HEADER.multiple.test(lines[i])) { currentType = 'multiple'; continue; }
    if (SECTION_HEADER.fill.test(lines[i])) { currentType = 'fill'; continue; }
    if (SECTION_HEADER.short.test(lines[i])) { currentType = 'short'; continue; }

    const numberOnly = lines[i].match(/^(\d{1,5})[.、．]$/);
    if (numberOnly && lines[i + 1]) {
      const prefixed = lines[i + 1].match(/^(正确|错误|对|错|√|×)\s*(.+)$/);
      if (prefixed) {
        questions.push({ type: 'boolean', question: prefixed[2], options: [], answer: ['正确', '对', '√'].includes(prefixed[1]), explanation: '', rubric: '', points: 1 });
        i += 1;
        continue;
      }
    }
    const match = lines[i].match(/^(\d{1,5})[.、．]\s*(?:[（(]\s*[）)]\s*)?(.+)$/);
    if (!match) continue;
    const number = Number(match[1]);
    const questionText = match[2];

    // 尝试提取内嵌答案（如"（×）"、"（ B ）"、"（ CD ）"）
    const inline = extractInlineAnswer(questionText);
    const cleanQuestion = inline ? inline.cleanQuestion : questionText;

    // 确定题型优先级：分节标题 > 内嵌答案的题型 > 题号区间
    // 填空题区段内有括号答案时仍是填空题（如"单位是（D），糖化力是（A）"）
    let type = currentType;
    if (inline) {
      if (inline.type === 'boolean') type = 'boolean';
      else if (inline.type === 'fill-letters') type = 'short';
      else if (inline.type === 'choice-letters') {
        // 填空题区段不因括号字母而变为选择题
        if (currentType === 'short') type = 'short';
        else if (currentType === 'fill') type = 'fill';
        // 单个答案字母 → 单选题；多个答案字母 → 多选题（不因区段而改变）
        else type = inline.letters.length > 1 ? 'multiple' : 'choice';
      }
    }
    if (!type) {
      if (number >= 201 && number <= 350) type = 'choice';
      else if (number >= 351) type = 'multiple';
      else type = 'boolean';
    }

    // 收集后续行（直到下一个题号或分节标题）
    const block = [];
    let j = i + 1;
    while (j < lines.length && !/^\d{1,5}[.、．]/.test(lines[j]) && !isSectionHeader(lines[j]) && !isDocumentBoundary(lines[j])) {
      block.push(lines[j]);
      i = j;
      j++;
    }

    // 题号并不能可靠代表题型。很多独立题库会在每个章节从 1 重新编号，
    // 因此无分节标题时应优先根据 A/B/C/D 选项和答案字母判断为选择题。
    if (!currentType && !inline) {
      const structuralType = inferChoiceType(block);
      if (structuralType) type = structuralType;
    }

    if (type === 'fill') {
      const parsed = parseFillBlock(number, cleanQuestion, block);
      if (parsed.valid) questions.push(parsed.question);
      else incomplete.push(parsed.incomplete);
      continue;
    }

    // 简答题：文件必须提供独立标准答案
    if (type === 'short') {
      const answerLine = block.find(x => /^(?:答案|参考答案|正确答案)[：:]/.test(x));
      const answer = answerLine?.replace(/^(?:答案|参考答案|正确答案)[：:]\s*/, '').trim();
      const body = block.filter(x => x !== answerLine).join(' ').trim();
      const fullQuestion = `${cleanQuestion}${body ? ` ${body}` : ''}`.replace(/\s+/g,' ').trim();
      if (answer) questions.push({ type:'short',question:fullQuestion,options:[],answer:[answer],explanation:'',rubric:'',points:2 });
      else incomplete.push({ number,question:fullQuestion,type:'short',reason:'缺少标准答案',options:[],answer:'' });
      continue;
    }

    if (type === 'boolean') {
      let answer = null;
      let fullQuestion = cleanQuestion;
      if (inline && inline.type === 'boolean') {
        answer = inline.answer;
        fullQuestion = inline.cleanQuestion;
      }
      // 如果题干没有内嵌答案，检查block行中是否有答案（可能被跨页拆分）
      if (answer === null) {
        for (const line of block) {
          // 纯答案行："正确"、"错误"、"√"、"×"
          const answerMatch = line.match(ANSWER_WORDS);
          if (answerMatch) { answer = ['正确', '对', '√'].includes(answerMatch[1]); break; }
          // 行内含括号答案："最低。 （×）" 或 "（√）"
          const inlineInBlock = extractInlineAnswer(line);
          if (inlineInBlock && inlineInBlock.type === 'boolean') {
            answer = inlineInBlock.answer;
            // 把去掉答案后的文本拼回题干
            const lineText = inlineInBlock.cleanQuestion;
            if (lineText) fullQuestion += ' ' + lineText;
            break;
          }
          // 把block行拼回题干（可能是跨页的题干延续）
          if (!answer) fullQuestion += ' ' + line;
        }
      }
      if (answer !== null) {
        fullQuestion = fullQuestion.replace(/\s+/g, ' ').trim();
        questions.push({ type: 'boolean', question: fullQuestion, options: [], answer, explanation: '', rubric: '', points: 1 });
      } else {
        fullQuestion = fullQuestion.replace(/\s+/g, ' ').trim();
        incomplete.push({ number, question: fullQuestion, type: 'boolean', reason: '缺少标准答案', options: [], answer: '' });
      }
    } else {
      const parsed = parseChoiceBlock(cleanQuestion, block, type, inline);
      if (parsed.valid) questions.push(parsed.question);
      else incomplete.push({ number, question: parsed.question || cleanQuestion, type: parsed.question?.type || type, reason: parsed.reason, options: parsed.options || [], answer: parsed.answerLetters || '' });
    }
  }
  if (questions.length || incomplete.length) return { questions: normalizePoints(questions), incomplete };
  return { questions: [], incomplete: [] };
}

function isSectionHeader(line) {
  return SECTION_HEADER.boolean.test(line) || SECTION_HEADER.choice.test(line) || SECTION_HEADER.multiple.test(line) || SECTION_HEADER.fill.test(line) || SECTION_HEADER.short.test(line);
}

function isDocumentBoundary(line) {
  return /(?:试题|题库|模拟题|答案).*\.docx?$/i.test(line) || /^(?:总题量|题量|数量)[：:]?\s*\d+/i.test(line);
}

function normalizeExtractedLines(sourceLines) {
  const merged = [];
  for (const line of sourceLines) {
    const decimal = line.match(/^([01])[、.．](\d{1,3})$/);
    const previous = merged[merged.length - 1] || '';
    if (decimal && /^[A-FＡ-Ｆ][.．、：:].*[，,]\s*$/.test(previous)) {
      merged[merged.length - 1] = `${previous}${decimal[1]}.${decimal[2]}`;
      continue;
    }
    merged.push(line);
  }
  return merged.flatMap(splitDenseOptionLine);
}

function splitDenseOptionLine(line) {
  const re = /([A-FＡ-Ｆ])[.．、：:](?=\s*\S)/g;
  const starts = [];
  let match;
  while ((match = re.exec(line)) !== null) starts.push(match.index);
  if (starts.length < 2) return [line];
  const parts = [];
  const prefix = line.slice(0, starts[0]).trim();
  if (prefix) parts.push(prefix);
  for (let index = 0; index < starts.length; index++) {
    const part = line.slice(starts[index], starts[index + 1] ?? line.length).trim();
    if (part) parts.push(part);
  }
  return parts;
}

function parseFillBlock(number, question, block) {
  const inlineAnswers = [];
  let blankNumber = 0;
  let clean = question.replace(/[（(]\s*([^（）()]{1,80}?)\s*[）)]/g, (full, value) => {
    const answer = value.trim();
    if (!answer || /^[＿_\s]+$/.test(answer)) return full;
    inlineAnswers.push([answer]); blankNumber++;
    return `（${blankNumber}）`;
  });
  const answerLine = block.find(x => /^(?:答案|参考答案|正确答案)[：:]/.test(x));
  let answers = inlineAnswers;
  if (!answers.length && answerLine) answers = answerLine.replace(/^(?:答案|参考答案|正确答案)[：:]\s*/,'').split(/[；;|]/).map(x=>[x.trim()]).filter(x=>x[0]);
  const continuation = block.filter(x=>x!==answerLine).join(' ').trim();
  if (continuation) clean += ` ${continuation}`;
  const placeholderCount = (clean.match(/[（(]\s*(?:\d+)?\s*[）)]|_{2,}|＿{2,}/g)||[]).length;
  if (!answers.length) return { valid:false,incomplete:{ number,question:clean,type:'fill',reason:'缺少标准答案',options:[],blanks:[],answer:'' } };
  if (placeholderCount && placeholderCount !== answers.length) return { valid:false,incomplete:{ number,question:clean,type:'fill',reason:`空格数量(${placeholderCount})与答案数量(${answers.length})不一致`,options:[],blanks:answers.map(x=>({answers:x})),answer:answers } };
  return { valid:true,question:{ type:'fill',question:clean,options:[],blanks:answers.map(x=>({answers:x})),answer:answers,explanation:'',rubric:'',points:2 } };
}

function parseChoiceBlock(question, block, type, inline) {
  const options = [];
  let answerLetters = '';
  const questionParts = [question];

  // 如果内嵌答案已提取到字母，直接使用
  if (inline && inline.type === 'choice-letters') {
    answerLetters = inline.letters;
  }

  // 预处理：合并被 PDF 拆行的选项片段
  // 如 "D：gCO" + "2" + "/(g干曲.72h)" 需合并为 "D：gCO2/(g干曲.72h)"
  const mergedBlock = [];
  for (let k = 0; k < block.length; k++) {
    const raw = block[k];
    const isOptionStart = new RegExp('^' + OPTION_LETTER + '[.．、：:]').test(raw);
    const prevIsOption = mergedBlock.length > 0 && new RegExp('^' + OPTION_LETTER + '[.．、：:]').test(mergedBlock[mergedBlock.length - 1]);
    // 如果当前行不是选项开头，但上一行是选项开头或选项续行，且当前行不像答案/题号，则拼到上一行
    const isAnswerStandalone = FULL_ANSWER_LINE.test(raw.trim());
    const looksLikeContinuation = !isOptionStart && !isAnswerStandalone && prevIsOption && !/^\d{1,5}[.、．]/.test(raw);
    if (looksLikeContinuation && mergedBlock.length > 0) {
      mergedBlock[mergedBlock.length - 1] += raw.trim();
    } else {
      mergedBlock.push(raw);
    }
  }

  for (const raw of mergedBlock) {
    const normalized = normalizeLetters(raw);
    // 纯答案行：单独的大写字母（1~6个），如 "A" 或 "ABC"
    if (/^[A-F]{1,6}$/.test(normalized)) { answerLetters = normalized; continue; }
    // 带"答案："前缀的行
    const answerLine = raw.match(new RegExp(`^${ANSWER_PREFIX}[：:]\\s*(${ANSWER_LETTERS})$`, 'i'));
    if (answerLine) { answerLetters = normalizeLetters(answerLine[1]); continue; }

    // 检查是否为选项行（以字母+标点开头）
    const isOptionStart = new RegExp('^' + OPTION_LETTER + '[.．、：:]\\s*\\S').test(raw);

    // 非选项行：可能是跨页的题干续行，检查内嵌答案
    if (!isOptionStart) {
      if (!answerLetters) {
        const inlineInBlock = extractInlineAnswer(raw);
        if (inlineInBlock && (inlineInBlock.type === 'choice-letters' || inlineInBlock.type === 'fill-letters')) {
          answerLetters = inlineInBlock.letters;
          const remainText = inlineInBlock.cleanQuestion;
          if (remainText) questionParts.push(remainText);
          continue;
        }
      }
      // 没有内嵌答案的续行，拼回题干
      if (raw.trim()) questionParts.push(raw.trim());
      continue;
    }

    // 单行多选项检测：支持 "A.甲    B.乙"、"A：甲    B：乙"、"A、甲    B、乙"
    // 也支持单空格分隔的 "A、甲 B、乙 C、丙"
    // 策略：先找到所有 [字母+标点] 的位置作为分隔点，再提取每段文本
    const optionStarts = [];
    const startRe = new RegExp(OPTION_LETTER + '[.．、：:]', 'g');
    let sm;
    while ((sm = startRe.exec(raw)) !== null) {
      // 确保是选项开头：前面是空格或行首
      const pos = sm.index;
      if (pos === 0 || /\s/.test(raw[pos - 1])) {
        optionStarts.push(pos);
      }
    }
    let inlineOptions = null;
    if (optionStarts.length >= 2) {
      inlineOptions = [];
      for (let si = 0; si < optionStarts.length; si++) {
        const start = optionStarts[si];
        const end = si + 1 < optionStarts.length ? optionStarts[si + 1] : raw.length;
        inlineOptions.push(raw.substring(start, end));
      }
    }
    if (!inlineOptions || inlineOptions.length < 2) {
      inlineOptions = raw.match(new RegExp('(' + OPTION_LETTER + ')[.．、：:]\\s*(.+?)(?=\\s{2,}' + OPTION_LETTER + '[.．、：:]|\\t+' + OPTION_LETTER + '[.．、：:]|$)', 'g'));
    }
    if (!inlineOptions || inlineOptions.length < 2) {
      inlineOptions = raw.match(new RegExp('(' + OPTION_LETTER + ')[.．、：:]\\s*(.+?)(?=\\s+' + OPTION_LETTER + '[.．、：:]|$)', 'g'));
    }
    if (inlineOptions && inlineOptions.length >= 2) {
      for (const optStr of inlineOptions) {
        const m = optStr.match(new RegExp('^(' + OPTION_LETTER + ')[.．、：:]\\s*(.+)$'));
        if (m) {
          const letter = normalizeLetters(m[1]);
          let text = m[2].trim();
          // 检查选项文本中是否嵌入了下一个选项，如 "香味前驱物质 E、营养成分"
          const embedded = text.match(new RegExp('^(.*?\\S)\\s+(' + OPTION_LETTER + ')[.．、：:]\\s*(.+)$'));
          if (embedded && !options.find(o => o.letter === normalizeLetters(embedded[2]))) {
            const embLetter = normalizeLetters(embedded[2]);
            const embText = embedded[3].trim();
            text = embedded[1].trim();
            if (text) options.push({ letter, text });
            if (embText && !/^[.．、：:]+$/.test(embText)) options.push({ letter: embLetter, text: embText });
          } else {
            if (text) options.push({ letter, text });
          }
        }
      }
      continue;
    }

    // 单选项行 "A.选项内容"、"A：选项内容"、"A、选项内容"
    const option = raw.match(new RegExp('^(' + OPTION_LETTER + ')[.．、：:]\\s*(.*)$'));
    if (!option) {
      if (raw.trim()) questionParts.push(raw.trim());
      continue;
    }
    const letter = normalizeLetters(option[1]);
    let text = option[2].trim();
    // 检查选项内容末尾是否附带了答案字母，如 "选项内容ABC"
    const attached = text.match(/^(.*?[\u3400-\u9fff）)%。])([A-FＡ-Ｆ]{1,6})$/);
    if (attached) {
      text = attached[1]; answerLetters = normalizeLetters(attached[2]);
    }
    // 处理选项文本中嵌入了下一个选项的字母开头，如 "香味前驱物质 E、营养成分"
    // 需要拆分出 E 选项
    const embeddedNext = text.match(new RegExp('^(.*?\\S)\\s+(' + OPTION_LETTER + ')[.．、：:]\\s*(.+)$'));
    if (embeddedNext) {
      const nextLetter = normalizeLetters(embeddedNext[2]);
      const nextText = embeddedNext[3].trim();
      // 只有当 nextText 有内容且不是另一个选项的引用时才拆分
      if (nextText && !options.find(o => o.letter === nextLetter)) {
        text = embeddedNext[1].trim();
        // 处理选项末尾被换行打断后拼接的残留，如 "E、" → 清理标点
        options.push({ letter, text });
        if (!/^[.．、：:]+$/.test(nextText)) {
          options.push({ letter: nextLetter, text: nextText });
        }
        continue;
      }
    }
    // 处理选项末尾被换行打断后拼接的残留，如 "E、" → 清理标点
    if (text && /^[.．、：:]+$/.test(text)) {
      text = '';
    }
    options.push({ letter, text });
  }

  const fullQuestion = questionParts.join(' ').replace(/\s+/g, ' ').trim();
  const optionTexts = options.map(x => x.text);

  if (options.length < 2) return { valid: false, question: fullQuestion, options: optionTexts, reason: '缺少选项（不足2个）', answerLetters };

  if (!answerLetters) return { valid: false, question: fullQuestion, options: optionTexts, reason: '缺少标准答案', answerLetters: '' };

  const unique = [...new Set(answerLetters.split(''))];
  const answer = unique.map(letter => options.findIndex(x => x.letter === letter)).filter(index => index >= 0);

  if (!answer.length) return { valid: false, question: fullQuestion, options: optionTexts, reason: '答案字母与选项不匹配', answerLetters };

  // 多选题区段中只有1个答案的 → 降级为单选题
  const finalType = (type === 'multiple' && answer.length === 1) ? 'choice' : type;
  return { valid: true, question: { type: finalType, question: fullQuestion, options: optionTexts, answer, explanation: '', rubric: '', points: finalType === 'multiple' ? 2 : 1 } };
}

function inferChoiceType(block) {
  let optionCount = 0;
  let answerLetters = '';
  const optionStart = new RegExp('^' + OPTION_LETTER + '[.．、：:]\\s*\\S');
  for (const line of block) {
    if (optionStart.test(line)) optionCount++;
    const answer = line.match(FULL_ANSWER_LINE);
    if (answer) answerLetters = normalizeLetters(answer[1]);
  }
  if (optionCount < 2) return null;
  return answerLetters.length > 1 ? 'multiple' : 'choice';
}

function normalizeLetters(value) {
  return value.trim().toUpperCase().replace(/[Ａ-Ｆ]/g, x => String.fromCharCode(x.charCodeAt(0) - 0xFEE0)).replace(/[和及与、,，/&\s]/g, '');
}

function normalizePoints(questions) {
  const each = 100 / questions.length;
  return questions.map(q => ({ ...q, points: each }));
}
