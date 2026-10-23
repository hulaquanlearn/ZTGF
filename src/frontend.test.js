import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const source = fs.readFileSync(new URL('../public/workspace.js',import.meta.url),'utf8');
test('前端列表事件必须使用多个节点选择器，避免页面启动被单节点 forEach 阻断',()=>{
  assert.doesNotMatch(source, /(?<!\$)\$\([^()\n]*\)\.forEach/);
  assert.doesNotMatch(source, /\$\$\([^()\n]*\)\.onclick/);
  assert.match(source, /trackOptions\("ielts"\)/);
  assert.match(source, /retryWrong/);
});
