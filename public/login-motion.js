export function loginSceneMarkup() {
  return `<div class="pet-scene" aria-hidden="true"><div class="pet-orbit"></div><span class="pet-spark pet-spark-one">✦</span><span class="pet-spark pet-spark-two">✧</span><div class="pet-speech">Hi，好久不见！</div><div class="login-pet" data-mood="idle"><img src="/assets/login-kitten.png" alt="" width="1254" height="1254" fetchpriority="high"><div class="pet-eyes"><span class="pet-eye"><i></i></span><span class="pet-eye"><i></i></span></div></div><span class="pet-ground"></span></div>`;
}

// Eyes use focus, pointer and the account caret; password contents are never read.
export function bindLoginMotion(shell) {
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const account = shell.querySelector('#username');
  const password = shell.querySelector('#password');
  const pet = shell.querySelector('.login-pet');
  const speech = shell.querySelector('.pet-speech');
  const title = shell.querySelector('.login-intro h2');
  let frame = 0, blinkTimer = 0, blinkEnd = 0, disposed = false;
  let pointerX = 0, pointerY = 0;
  const look = (x, y) => {
    const scale = Math.min(1, (pet.clientWidth || 370) / 370);
    pet.style.setProperty('--eye-x', `${x * scale}px`);
    pet.style.setProperty('--eye-y', `${y * scale}px`);
  };
  const watchAccount = () => {
    const face=pet.getBoundingClientRect(),field=account.getBoundingClientRect();
    const caret=Math.min(Math.max(12,field.width-20),12+(account.selectionStart||0)*8);
    const dx=field.left+caret-(face.left+face.width*.5);
    const dy=field.top+field.height*.5-(face.top+face.height*.4);
    const distance=Math.max(120,Math.hypot(dx,dy));
    look(dx/distance*8,dy/distance*6);
  };
  const updateMood = () => {
    if (disposed) return;
    const hidden = document.activeElement === password || password.type === 'text' || document.activeElement?.id === 'passwordToggle';
    const typing = document.activeElement === account;
    pet.dataset.mood = hidden ? 'shy' : typing ? 'curious' : 'idle';
    speech.textContent = hidden ? '才没有偷看呢～' : typing ? '让我认识一下你呀' : 'Hi，好久不见！';
    if (hidden) look(-9, -4);
    else if (typing) watchAccount();
    else look(pointerX, pointerY);
  };
  const move = event => {
    if (reduced) return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const rect = shell.getBoundingClientRect();
      const x = (event.clientX - rect.left) / rect.width - .5;
      const y = (event.clientY - rect.top) / rect.height - .5;
      shell.style.setProperty('--motion-x', `${x * 22}px`);
      shell.style.setProperty('--motion-y', `${y * 16}px`);
      shell.style.setProperty('--spot-x', `${(x + .5) * 100}%`);
      shell.style.setProperty('--spot-y', `${(y + .5) * 100}%`);
      const face = pet.getBoundingClientRect();
      pointerX = Math.max(-8, Math.min(8, (event.clientX - face.left - face.width / 2) / 35));
      pointerY = Math.max(-6, Math.min(6, (event.clientY - face.top - face.height * .36) / 35));
      updateMood();
    });
  };
  const reset = () => { pointerX = pointerY = 0; shell.style.setProperty('--motion-x', '0px'); shell.style.setProperty('--motion-y', '0px'); updateMood(); };
  const focusChanged = () => { updateMood(); queueMicrotask(updateMood); };
  const blink = () => {
    if (disposed) return;
    pet.classList.add('is-blinking');
    blinkEnd = window.setTimeout(() => pet.classList.remove('is-blinking'), 160);
    blinkTimer = window.setTimeout(blink, 3800 + Math.random() * 2200);
  };
  const observer = new MutationObserver(updateMood);
  observer.observe(password, {attributes: true, attributeFilter: ['type']});
  shell.addEventListener('pointermove', move);
  shell.addEventListener('pointerleave', reset);
  shell.addEventListener('focusin', focusChanged);
  shell.addEventListener('focusout', focusChanged);
  account.addEventListener('input', updateMood);
  account.addEventListener('keyup', updateMood);
  account.addEventListener('click', updateMood);
  window.addEventListener('resize',updateMood);
  shell.dataset.loginStyle='pet';
  title.innerHTML='欢迎回来，<br><em>一起进步呀。</em>';
  updateMood();
  if (!reduced) blinkTimer = window.setTimeout(blink, 2800);
  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    clearTimeout(blinkTimer); clearTimeout(blinkEnd);
    observer.disconnect();
    shell.removeEventListener('pointermove', move);
    shell.removeEventListener('pointerleave', reset);
    shell.removeEventListener('focusin', focusChanged);
    shell.removeEventListener('focusout', focusChanged);
    account.removeEventListener('input', updateMood);
    account.removeEventListener('keyup', updateMood);
    account.removeEventListener('click', updateMood);
    window.removeEventListener('resize',updateMood);
  };
}
