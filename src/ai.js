const openClawEnabled=()=>String(process.env.AI_PROVIDER||'').toLowerCase()==='openclaw'||(!process.env.AI_API_KEY&&Boolean(process.env.OPENCLAW_GATEWAY_TOKEN));
const baseUrl = () => (openClawEnabled()?`${(process.env.OPENCLAW_BASE_URL||'http://127.0.0.1:18789').replace(/\/$/,'')}/v1`:(process.env.AI_BASE_URL||'https://api.openai.com/v1')).replace(/\/$/, '');

async function chat(system, user) {
  const apiKey=process.env.AI_API_KEY||process.env.OPENCLAW_GATEWAY_TOKEN;
  if (!apiKey) {
    if (process.env.ALLOW_DEMO_AI === '1') return null;
    throw new Error('服务器尚未配置 AI_API_KEY');
  }
  const endpoint=baseUrl();
  if(openClawEnabled()&&!/^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\/v1$/i.test(endpoint)&&process.env.ALLOW_REMOTE_OPENCLAW!=='1')throw new Error('OpenClaw 出题入口必须使用服务器回环地址');
  const response = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: process.env.AI_MODEL || (openClawEnabled()?process.env.OPENCLAW_QUESTION_AGENT||'openclaw/quizforge-question':'gpt-4.1-mini'), temperature: 0.2, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
    signal: AbortSignal.timeout(Number(process.env.AI_TIMEOUT_MS||120000))
  });
  if (!response.ok) throw new Error(`AI 服务请求失败 (${response.status}): ${(await response.text()).slice(0, 300)}`);
  const data = await response.json();
  return JSON.parse(data.choices?.[0]?.message?.content || '{}');
}

export async function generateQuestions(source, options) {
  const maxChars = Number(process.env.MAX_SOURCE_CHARS || 60000);
  const text = source.slice(0, maxChars);
  const result = await chat(
    '你是严谨的中文出题专家。只能依据材料出题，不得引入材料外事实。材料可能夹有水印、页眉、页脚、页码、版权标记和 OCR 噪声，必须忽略这些干扰内容，绝不能把它们当知识点。输出合法 JSON，不要 Markdown。',
    `依据以下材料生成待人工审核的练习题。要求：共 ${options.count} 题，难度 ${options.difficulty}；题型比例尽量包含单选(choice)、多选(multiple)、判断(boolean)、简答(short)。每题字段：type,question,options(非选择题为空数组),answer(选择题为选项下标数组，判断题为布尔值，简答题为参考答案),explanation,rubric,points,sourceLocator(支持答案的材料短语或段落位置)。总分建议100。返回 {"title":"...","questions":[...]}。\n\n材料：\n${text}`
  );
  if (!result) return demoQuestions(text, options.count);
  validateQuestions(result.questions);
  return result;
}

function demoQuestions(text, count) {
  const excerpt = text.replace(/[#*_>`]/g, '').slice(0, 80) || '该材料';
  return { title: '演示题库', questions: Array.from({ length: count }, (_, i) => ({ type: i % 2 ? 'boolean' : 'short', question: i % 2 ? `判断：材料包含“${excerpt.slice(0, 12)}”相关内容。` : `请概括材料的一个核心要点（题目 ${i + 1}）。`, options: [], answer: i % 2 ? true : excerpt, explanation: '依据上传材料判断。', rubric: '表达与材料核心意思一致即可。', points: 100 / count })) };
}

function validateQuestions(questions) {
  if (!Array.isArray(questions) || !questions.length) throw new Error('AI 未返回有效题目');
  for (const q of questions) if (!['choice', 'multiple', 'boolean', 'short'].includes(q.type) || !q.question || !Number(q.points)) throw new Error('AI 返回的题目结构无效');
}
