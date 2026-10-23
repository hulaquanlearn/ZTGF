(function (config) {
  // The port is transferred only to this exact top-level origin. No JavaScript interface.
  if (window.top !== window || location.origin !== new URL(config.origin).origin) return false;
  window.quizforgeAppControlsCleanup?.();
  let port = null, pending = null, activeForm = null, remembered = config.remember, lastSession = null;
  let state = {appUpdate:false,pageUpdate:false};
  const bound = new WeakSet(), detach = [];
  const widgets = new Set();
  const labels = {reload:'加载新内容',update:'应用更新',server:'服务器地址',about:'关于 App'};
  const style = document.createElement('style');
  style.textContent = `.native-app-actions{display:flex;flex-direction:column;gap:3px;border-top:1px solid #e0e6dc;margin-top:12px;padding-top:8px}.native-app-actions>button{justify-content:flex-start;width:100%;min-height:44px;margin:0;padding:9px 12px;border:0;border-radius:8px;background:transparent;color:#2b3e31;font-size:13px;font-weight:500;text-align:left}.native-app-actions>button:hover{background:#edf3e9}.native-app-actions>button[data-available=true]{color:#176b57;font-weight:650}.account-dropdown{max-height:calc(100dvh - 90px);overflow:auto}`;
  const send = value => { if (port) port.postMessage(JSON.stringify(value)); };
  const actionList = actions => {
    const container = document.createElement('div'); container.className = 'native-app-actions';
    for (const action of actions) {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.nativeAction = action;
      button.textContent = labels[action]; container.append(button);
    }
    return container;
  };
  const mountActions = () => {
    if (!port) return;
    for (const widget of widgets) if (!widget.isConnected) widgets.delete(widget);
    if (!style.isConnected) document.head.append(style);
    const authenticated = Boolean(sessionStorage.getItem('quizforge-session-token')) && !document.querySelector('#loginForm');
    if (authenticated !== lastSession) { lastSession = authenticated; send({action:'session',signedIn:authenticated}); }
    const profile = document.querySelector('#profileAppActions');
    if (profile) document.querySelectorAll('#accountMenu .native-app-actions').forEach(actions => actions.remove());
    const account = profile || document.querySelector('#accountMenu .account-dropdown');
    if (account) {
      let actions = account.querySelector('.native-app-actions');
      if (!authenticated) { actions?.remove(); }
      else if (!actions) {
        actions = actionList(['update','server','about']);
        account.append(actions); widgets.add(actions);
      }
      if (actions && authenticated) {
        let reload = actions.querySelector('[data-native-action="reload"]');
        if (state.pageUpdate && !reload) { reload = actionList(['reload']).firstElementChild; actions.append(reload); }
        if (!state.pageUpdate) reload?.remove();
      }
      if (profile) document.querySelector('#profileAppSection')?.removeAttribute('hidden');
    }
    for (const button of document.querySelectorAll('[data-native-action]')) {
      const action = button.dataset.nativeAction;
      const available = action === 'update' ? state.appUpdate : action === 'reload' ? state.pageUpdate : false;
      const text = labels[action] + (available && action === 'update' ? ' · 有新版本' : '');
      if (button.textContent !== text) button.textContent = text;
      button.dataset.available = String(available);
    }
  };
  const update = () => {
    mountActions();
    const form = document.querySelector('#loginForm');
    if (activeForm !== form) { pending = null; activeForm = form; }
    if (!form || bound.has(form)) return;
    const option = form.querySelector('#rememberPasswordOption');
    const remember = form.querySelector('#rememberPassword');
    if (!option || !remember || !port) return;
    option.hidden = false; remember.checked = remembered; bound.add(form);
    const choose = () => {
      remembered = remember.checked;
      if (!remembered) { pending = null; send({action:'forget'}); }
    };
    const submit = () => {
      // Read these fields only for this user-requested login and explicit save choice.
      pending = remember.checked ? { username:form.elements.username.value, password:form.elements.password.value, form } : null;
    };
    remember.addEventListener('change', choose);
    form.addEventListener('submit', submit, true);
    detach.push(() => { remember.removeEventListener('change', choose); form.removeEventListener('submit', submit, true); });
  };
  const connect = event => {
    if (event.data !== config.nonce || !event.ports?.[0] || port) return;
    port = event.ports[0];
    port.onmessage = event => {
      try { const value = JSON.parse(event.data); if (value.type === 'state') { state = {appUpdate:value.appUpdate === true,pageUpdate:value.pageUpdate === true}; update(); } } catch {}
    };
    port.start(); window.removeEventListener('message', connect); update();
  };
  const success = () => {
    const value = pending; pending = null;
    if (!value || value.form !== document.querySelector('#loginForm') || !remembered || !sessionStorage.getItem('quizforge-session-token')) return;
    send({action:'save',username:value.username,password:value.password});
  };
  const changed = event => {
    remembered = event.detail === true;
    const input = document.querySelector('#rememberPassword');
    if (input) input.checked = remembered;
    if (!remembered) pending = null;
  };
  const observer = new MutationObserver(update);
  const click = event => {
    const button = event.target.closest?.('[data-native-action]'); if (!button || !port) return;
    const action = button.dataset.nativeAction;
    if (!Object.prototype.hasOwnProperty.call(labels, action)) return;
    // Installation updates belong to the signed-in personal center, never the login screen.
    if (lastSession !== true) return;
    const account = document.querySelector('#accountMenu'); if (account) account.open = false;
    send({action});
  };
  window.addEventListener('message', connect);
  document.addEventListener('click', click);
  document.addEventListener('quizforge-login-success', success);
  document.addEventListener('quizforge-remember-changed', changed);
  observer.observe(document.body, {childList:true,subtree:true});
  window.quizforgeAppControlsCleanup = () => {
    pending = null; observer.disconnect(); port?.close();
    port = null; style.remove(); widgets.forEach(widget => widget.remove());
    document.querySelector('#rememberPasswordOption')?.setAttribute('hidden','');
    detach.forEach(remove => remove());
    window.removeEventListener('message', connect);
    document.removeEventListener('click', click);
    document.removeEventListener('quizforge-login-success', success);
    document.removeEventListener('quizforge-remember-changed', changed);
  };
  return true;
})(__QUIZFORGE_APP_CONTROLS__);
