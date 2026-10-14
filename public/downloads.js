const escape = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export async function copyDownloadLink(value) {
  if(navigator.clipboard&&window.isSecureContext){try{await navigator.clipboard.writeText(value);return;}catch{/* HTTP and restricted in-app browsers use the selection fallback. */}}
  const field=document.createElement('textarea');field.value=value;field.style.position='fixed';field.style.opacity='0';document.body.append(field);field.select();const ok=document.execCommand('copy');field.remove();if(!ok)throw Error('复制失败，请长按下载按钮复制链接');
}
export function showDownload(grant) {
  if(!/^\/downloads\/[a-f0-9]{64}$/.test(grant.url))throw Error('下载地址无效');
  document.querySelectorAll('.download-dialog').forEach(node=>{node.close();node.remove();});
  const url=new URL(grant.url,location.origin).href,node=document.createElement('dialog');node.className='dialog download-dialog';
  const wechat=/MicroMessenger/i.test(navigator.userAgent);
  node.innerHTML=`<div class="dialog-header"><h2>文件已就绪</h2><button type="button" class="icon-button" aria-label="关闭">×</button></div><div class="dialog-body"><p class="download-name">${escape(grant.name)}</p>${wechat?'<p class="notice">微信内无法下载时，复制链接到手机浏览器打开。</p>':''}<div class="download-actions"><a class="button" href="${escape(url)}" download="${escape(grant.name)}">下载文件</a><button type="button" class="secondary" data-copy-download>复制下载链接</button></div><p class="form-note">链接有效期 24 小时，可在数据管理中重新获取。</p><p role="status" data-download-status></p><a class="text-link" href="/data">查看数据管理</a></div>`;
  document.body.append(node);node.querySelector('.icon-button').onclick=()=>node.close();node.addEventListener('close',()=>node.remove());
  node.querySelector('[data-copy-download]').onclick=async()=>{const status=node.querySelector('[data-download-status]');try{await copyDownloadLink(url);status.textContent='链接已复制';}catch(e){status.textContent=e.message;}};
  node.querySelector('a[download]').onclick=()=>node.querySelector('[data-download-status]').textContent='已发起下载，请在浏览器中查看。';node.showModal();return node;
}
export async function downloadFile(url,name,options={}) {
  const headers=new Headers(options.headers||{});headers.set('x-session-token',sessionStorage.getItem('quizforge-session-token')||'');headers.set('x-download-mode','managed');headers.set('x-download-name',encodeURIComponent(name));
  const route=location.pathname;headers.set('x-data-category',route.startsWith('/flights')?'flights':route.startsWith('/ielts')?'ielts':route.startsWith('/english')?(new URLSearchParams(location.search).get('track')==='english'?'english':'postgraduate'):'banks');
  const response=await fetch(url,{...options,headers}),result=await response.json().catch(()=>({}));if(!response.ok)throw Error(result.error||'文件生成失败');return showDownload(result);
}
