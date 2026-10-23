export function mountQuery({app,api,esc,dialog,bindWordActions,json,initialQuery='',initialDirection}){
  let direction=initialDirection||(/[\u3400-\u9fff]/.test(initialQuery)?'zh-en':'en-zh');
  if(!['en-zh','zh-en'].includes(direction))direction='en-zh';
  app.innerHTML=`<section class="query-workspace" aria-label="查询与翻译"><form class="query-form"><div class="query-directions" role="group" aria-label="翻译方向"><button type="button" data-direction="en-zh">英译中</button><button type="button" data-direction="zh-en">中译英</button></div><div class="query-input-row"><input name="q" type="search" aria-label="查询内容" autocomplete="off" maxlength="120" required><button type="submit" aria-label="查询"><img src="/icons/search.svg" alt=""></button></div></form><div class="query-text-translation"><a href="/english/translate">文本翻译</a></div><p class="query-status" data-query-status role="status"></p><div data-query-results></div></section>`;
  const root=app.querySelector('.query-workspace'),form=root.querySelector('.query-form'),input=form.elements.q,status=root.querySelector('[data-query-status]'),results=root.querySelector('[data-query-results]');
  const labels={content:'原文',translation:'译文',examples:'例句',notes:'笔记',source:'来源'};
  let generation=0,disposed=false,context=null,history=[],reference=null,chatBusy=false;
  const alive=id=>!disposed&&root.isConnected&&generation===id;
  const post=(path,body)=>api('/api/lookup'+path,{method:'POST',...json(body)});
  function selectDirection(value){
    direction=value;
    root.querySelectorAll('[data-direction]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.direction===direction)));
    input.placeholder=direction==='en-zh'?'输入英文单词、短语或句子':'输入中文词语或表达';
  }
  function clearResults(){generation++;context=null;history=[];reference=null;chatBusy=false;results.innerHTML='';status.textContent='';}
  root.querySelectorAll('[data-direction]').forEach(button=>button.onclick=()=>{if(button.dataset.direction!==direction){clearResults();selectDirection(button.dataset.direction);input.focus();}});
  selectDirection(direction);input.value=initialQuery;
  const wordHtml=w=>`<article class="query-word"><div class="query-word-heading"><h2 lang="en">${esc(w.en||'')}</h2><span class="query-source">词库</span><button type="button" class="query-audio" data-speak="${esc(w.en||'')}" aria-label="朗读 ${esc(w.en||'')}"><img src="/icons/volume.svg" alt=""></button></div>${w.pronunciation?`<p class="query-phonetic">${esc(w.pronunciation)}</p>`:''}<p class="query-meaning">${w.partOfSpeech?`<span>${esc(w.partOfSpeech)}</span> `:''}${esc(w.zh||'')}</p>${w.exampleEn?`<div class="query-example"><p lang="en">${esc(w.exampleEn)}</p><p>${esc(w.exampleZh||'')}</p></div>`:''}${w.id?`<button type="button" class="query-text-action" data-collect="${esc(w.id)}">收藏到词库</button>`:''}</article>`;
  const explanationHtml=e=>`<article class="query-word query-generated"><div class="query-word-heading"><h2 lang="en">${esc(e.term||context.q)}</h2><span class="query-source">AI 生成</span></div>${e.pronunciation?`<p class="query-phonetic">${esc(e.pronunciation)}</p>`:''}<p class="query-meaning">${e.partOfSpeech?`<span>${esc(e.partOfSpeech)}</span> `:''}${esc(e.translation||e.meaning)}</p>${e.meaning&&e.meaning!==e.translation?`<p>${esc(e.meaning)}</p>`:''}${e.usage?`<section class="query-usage"><h3>用法</h3><p>${esc(e.usage)}</p></section>`:''}${e.exampleEn?`<div class="query-example"><span>例句</span><p lang="en">${esc(e.exampleEn)}</p><p>${esc(e.exampleZh||'')}</p></div>`:''}</article>`;
  function bindCorpus(rows,id){
    results.querySelectorAll('[data-open-corpus]').forEach(button=>button.onclick=async()=>{
      try{
        const row=await api('/api/corpus/'+encodeURIComponent(button.dataset.openCorpus));if(!alive(id))return;
        dialog(row.title,Object.entries(labels).filter(([field])=>row[field]).map(([field,label])=>`<section class="query-corpus-detail"><h3>${label}</h3><p>${esc(row[field])}</p></section>`).join('')+`<a class="button secondary" href="/corpus/${encodeURIComponent(row.category)}">进入语料库</a>`);
      }catch(error){if(alive(id))status.textContent=error.message;}
    });
    results.querySelectorAll('[data-reference]').forEach(button=>button.onclick=()=>{
      if(chatBusy)return;
      const selected=rows.find(row=>row.id===button.dataset.reference);if(!selected)return;
      reference=selected;history=[];
      const transcript=results.querySelector('[data-chat-transcript]');transcript.innerHTML='';
      const line=results.querySelector('[data-chat-reference]');
      line.innerHTML=`<span>引用：${esc(selected.title)}</span><button type="button" aria-label="取消引用">×</button>`;
      line.hidden=false;
      line.querySelector('button').onclick=()=>{if(chatBusy)return;reference=null;history=[];transcript.innerHTML='';line.hidden=true;};
      results.querySelector('[name=message]').focus();results.querySelector('.query-chat').scrollIntoView({block:'nearest',behavior:'smooth'});
    });
  }
  function bindChat(id,available){
    const chat=results.querySelector('.query-chat'),chatForm=chat.querySelector('form'),message=chatForm.elements.message,chatStatus=chat.querySelector('[data-chat-status]'),transcript=chat.querySelector('[data-chat-transcript]'),send=chatForm.querySelector('[type=submit]');
    if(!available){chatStatus.textContent='AI追问暂不可用';message.disabled=true;send.disabled=true;return;}
    chat.querySelectorAll('[data-suggestion]').forEach(button=>button.onclick=()=>{message.value=button.dataset.suggestion;message.focus();});
    chatForm.onsubmit=async event=>{
      event.preventDefault();const question=message.value.trim();if(!question||chatBusy||!alive(id))return;
      chatBusy=true;send.disabled=true;message.disabled=true;chatStatus.textContent='正在回答…';
      const questionNode=document.createElement('div');questionNode.className='query-message query-message-user';questionNode.textContent=question;transcript.append(questionNode);
      const referenceId=reference?.id;
      let bounded=history.slice(-8);while(bounded.reduce((sum,item)=>sum+item.content.length,0)>10000)bounded=bounded.slice(2);
      try{
        const answer=await post('/chat',{q:context.q,direction:context.direction,message:question,history:bounded,...(referenceId?{referenceId}:{})});if(!alive(id))return;
        const responseNode=document.createElement('div');responseNode.className='query-message query-message-ai';responseNode.innerHTML=`<span class="query-source">AI 回答</span><p>${esc(answer.answer)}</p>`;transcript.append(responseNode);
        history=[...bounded,{role:'user',content:question},{role:'assistant',content:answer.answer}];message.value='';chatStatus.textContent='';
      }catch(error){if(alive(id)){questionNode.remove();chatStatus.textContent=error.message;}}
      finally{if(alive(id)){chatBusy=false;send.disabled=false;message.disabled=false;}}
    };
  }
  async function search(){
    const q=input.value.trim();if(!q)return;
    clearResults();const id=generation;context={q,direction};status.textContent='正在查询…';
    try{
      const local=await post('',context);if(!alive(id))return;
      const words=local.words||[],corpus=local.corpus||[];
      results.innerHTML=`<div data-ai-result></div>${words.length?`<section class="query-saved-words" aria-label="词库内容">${words.map(wordHtml).join('')}</section>`:''}${corpus.length?`<section class="query-corpus-section"><h3>我的语料 <span>${local.corpusTotal||corpus.length}</span></h3>${corpus.map(row=>`<article class="query-corpus lookup-corpus"><div class="query-corpus-heading"><h4>${esc(row.title)}</h4><span class="query-source">${esc({reading:'阅读',listening:'听力',writing:'写作',speaking:'口语'}[row.category]||'语料')}</span></div>${Object.entries(labels).filter(([field])=>row[field]).map(([field,label])=>`<p class="query-corpus-${field}">${field==='notes'||field==='source'?`<span>${label}：</span>`:''}${esc(row[field])}</p>`).join('')}<div class="query-corpus-actions"><button type="button" data-open-corpus="${esc(row.id)}">查看完整语料</button><button type="button" data-reference="${esc(row.id)}">引用并问 AI</button></div></article>`).join('')}</section>`:''}<section class="query-chat"><h3>继续问 AI</h3><div data-chat-reference class="query-reference" hidden></div><div data-chat-transcript class="query-transcript" aria-live="polite"></div><div class="query-suggestions"><button type="button" data-suggestion="这个表达在口语中怎么用？">口语用法</button><button type="button" data-suggestion="请给我两个不同场景的例句。">更多例句</button></div><form class="query-chat-form"><label class="sr-only" for="queryFollowup">追问内容</label><textarea id="queryFollowup" name="message" rows="2" maxlength="1200" placeholder="问用法、辨析，或针对语料继续问…" required></textarea><button type="submit">发送</button></form><p data-chat-status class="query-status" role="status"></p></section>`;
      status.textContent='';bindWordActions(words);bindCorpus(corpus,id);bindChat(id,local.aiAvailable);
      const ai=results.querySelector('[data-ai-result]');
      if(local.hasExact)return;
      if(!local.aiAvailable){ai.innerHTML=`<p class="query-status">${words.length||corpus.length?'在线解释暂不可用，已找到的内容如下。':'未找到已保存内容，在线解释暂不可用。'}</p>`;return;}
      ai.innerHTML='<p class="query-status" role="status">正在补充解释…</p>';
      try{
        const result=await post('/explain',context);if(!alive(id))return;
        ai.innerHTML=result.explanation?explanationHtml(result.explanation):'';
      }catch(error){if(alive(id))ai.innerHTML=`<p class="query-status" role="status">${esc(error.message)}</p>`;}
    }catch(error){if(alive(id))status.textContent=error.message;}
  }
  form.onsubmit=event=>{event.preventDefault();search();};
  if(initialQuery)search();
  return ()=>{disposed=true;generation++;};
}
