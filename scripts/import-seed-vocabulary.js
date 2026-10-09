import 'dotenv/config';
import { seedVocabulary } from '../src/seed-vocabulary.js';
const {store}=await import('../src/db.js');
const result=store.addVocabulary(seedVocabulary);await store.flush();console.log(JSON.stringify({ok:true,total:seedVocabulary.length,added:result.added.length,duplicates:result.duplicates.length,storage:store.storageMode()}));process.exit(0);
