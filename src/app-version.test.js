import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { createAppVersionHandler } from './app-version.js';

test('Android update metadata changes with front-end content and never advertises missing/foreign APKs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'quizforge-app-version-'));
  try {
    await fs.writeFile(path.join(root, 'index.html'), '<p>v1</p>');
    await fs.mkdir(path.join(root, 'android'));
    const app = express(); app.get('/api/app-version', await createAppVersionHandler(root));
    const first = await request(app).get('/api/app-version').expect(200).expect('Cache-Control', 'no-store');
    assert.match(first.body.webRevision, /^[a-f0-9]{64}$/);
    assert.equal(first.body.android, null);
    const metadata = { versionCode: 2, versionName: '1.1.0', apkPath: '/android/quizforge-1.1.apk' };
    const release = path.join(root, 'android-release.json');
    await fs.writeFile(release, JSON.stringify(metadata));
    assert.equal((await request(app).get('/api/app-version')).body.android, null);
    await fs.writeFile(path.join(root, metadata.apkPath), 'test-apk');
    assert.deepEqual((await request(app).get('/api/app-version')).body.android, metadata);
    assert.equal((await request(app).get('/api/app-version')).body.webRevision, first.body.webRevision);
    for (const apkPath of ['https://evil.test/update.apk', '/android/../private.apk', '/android/update.apk?redirect=x']) {
      await fs.writeFile(release, JSON.stringify({ ...metadata, apkPath }));
      assert.equal((await request(app).get('/api/app-version')).body.android, null);
    }
    await fs.writeFile(release, 'invalid json');
    assert.equal((await request(app).get('/api/app-version')).body.android, null);
    await fs.writeFile(path.join(root, 'index.html'), '<p>v2</p>');
    const newer = express(); newer.get('/api/app-version', await createAppVersionHandler(root));
    assert.notEqual((await request(newer).get('/api/app-version')).body.webRevision, first.body.webRevision);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
