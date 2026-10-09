import crypto from 'node:crypto';
import mysql from 'mysql2/promise';

const mysqlEnabled=Boolean(process.env.DB_HOST&&process.env.DB_NAME&&process.env.DB_USER);
const pool=mysqlEnabled?mysql.createPool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT||3306),user:process.env.DB_USER,password:process.env.DB_PASSWORD||'',database:process.env.DB_NAME,charset:'utf8mb4',connectionLimit:Math.max(2,Number(process.env.DB_POOL_SIZE||10)),enableKeepAlive:true}):null;
const memoryJobs=new Map();
const parse=value=>{if(value==null)return null;if(typeof value==='object')return value;try{return JSON.parse(value);}catch{return null;}};

export const jobQueue={
  async list(ownerId=null,allowAll=false){
    if(!pool)return [...memoryJobs.values()].filter(row=>allowAll||row.ownerId===ownerId).map(row=>structuredClone(row)).reverse();
    const [rows]=await pool.execute(`SELECT j.*,d.original_name FROM processing_jobs j LEFT JOIN source_documents d ON d.id=j.document_id ${allowAll?'':'WHERE j.owner_id=?'} ORDER BY j.created_at DESC LIMIT 200`,allowAll?[]:[ownerId]);return rows.map(publicJob);
  },
  async enqueueGeneration({ownerId,ownerName,sourceName,sourceText,byteSize=0,mimeType='',options={}}){
    const documentId=crypto.randomUUID(),jobId=crypto.randomUUID(),now=new Date();
    if(!pool){memoryJobs.set(jobId,{id:jobId,ownerId,ownerName,documentId,jobType:'generate',status:'queued',progress:0,input:{sourceName,sourceText,options},createdAt:now.toISOString(),updatedAt:now.toISOString()});return {jobId,documentId};}
    const connection=await pool.getConnection();try{await connection.beginTransaction();await connection.execute(`INSERT INTO source_documents(id,owner_id,original_name,mime_type,byte_size,source_type,status,extracted_text,metadata_json,created_at,updated_at) VALUES(?,?,?,?,?,'upload','processing',?,?,?,?)`,[documentId,ownerId,sourceName,mimeType||null,byteSize,sourceText,JSON.stringify({ownerName}),now,now]);await connection.execute(`INSERT INTO processing_jobs(id,owner_id,document_id,job_type,status,progress,input_json,attempts,available_at,created_at,updated_at) VALUES(?,?,?,'generate','queued',0,?,0,?,?,?)`,[jobId,ownerId,documentId,JSON.stringify({sourceName,options}),now,now,now]);await connection.commit();return {jobId,documentId};}catch(error){await connection.rollback();throw error;}finally{connection.release();}
  },
  async get(id,ownerId=null,allowAll=false){
    if(!pool){const row=memoryJobs.get(id);return row&&(allowAll||row.ownerId===ownerId)?structuredClone(row):null;}
    const [rows]=await pool.execute(`SELECT j.*,d.original_name,d.extracted_text FROM processing_jobs j LEFT JOIN source_documents d ON d.id=j.document_id WHERE j.id=? ${allowAll?'':'AND j.owner_id=?'}`,[id,...(allowAll?[]:[ownerId])]);return rows[0]?publicJob(rows[0]):null;
  },
  async claim(workerId){
    if(!pool){const row=[...memoryJobs.values()].find(item=>item.status==='queued');if(!row)return null;row.status='running';row.progress=5;row.lockedBy=workerId;row.updatedAt=new Date().toISOString();return structuredClone(row);}
    const connection=await pool.getConnection();try{await connection.beginTransaction();const [rows]=await connection.query(`SELECT j.*,d.original_name,d.extracted_text FROM processing_jobs j JOIN source_documents d ON d.id=j.document_id WHERE j.status='queued' AND j.available_at<=NOW(3) AND (j.locked_at IS NULL OR j.locked_at<DATE_SUB(NOW(3),INTERVAL 10 MINUTE)) ORDER BY j.created_at LIMIT 1 FOR UPDATE SKIP LOCKED`);if(!rows[0]){await connection.commit();return null;}await connection.execute(`UPDATE processing_jobs SET status='running',progress=5,locked_at=NOW(3),locked_by=?,attempts=attempts+1,updated_at=NOW(3) WHERE id=?`,[workerId,rows[0].id]);await connection.commit();return publicJob({...rows[0],status:'running',progress:5,locked_by:workerId});}catch(error){await connection.rollback();throw error;}finally{connection.release();}
  },
  async complete(id,result){
    if(!pool){const row=memoryJobs.get(id);if(row){row.status='review';row.progress=100;row.result=result;row.updatedAt=new Date().toISOString();}return;}
    await pool.execute(`UPDATE processing_jobs j JOIN source_documents d ON d.id=j.document_id SET j.status='review',j.progress=100,j.result_json=?,j.error_text=NULL,j.locked_at=NULL,j.locked_by=NULL,j.updated_at=NOW(3),d.status='review',d.updated_at=NOW(3) WHERE j.id=?`,[JSON.stringify(result),id]);
  },
  async fail(id,error){
    const message=String(error?.message||error||'处理失败').slice(0,4000);if(!pool){const row=memoryJobs.get(id);if(row){row.status='failed';row.error=message;row.updatedAt=new Date().toISOString();}return;}
    await pool.execute(`UPDATE processing_jobs j JOIN source_documents d ON d.id=j.document_id SET j.status='failed',j.error_text=?,j.locked_at=NULL,j.locked_by=NULL,j.updated_at=NOW(3),d.status='failed',d.updated_at=NOW(3) WHERE j.id=?`,[message,id]);
  },
  async deleteOwnerData(ownerId){
    if(!pool){
      let jobs=0;const documents=new Set();
      for(const [id,row] of memoryJobs)if(row.ownerId===ownerId){jobs++;if(row.documentId)documents.add(row.documentId);memoryJobs.delete(id);}
      return {jobs,documents:documents.size};
    }
    const connection=await pool.getConnection();
    try{
      await connection.beginTransaction();
      const [jobs]=await connection.execute(`DELETE j FROM processing_jobs j LEFT JOIN source_documents d ON d.id=j.document_id WHERE j.owner_id=? OR d.owner_id=?`,[ownerId,ownerId]);
      const [documents]=await connection.execute('DELETE FROM source_documents WHERE owner_id=?',[ownerId]);
      await connection.commit();
      return {jobs:Number(jobs.affectedRows||0),documents:Number(documents.affectedRows||0)};
    }catch(error){await connection.rollback();throw error;}finally{connection.release();}
  },
  async close(){if(pool)await pool.end();}
};

function publicJob(row){return {id:row.id,ownerId:row.owner_id,documentId:row.document_id,jobType:row.job_type,status:row.status,progress:Number(row.progress||0),input:parse(row.input_json)||row.input||{},result:parse(row.result_json)||row.result||null,error:row.error_text||row.error||null,sourceName:row.original_name||row.input?.sourceName||'',sourceText:row.extracted_text||row.input?.sourceText||'',createdAt:row.created_at?new Date(row.created_at).toISOString():row.createdAt,updatedAt:row.updated_at?new Date(row.updated_at).toISOString():row.updatedAt};}
