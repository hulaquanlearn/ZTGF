import test from 'node:test';
import assert from 'node:assert/strict';
import { jobQueue } from './job-queue.js';

test('后台生成任务按用户隔离并经过 queued-running-review 状态',async()=>{
  const queued=await jobQueue.enqueueGeneration({ownerId:'user-a',ownerName:'甲',sourceName:'材料.md',sourceText:'这是一段足够用于出题的测试材料。'.repeat(10),options:{count:5,track:'postgraduate'}});
  assert.ok(queued.jobId);
  assert.equal(await jobQueue.get(queued.jobId,'user-b'),null);
  assert.equal((await jobQueue.get(queued.jobId,'user-a')).status,'queued');
  const claimed=await jobQueue.claim('test-worker');assert.equal(claimed.id,queued.jobId);assert.equal(claimed.status,'running');
  await jobQueue.complete(queued.jobId,{title:'测试题库',questions:[]});
  const completed=await jobQueue.get(queued.jobId,'user-a');assert.equal(completed.status,'review');assert.equal(completed.result.title,'测试题库');
});
