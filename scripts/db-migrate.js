import 'dotenv/config';
if(!process.env.DB_HOST||!process.env.DB_NAME||!process.env.DB_USER)throw new Error('请先在 .env 配置 DB_HOST、DB_NAME 和 DB_USER');
const {store}=await import('../src/db.js');
await store.flush();
console.log('数据库结构已就绪，存储模式：',store.storageMode());
process.exit(0);
