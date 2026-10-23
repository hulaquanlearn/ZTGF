import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'quiz-display-name-'));
Object.assign(process.env,{DATA_DIR:path.join(temp,'data'),UPLOAD_DIR:path.join(temp,'uploads'),DB_HOST:'',DB_NAME:'',DB_USER:'',APP_PASSWORD:'',ADMIN_PASSWORD:'',AUTO_SEED_VOCABULARY:'0'});
const {store}=await import('./db.js');
const candidate=store.createCandidate('Login_Name','123456').candidate;
candidate.displayName='显示名称甲';
const {app}=await import('./server.js');
after(async()=>{await store.flush();fs.rmSync(temp,{recursive:true,force:true});});
test('independent display name is returned by login and account APIs without changing login or password verification',async()=>{
 const login=await request(app).post('/api/account/login').send({username:'login_name',password:'123456'});
 assert.equal(login.status,200);assert.equal(login.body.name,'显示名称甲');assert.equal(login.body.username,'Login_Name');
 const me=await request(app).get('/api/account/me').set('x-session-token',login.body.token);
 assert.equal(me.body.name,'显示名称甲');assert.equal(me.body.username,'Login_Name');assert.equal(me.body.id,candidate.id);
 assert.equal((await request(app).post('/api/account/login').send({username:'显示名称甲',password:'123456'})).status,401);
 const changed=await request(app).post('/api/account/password').set('x-session-token',login.body.token).send({currentPassword:'123456',newPassword:'abcdef'});
 assert.equal(changed.status,200);assert.equal(store.authenticateCandidate('Login_Name','abcdef').ok,true);
 assert.equal(store.getSession(changed.body.token).name,'显示名称甲');
 const listed=store.listCandidates().find(c=>c.id===candidate.id);assert.equal(listed.name,'显示名称甲');assert.equal(listed.username,'Login_Name');
});
test('legacy users with no display name still return their login name',async()=>{
 store.createCandidate('legacy','123456');
 const response=await request(app).post('/api/account/login').send({username:'legacy',password:'123456'});
 assert.equal(response.status,200);assert.equal(response.body.name,'legacy');
});
