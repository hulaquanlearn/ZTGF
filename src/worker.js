import 'dotenv/config';
import os from 'node:os';
import { jobQueue } from './job-queue.js';
import { generateQuestions } from './ai.js';

const workerId=`${os.hostname()}:${process.pid}`,pollMs=Math.max(500,Number(process.env.WORKER_POLL_MS||1500));let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});
console.log(`QuizForge worker started: ${workerId}`);
while(!stopping){
  let job;try{job=await jobQueue.claim(workerId);if(!job){await delay(pollMs);continue;}if(job.jobType==='generate'){const options=job.input?.options||{},generated=await generateQuestions(job.sourceText||job.input?.sourceText||'',{count:Math.min(100,Math.max(1,Number(options.count||20))),difficulty:['easy','medium','hard'].includes(options.difficulty)?options.difficulty:'medium'});generated.questions=generated.questions.map(question=>({...question,reviewStatus:'needs-review',generatedBy:'openclaw'}));await jobQueue.complete(job.id,{title:options.title||generated.title||job.sourceName,track:options.track||'general',category:options.category||'',module:options.module||'general',difficulty:options.difficulty||'mixed',questions:generated.questions,incomplete:[],incompleteCount:0,extractedChars:(job.sourceText||job.input?.sourceText||'').length,sourceName:job.sourceName||job.input?.sourceName||'',mode:'generate'});}else throw new Error(`不支持的任务类型：${job.jobType}`);}catch(error){console.error('Worker job failed:',error);if(job?.id)await jobQueue.fail(job.id,error).catch(console.error);else await delay(pollMs);}
}
await jobQueue.close();console.log('QuizForge worker stopped');
function delay(ms){return new Promise(resolve=>setTimeout(resolve,ms));}
