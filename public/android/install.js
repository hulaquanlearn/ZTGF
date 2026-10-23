document.querySelector('#address').textContent = location.origin;
const status = document.querySelector('#status');
document.querySelector('#copy').addEventListener('click', async () => {
  try {
    let copied = false;
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(location.origin); copied = true; } catch { /* Fall back for restricted browsers. */ }
    }
    if (!copied) {
      const field = document.createElement('textarea'); field.value = location.origin;
      field.style.position = 'fixed'; field.style.opacity = '0'; document.body.append(field); field.select();
      try { copied = document.execCommand('copy'); } finally { field.remove(); }
    }
    if (!copied) throw new Error();
    status.textContent = '服务器地址已复制';
  }
  catch { status.textContent = '请长按上方地址复制'; }
});
try {
  const response = await fetch('/api/app-version', { cache: 'no-store' });
  if (!response.ok) throw new Error();
  const { android } = await response.json();
  if (android && Number.isSafeInteger(android.versionCode) && /^\/android\/[a-zA-Z0-9._-]+\.apk$/.test(android.apkPath)) {
    document.querySelector('#version').textContent = `安卓版本 ${android.versionName}`;
    const link = document.querySelector('#download');
    link.href = android.apkPath; link.download = android.apkPath.split('/').pop(); link.hidden = false;
  } else document.querySelector('#version').textContent = '安装包暂未发布，请稍后再试。';
} catch {
  document.querySelector('#version').textContent = '暂时无法读取版本，请刷新页面重试。';
}
