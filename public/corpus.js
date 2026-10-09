export async function showCorpus({app,api,esc,heading,dialog,bindForm,json,toast}, category='reading') {
  const categories={reading:'阅读',listening:'听力',writing:'写作',speaking:'口语'};
  if(!categories[category])category='reading';
  app.innerHTML=heading('语料库','','<button id="addCorpus">添加语料</button>')+`<nav class="module-cards" aria-label="语料分类">${Object.entries(categories).map(([key,name])=>`<a class="module-card ${key===category?'active':''}" href="/corpus/${key}"><h3>${name}</h3></a>`).join('')}</nav><section class="card"><form id="corpusSearch" class="form-actions"><input name="q" aria-label="搜索语料" placeholder="搜索标题、内容或标签"><button class="secondary">搜索</button></form><div id="corpusRows"></div></section>`;
  const root=app.querySelector('#corpusRows');
  const field=(name,label,rows=3)=>`<label>${label}<textarea name="${name}" rows="${rows}"></textarea></label>`;
  async function edit(row={}) {
    const node=dialog(row.id?'编辑语料':'添加语料',`<form class="form-stack"><label>标题<input name="title" maxlength="200" required></label><label>分类<select name="category">${Object.entries(categories).map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select></label>${field('content','语料内容',8)}${field('translation','中文释义',5)}${field('examples','场景与例句',4)}<label>标签<input name="tags" placeholder="例如：教育、环境、常用表达"></label><label>来源<input name="source"></label>${field('notes','笔记')}<p data-status aria-live="polite"></p><div class="form-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="submit">保存</button></div></form>`);
    const form=node.querySelector('form');
    for(const name of ['title','category','content','translation','examples','tags','source','notes'])form.elements[name].value=row[name]|| (name==='category'?category:'');
    form.elements.content.required=true;form.elements.content.maxLength=50000;
    node.querySelector('[data-cancel]').onclick=()=>node.close();
    bindForm(form,async fd=>{await api(`/api/corpus${row.id?'/'+row.id:''}`,{method:row.id?'PUT':'POST',...json({...Object.fromEntries(fd),updatedAt:row.updatedAt})});node.close();toast('语料已保存');await load();});
  }
  async function view(id) {
    const row=await api('/api/corpus/'+id);
    const node=dialog(row.title,`<p class="meta">${categories[row.category]}${row.tags?' · '+esc(row.tags):''}</p>${[['content','语料内容'],['translation','中文释义'],['examples','场景与例句'],['source','来源'],['notes','笔记']].filter(([key])=>row[key]).map(([key,label])=>`<section><h3>${label}</h3><div class="corpus-text" ${key==='content'?'lang="en"':''}>${esc(row[key])}</div></section>`).join('')}<div class="form-actions"><button id="editViewedCorpus">编辑</button></div>`);
    node.querySelector('#editViewedCorpus').onclick=()=>{node.close();edit(row);};
  }
  async function load() {
    const q=new FormData(app.querySelector('#corpusSearch')).get('q');
    const rows=await api(`/api/corpus?category=${category}&q=${encodeURIComponent(q||'')}`);
    root.innerHTML=rows.length?rows.map(row=>`<article class="bank-row"><div class="bank-info"><h3>${esc(row.title)}</h3><p class="meta">${esc(row.tags||'')}</p><p class="corpus-preview">${esc(row.content.slice(0,140))}</p></div><div class="actions"><button class="small" data-view="${row.id}">查看</button><button class="small secondary" data-edit="${row.id}">编辑</button><button class="small ghost" data-delete="${row.id}">删除</button></div></article>`).join(''):'<p class="meta corpus-empty">暂无语料，点击“添加语料”整理自己的学习材料。</p>';
    root.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>view(button.dataset.view).catch(e=>toast(e.message,true)));
    root.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>edit(rows.find(row=>row.id===button.dataset.edit)));
    root.querySelectorAll('[data-delete]').forEach(button=>button.onclick=async()=>{if(!confirm('删除这条语料？'))return;try{await api('/api/corpus/'+button.dataset.delete,{method:'DELETE'});await load();}catch(e){toast(e.message,true);}});
  }
  app.querySelector('#addCorpus').onclick=()=>edit();
  app.querySelector('#corpusSearch').onsubmit=e=>{e.preventDefault();load().catch(error=>toast(error.message,true));};
  await load();
}
