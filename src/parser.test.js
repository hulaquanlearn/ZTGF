import test from 'node:test';
import assert from 'node:assert/strict';
import { parseExistingQuestions } from './parser.js';
import { cleanDocumentText } from './extract.js';

test('解析截图式判断题及答案', () => {
  const input = `101.（ ）水中含钙镁盐过多，会引起酒沉淀。\n正确\n102.（ ）场地是大曲微生物的主要来源。\n错误`;
  const result = parseExistingQuestions(input);
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].answer, true);
  assert.equal(result.questions[1].answer, false);
  assert.equal(result.incomplete.length, 0);
});

test('过滤重复水印但保留答案', () => {
  const text = `内部资料\n101.（ ）题目甲。\n正确\n内部资料\n102.（ ）题目乙。\n错误\n内部资料\n103.（ ）题目丙。\n正确`;
  const cleaned = cleanDocumentText(text);
  assert.equal(cleaned.includes('内部资料'), false);
  assert.equal(parseExistingQuestions(cleaned).questions.length, 3);
});

test('保留重复参考答案并按选项结构推断低题号单选题', () => {
  const text = `题库标题
1、第一道选择题
A、甲
B、乙
C、丙
参考答案：A
2、第二道选择题
A、甲
B、乙
C、丙
参考答案：A
3、第三道选择题
A、甲
B、乙
C、丙
参考答案：A`;
  const cleaned = cleanDocumentText(text);
  const result = parseExistingQuestions(cleaned);
  assert.equal((cleaned.match(/参考答案：A/g) || []).length, 3);
  assert.equal(result.questions.length, 3);
  assert.equal(result.incomplete.length, 0);
  assert.ok(result.questions.every(question => question.type === 'choice'));
  assert.ok(result.questions.every(question => question.answer[0] === 0));
});

test('解析紧连选项、多选连接词和被断行的小数', () => {
  const input = `1、紧连选项测试 A.甲 B.乙 C.丙 D.丁
参考答案：B和C
2、数值选项测试
A、-2000元，
1、15
B、-1000元，0.85
参考答案：A`;
  const result = parseExistingQuestions(input);
  assert.equal(result.questions.length, 2);
  assert.equal(result.incomplete.length, 0);
  assert.deepEqual(result.questions[0].answer, [1, 2]);
  assert.equal(result.questions[0].type, 'multiple');
  assert.equal(result.questions[1].options[0], '-2000元，1.15');
});

test('文档分段标题不会污染上一道题', () => {
  const input = `1、第一题
A、甲
B、乙
参考答案：A
系统集成模拟试题及答案.doc
1、第二题
A、丙
B、丁
正确答案：B`;
  const result = parseExistingQuestions(input);
  assert.equal(result.questions.length, 2);
  assert.equal(result.questions[0].question, '第一题');
  assert.equal(result.questions[1].question, '第二题');
});

test('兼容题号单独一行且答案位于题干前', () => {
  const result = parseExistingQuestions('82.\n错误《安全生产法》只适用于某类单位。');
  assert.equal(result.questions.length, 1);
  assert.equal(result.questions[0].answer, false);
  assert.equal(result.questions[0].question, '《安全生产法》只适用于某类单位。');
});

test('解析单选和多选题及标准答案', () => {
  const input = `201.测试单选（ ）\nA.甲\nB.乙\nC.丙\nB\n351.测试多选（ ）\nA.甲\nB.乙\nC.丙\nAC`;
  const result = parseExistingQuestions(input);
  assert.equal(result.questions.length, 2);
  assert.deepEqual(result.questions[0].answer, [1]);
  assert.deepEqual(result.questions[1].answer, [0, 2]);
});

test('缺少标准答案的判断题记入 incomplete', () => {
  const input = `101.（ ）这是一道没有答案的判断题。\n102.（ ）这道有答案。\n正确`;
  const result = parseExistingQuestions(input);
  assert.equal(result.questions.length, 1);
  assert.equal(result.incomplete.length, 1);
  assert.equal(result.incomplete[0].number, 101);
  assert.equal(result.incomplete[0].reason, '缺少标准答案');
  assert.equal(result.incomplete[0].type, 'boolean');
});

test('缺少选项和答案的选择题记入 incomplete', () => {
  const input = `201.只有题干没有选项的单选题（ ）\nA.选项甲\n202.正常单选题（ ）\nA.甲\nB.乙\nA`;
  const result = parseExistingQuestions(input);
  assert.equal(result.questions.length, 1);
  assert.equal(result.incomplete.length, 1);
  assert.equal(result.incomplete[0].number, 201);
  assert.equal(result.incomplete[0].reason, '缺少选项（不足2个）');
  assert.deepEqual(result.incomplete[0].options, ['选项甲']);
});

test('有选项但缺答案的选择题记入 incomplete', () => {
  const input = `201.缺答案的单选题（ ）\nA.甲\nB.乙\nC.丙\n202.正常单选题（ ）\nA.甲\nB.乙\nA`;
  const result = parseExistingQuestions(input);
  assert.equal(result.questions.length, 1);
  assert.equal(result.incomplete.length, 1);
  assert.equal(result.incomplete[0].number, 201);
  assert.equal(result.incomplete[0].reason, '缺少标准答案');
  assert.equal(result.incomplete[0].options.length, 3);
});

test('解析含多个标准答案的填空题',()=>{
  const input='二、填空题\n1.主要微生物是（酵母菌），温度为（28～32）℃。';
  const result=parseExistingQuestions(input);
  assert.equal(result.questions.length,1);
  assert.equal(result.questions[0].type,'fill');
  assert.deepEqual(result.questions[0].answer,[['酵母菌'],['28～32']]);
});
