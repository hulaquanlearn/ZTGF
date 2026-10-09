import mysql from 'mysql2/promise';

const mysqlEnabled=Boolean(process.env.DB_HOST&&process.env.DB_NAME&&process.env.DB_USER);
const pool=mysqlEnabled?mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME,charset:'utf8mb4',connectionLimit:2,enableKeepAlive:true}):null;
const memory=[];

export async function writeAudit({actorRole='system',action,targetType=null,targetId=null,detail=null,ipAddress=null}){
  const createdAt=new Date().toISOString();if(!pool){memory.push({id:memory.length+1,actorRole,action,targetType,targetId,detail,ipAddress,createdAt});if(memory.length>1000)memory.shift();return;}
  await pool.execute('INSERT INTO audit_logs(actor_user_id,actor_role,action_code,target_type,target_id,detail_json,ip_address,created_at) VALUES(NULL,?,?,?,?,?,?,?)',[actorRole,action,targetType,targetId,detail?JSON.stringify(detail):null,ipAddress,createdAt]);
}

export async function listAudit(limit=200){
  if(!pool)return memory.slice(-limit).reverse();const [rows]=await pool.execute('SELECT id,actor_role,action_code,target_type,target_id,detail_json,ip_address,created_at FROM audit_logs ORDER BY id DESC LIMIT ?',[Math.min(1000,Math.max(1,Number(limit)||200))]);return rows.map(row=>({id:row.id,actorRole:row.actor_role,action:row.action_code,targetType:row.target_type,targetId:row.target_id,detail:typeof row.detail_json==='string'?JSON.parse(row.detail_json):row.detail_json,ipAddress:row.ip_address,createdAt:new Date(row.created_at).toISOString()}));
}
