// Web version information remains available before the native bridge is ready.
// Older App menus are adapted without moving their message-port-bound buttons.
export function mountProfile({app,esc,name,api,dialog,logout}) {
  const dataLink=document.querySelector('#accountDataLink');
  app.innerHTML=`<section class="profile-identity"><h1 class="sr-only">我的</h1><p>${esc(name)}</p></section>${dataLink?'<section class="card profile-section"><h2>资料管理</h2><div class="profile-links"><a href="/data">数据管理</a></div></section>':''}<section id="profileAppSection" class="card profile-section"><h2>应用设置</h2><div id="profileAppActions" class="profile-links"></div></section><button type="button" class="secondary profile-logout" id="profileLogout">退出登录</button>`;
  const logoutButton=app.querySelector('#profileLogout');
  logoutButton.onclick=logout||(()=>document.querySelector('#logoutButton')?.click());
  const slot=app.querySelector('#profileAppActions');
  let disposed=false,requestId=0;
  const openVersion=async action=>{
    if(disposed)return;
    const id=++requestId;
    const content=`${action==='about'?'<p><strong>雅思工坊</strong></p><p>词汇、听说读写、私人题库与语料积累。</p>':''}<div data-profile-version role="status" aria-live="polite">正在读取版本…</div>`;
    let panel;
    if(dialog)panel=dialog(action==='about'?'关于':'应用更新',content);
    else{
      app.querySelector('[data-profile-info]')?.remove();
      panel=document.createElement('section');panel.className='card profile-section';panel.dataset.profileInfo='';panel.innerHTML=content;slot.parentElement.after(panel);
    }
    const target=panel.querySelector('[data-profile-version]');
    const active=()=>!disposed&&id===requestId&&panel.isConnected;
    const read=async()=>{
      if(!active())return;
      target.textContent='正在读取版本…';
      try{
        const value=api?await api('/api/app-version',{cache:'no-store'}):await fetch('/api/app-version',{cache:'no-store'}).then(response=>{if(!response.ok)throw new Error();return response.json();});
        if(!active())return;
        const android=value?.android;
        const valid=android&&Number.isSafeInteger(android.versionCode)&&android.versionCode>0&&typeof android.versionName==='string'&&android.versionName.length<=40&&/^\/android\/[a-zA-Z0-9._-]+\.apk$/.test(android.apkPath);
        const revision=typeof value?.webRevision==='string'&&/^[a-f0-9]{64}$/.test(value.webRevision)?value.webRevision.slice(0,12):null;
        target.innerHTML=`${valid?`<p>安卓最新版本 <strong>${esc(android.versionName)}</strong></p><p><a class="button" href="/android/">下载安卓版</a></p>`:'<p>安卓安装包暂未发布。</p>'}${revision?`<p class="meta">网页版本 ${esc(revision)}</p>`:''}`;
      }catch{
        if(!active())return;
        target.innerHTML='<p class="error">暂时无法读取版本信息，请重试。</p><button type="button" class="secondary" data-profile-retry>重试</button>';
        target.querySelector('[data-profile-retry]').onclick=read;
      }
    };
    await read();
  };
  const sync=()=>{
    if(disposed||!slot.isConnected)return;
    const native=slot.querySelector('.native-app-actions');
    const sources=native?[]:[...document.querySelectorAll('#accountMenu [data-native-action]')].filter(b=>['update','server','about'].includes(b.dataset.nativeAction)||(b.dataset.nativeAction==='reload'&&b.dataset.available==='true'));
    for(const button of slot.querySelectorAll('[data-legacy-action]'))if(!sources.some(b=>b.dataset.nativeAction===button.dataset.legacyAction))button.remove();
    for(const source of sources){
      const action=source.dataset.nativeAction;
      let button=slot.querySelector(`[data-legacy-action="${action}"]`);
      if(!button){button=document.createElement('button');button.type='button';button.dataset.legacyAction=action;slot.append(button);}
      button.onclick=()=>source.click();
      const label=action==='reload'?'加载新内容':source.textContent;
      if(button.textContent!==label)button.textContent=label;
    }
    for(const [action,label] of [['update','应用更新'],['about','关于']]){
      const actual=native?.querySelector(`[data-native-action="${action}"]`)||slot.querySelector(`[data-legacy-action="${action}"]`);
      let fallback=slot.querySelector(`[data-web-action="${action}"]`);
      if(actual){fallback?.remove();continue;}
      if(!fallback){fallback=document.createElement('button');fallback.type='button';fallback.dataset.webAction=action;fallback.textContent=label;slot.append(fallback);}
    }
  };
  const click=event=>{
    const button=event.target.closest('[data-web-action]');
    if(button&&slot.contains(button))void openVersion(button.dataset.webAction);
  };
  slot.addEventListener('click',click);
  const observer=new MutationObserver(sync);observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-available']});sync();
  return ()=>{disposed=true;requestId++;observer.disconnect();slot.removeEventListener('click',click);logoutButton.onclick=null;slot.querySelectorAll('[data-legacy-action]').forEach(button=>button.onclick=null);};
}
