import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bindPasswordVisibility } from '../public/password-visibility.js';

test('显示密码复选框默认关闭，切换不改变输入内容',()=>{
  const input={type:'password',value:'123456测试'},checkbox={checked:true};
  bindPasswordVisibility(input,checkbox);assert.equal(checkbox.checked,false);
  checkbox.checked=true;checkbox.onchange();assert.equal(input.type,'text');assert.equal(input.value,'123456测试');
  checkbox.checked=false;checkbox.onchange();assert.equal(input.type,'password');assert.equal(input.value,'123456测试');
  const source=fs.readFileSync(new URL('../public/workspace.js',import.meta.url),'utf8');
  assert.match(source,/id="password"[^>]*type="password"/);
  assert.match(source,/id="passwordToggle" type="checkbox"/);
});
