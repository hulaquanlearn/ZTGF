// Local, interactive phone-sized preview. Does not alter production desktop layout.
import express from 'express';
import path from 'node:path';
import {parseArgs} from 'node:util';

const {values}=parseArgs({options:{public:{type:'string',default:'public'},fallback:{type:'string',multiple:true,default:[]},api:{type:'string',default:'http://127.0.0.1:3093'},port:{type:'string',default:'3094'}}});
const target=new URL(values.api);
if(!['127.0.0.1','localhost'].includes(target.hostname)||target.protocol!=='http:')throw new Error('Preview APIs must use an isolated local server');
const app=express();
app.use((req,res,next)=>{res.set('Cache-Control','no-store');next();});
app.get('/__app-preview',(req,res)=>res.type('html').send(`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>雅思工坊 · 手机预览</title><style>
*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;background:#edf0e7;font-family:system-ui,sans-serif}body{display:grid;place-items:center;padding:18px}.phone{width:min(414px,100%);height:min(862px,calc(100dvh - 36px));border:5px solid #fffdf8;border-radius:28px;overflow:hidden;background:#f7f8f2;box-shadow:0 18px 60px #294d3e1a}iframe{display:block;width:100%;height:100%;border:0}@media(max-width:460px){body{padding:0}.phone{width:100%;height:100dvh;border:0;border-radius:0;box-shadow:none}}
</style></head><body><div class="phone"><iframe title="雅思工坊手机预览"></iframe></div><script>
const requested=new URLSearchParams(location.search).get('path')||'/';const route=new URL(requested,location.origin);document.querySelector('iframe').src=route.origin===location.origin&&!route.pathname.startsWith('/__app-preview')?route.pathname+route.search:'/';
</script></body></html>`));
app.use('/api',express.raw({type:()=>true,limit:'25mb'}),async(req,res)=>{
  try{
    const response=await fetch(new URL(req.originalUrl,target),{method:req.method,headers:{'Content-Type':req.get('Content-Type')||'application/json',...(req.get('x-session-token')?{'x-session-token':req.get('x-session-token')}:{})},...(['GET','HEAD'].includes(req.method)?{}:{body:req.body})});
    res.status(response.status);for(const name of ['Content-Type','Content-Disposition'])if(response.headers.has(name))res.set(name,response.headers.get(name));
    res.send(Buffer.from(await response.arrayBuffer()));
  }catch{res.status(502).json({error:'隔离预览服务暂不可用'});}
});
for(const root of [values.public,...values.fallback])app.use(express.static(path.resolve(root)));
app.get('*',(req,res)=>res.sendFile(path.resolve(values.public,'index.html')));
app.listen(Number(values.port),'127.0.0.1',()=>console.log('Interactive App preview: http://127.0.0.1:'+values.port+'/__app-preview'));
