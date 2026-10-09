import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bindPasswordVisibility } from '../public/password-visibility.js';

test('显示隐藏密码保持原输入，按钮不提交表单，默认隐藏',()=>{
  const input={type:'password',value:'123456测试'},attrs={};
  const button={textContent:'显示',setAttribute:(key,value)=>attrs[key]=value};
  bindPasswordVisibility(input,button);
  button.onclick();assert.equal(input.type,'text');assert.equal(input.value,'123456测试');assert.equal(button.textContent,'隐藏');assert.equal(attrs['aria-pressed'],'true');
  button.onclick();assert.equal(input.type,'password');assert.equal(input.value,'123456测试');assert.equal(button.textContent,'显示');assert.equal(attrs['aria-pressed'],'false');
  const source=fs.readFileSync(new URL('../public/workspace.js',import.meta.url),'utf8');
  assert.match(source,/id="password"[^>]*type="password"/);
  assert.match(source,/id="passwordToggle" type="button"/);
});
