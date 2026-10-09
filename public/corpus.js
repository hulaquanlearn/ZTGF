export async function showCorpus({app,api,esc,heading,dialog,bindForm,json,toast}, category='reading') {
  const categories={reading:'阅读',listening:'听力',writing:'写作',speaking:'口语'};
  if(!categories[category])category='reading';
  app.innerHTML=heading('语料库','按主题整理表达，同一个主题下可以保存多条语料。','<button id="addCorpus">添加主题与语料</button>')+`<nav class="module-cards" aria-label="语料分类">${Object.entries(categories).map(([key,name])=>`<a class="module-card ${key===category?'active':''}" href="/corpus/${key}"><h3>${name}</h3></a>`).join('')}</nav><section class="card"><form id="corpusSearch" class="form-actions"><input name="q" aria-label="搜索语料" placeholder="搜索主题、内容或标签"><button class="secondary">搜索</button></form><div id="corpusRows"></div></section>`;
  const root=app.querySelector('#corpusRows');
  const field=(name,label,rows=3)=>`<label>${label}<textarea name="${name}" rows="${rows}"></textarea></label>`;
  async function edit(row={}) {
    const node=dialog(row.id?'编辑语料':row.title?`添加语料 · ${row.title}`:'添加主题与语料',`<form class="form-stack corpus-form"><div class="form-grid"><label>主题<input name="title" maxlength="200" placeholder="例如：心情、穿搭、旅行" required></label><label>分类<select name="category">${Object.entries(categories).map(([key,name])=>`<option value="${key}">${name}</option>`).join('')}</select></label></div>${field('content','语料内容',4)}${field('translation','中文释义',3)}${field('examples','场景例句',3)}<label>标签<input name="tags" maxlength="500" placeholder="例如：日常表达、情绪、口语"></label><p data-status aria-live="polite"></p><div class="form-actions"><button type="button" class="secondary" data-cancel>取消</button><button type="submit">保存语料</button></div></form>`);
    const form=node.querySelector('form');
    for(const name of ['title','category','content','translation','examples','tags'])form.elements[name].value=row[name]|| (name==='category'?category:'');
    form.elements.content.required=true;form.elements.content.maxLength=50000;
    form.elements.translation.maxLength=50000;form.elements.examples.maxLength=20000;
    node.querySelector('[data-cancel]').onclick=()=>node.close();
    bindForm(form,async fd=>{await api(`/api/corpus${row.id?'/'+row.id:''}`,{method:row.id?'PUT':'POST',...json({...Object.fromEntries(fd),updatedAt:row.updatedAt})});node.close();toast('语料已保存');await load();});
  }
  async function view(id) {
    const row=await api('/api/corpus/'+id);
    const node=dialog(row.title,`<p class="meta">${categories[row.category]}${row.tags?' · '+esc(row.tags):''}</p>${[['content','语料内容'],['translation','中文释义'],['examples','场景例句']].filter(([key])=>row[key]).map(([key,label])=>`<section><h3>${label}</h3><div class="corpus-text" ${key==='content'?'lang="en"':''}>${esc(row[key])}</div></section>`).join('')}<div class="form-actions"><button id="editViewedCorpus">编辑语料</button></div>`);
    node.querySelector('#editViewedCorpus').onclick=()=>{node.close();edit(row);};
  }
  async function load() {
    const q=String(new FormData(app.querySelector('#corpusSearch')).get('q')||'').trim().toLocaleLowerCase();
    const rows=await api(`/api/corpus?category=${category}`);
    const groups=new Map();
    for(const row of rows) {
      if(!groups.has(row.title))groups.set(row.title,[]);
      groups.get(row.title).push(row);
    }
    const topics=[...groups].filter(([title,items])=>!q||items.some(row=>[title,row.content,row.translation,row.examples,row.tags].join(' ').toLocaleLowerCase().includes(q)));
    root.innerHTML=topics.length?topics.map(([title,items],index)=>`<section class="corpus-topic"><div class="corpus-topic-heading"><div><h2>${esc(title)} <span class="badge">${items.length} 条语料</span></h2></div><button class="small secondary" data-add-topic="${index}">＋ 添加语料</button></div><div class="corpus-topic-items">${items.map((row,i)=>`<article class="bank-row corpus-entry"><div class="bank-info"><div class="corpus-entry-heading"><span class="corpus-entry-number">${i+1}</span><h3 lang="en">${esc(row.content.slice(0,140))}${row.content.length>140?'…':''}</h3></div>${row.translation?`<p class="corpus-preview">${esc(row.translation.slice(0,140))}${row.translation.length>140?'…':''}</p>`:''}${row.examples?`<p class="corpus-example">${esc(row.examples.slice(0,180))}${row.examples.length>180?'…':''}</p>`:''}${row.tags?`<p class="meta corpus-tags">${esc(row.tags)}</p>`:''}</div><div class="actions"><button class="small" data-view="${row.id}">查看</button><button class="small secondary" data-edit="${row.id}">编辑</button><button class="small ghost" data-delete="${row.id}">删除</button></div></article>`).join('')}</div></section>`).join(''):`<p class="meta corpus-empty">${q?'没有找到匹配的语料。':'暂无语料，点击“添加主题与语料”开始整理。'}</p>`;
    root.querySelectorAll('[data-add-topic]').forEach(button=>button.onclick=()=>edit({title:topics[Number(button.dataset.addTopic)][0],category}));
    root.querySelectorAll('[data-view]').forEach(button=>button.onclick=()=>view(button.dataset.view).catch(e=>toast(e.message,true)));
    root.querySelectorAll('[data-edit]').forEach(button=>button.onclick=()=>edit(rows.find(row=>row.id===button.dataset.edit)));
    root.querySelectorAll('[data-delete]').forEach(button=>button.onclick=async()=>{if(!confirm('删除这条语料？同主题下的其他语料会保留。'))return;try{await api('/api/corpus/'+button.dataset.delete,{method:'DELETE'});await load();}catch(e){toast(e.message,true);}});
  }
  app.querySelector('#addCorpus').onclick=()=>edit();
  app.querySelector('#corpusSearch').onsubmit=e=>{e.preventDefault();load().catch(error=>toast(error.message,true));};
  await load();
}
