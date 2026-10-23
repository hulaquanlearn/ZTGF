import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { JSDOM } from 'jsdom';

const script = fs.readFileSync(new URL('./app/src/main/assets/login-autofill.js', import.meta.url), 'utf8');
const credentials = { origin: 'https://study.example.com', username: '练习账号', password: 'synthetic-pass', force: false };
function fixture(url = credentials.origin, markup = '<form id="loginForm"><input name="username"><input name="password" type="password"><button>登录</button></form>') {
  const dom = new JSDOM(markup, { url, runScripts: 'outside-only' });
  return { dom, form: dom.window.document.querySelector('form'), fill: value => dom.window.eval(script.replace('__QUIZFORGE_AUTOFILL_CREDENTIALS__', () => JSON.stringify({ ...credentials, ...value }))) };
}

test('saved login fills only the known form, sends input events, and never submits or writes browser storage', () => {
  const view = fixture();
  try {
    let submissions = 0, inputEvents = 0;
    view.form.addEventListener('submit', () => submissions++);
    view.form.addEventListener('input', () => inputEvents++);
    assert.equal(view.fill(), true);
    assert.equal(view.form.elements.username.value, credentials.username);
    assert.equal(view.form.elements.password.value, credentials.password);
    assert.equal(inputEvents, 2); assert.equal(submissions, 0);
    assert.equal(view.dom.window.localStorage.length, 0); assert.equal(view.dom.window.sessionStorage.length, 0);
  } finally { view.dom.window.close(); }
});

test('autofill preserves typed credentials until the user explicitly saves replacement settings', () => {
  const view = fixture();
  try {
    view.form.elements.username.value = 'someone-else';
    assert.equal(view.fill(), false);
    assert.equal(view.form.elements.username.value, 'someone-else'); assert.equal(view.form.elements.password.value, '');
    view.form.elements.username.value = ''; view.form.elements.password.value = 'typing-in-progress';
    assert.equal(view.fill(), false); assert.equal(view.form.elements.password.value, 'typing-in-progress');
    assert.equal(view.fill({ force: true }), true); assert.equal(view.form.elements.password.value, credentials.password);
  } finally { view.dom.window.close(); }
});

test('another origin, HTTP downgrade, alternate port and unrelated form receive no saved password', () => {
  for (const origin of ['https://other.example.com', 'http://study.example.com', 'https://study.example.com:444']) {
    const view = fixture(origin);
    try { assert.equal(view.fill({ force: true }), false); assert.equal(view.form.elements.password.value, ''); }
    finally { view.dom.window.close(); }
  }
  const view = fixture(credentials.origin, '<form id="otherForm"><input name="username"><input name="password" type="password"></form>');
  try { assert.equal(view.fill(), false); assert.equal(view.form.elements.password.value, ''); }
  finally { view.dom.window.close(); }
});

test('JSON quoting preserves special characters as input values without creating executable markup', () => {
  const view = fixture();
  try {
    const password = 'test-only\"\\\n</script><img src=x onerror="window.pwned=true">';
    assert.equal(view.fill({ origin: 'https://study.example.com:443', password }), true);
    assert.equal(view.form.elements.password.value, password.replace(/[\r\n]/g, ''));
    assert.equal(view.dom.window.document.querySelector('img'), null);
    assert.equal(view.dom.window.pwned, undefined);
  } finally { view.dom.window.close(); }
});
