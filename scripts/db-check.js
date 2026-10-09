import 'dotenv/config';
const {store}=await import('../src/db.js');
if(store.storageMode()!=='mysql')throw new Error('当前没有连接 MySQL');
console.log(JSON.stringify({ok:true,storage:store.storageMode(),quizzes:store.listQuizzes().length,vocabulary:store.listVocabulary().length}));
process.exit(0);
