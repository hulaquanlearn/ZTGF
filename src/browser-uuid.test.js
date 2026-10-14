import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createUuid } from '../public/browser-uuid.js';

test('browser UUID uses the native method with its Crypto receiver', () => {
  const api = { randomUUID() { assert.equal(this, api); return 'native-id'; } };
  assert.equal(createUuid(api), 'native-id');
});

test('HTTP browser without randomUUID produces an RFC 4122 version 4 UUID', () => {
  const api = { getRandomValues(bytes) {
    assert.equal(this, api);
    assert.ok(bytes instanceof Uint8Array);
    assert.equal(bytes.length, 16);
    bytes.fill(255);
    return bytes;
  } };
  assert.equal(createUuid(api), 'ffffffff-ffff-4fff-bfff-ffffffffffff');
});

test('HTTP fallback generates distinct IDs accepted by the draft ID format', () => {
  const api = { getRandomValues: webcrypto.getRandomValues.bind(webcrypto) };
  const ids = Array.from({ length: 1000 }, () => createUuid(api));
  ids.forEach(id => assert.match(id, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/));
  assert.equal(new Set(ids).size, ids.length);
});

test('browser without either Crypto method reports an actionable error', () => {
  assert.throws(() => createUuid({}), /新版浏览器/);
  assert.throws(() => createUuid(null), /新版浏览器/);
});
