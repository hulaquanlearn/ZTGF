(function (credentials) {
  if (window.top !== window || location.origin !== new URL(credentials.origin).origin) return false;
  const form = document.querySelector('#loginForm');
  const username = form?.querySelector('input[name="username"]');
  const password = form?.querySelector('input[name="password"]');
  if (!username || !password || !['password', 'text'].includes(password.type)) return false;
  // Background autofill must preserve anything the user has already started typing.
  if (!credentials.force && (username.value || password.value)) return false;
  username.value = credentials.username;
  password.value = credentials.password;
  for (const input of [username, password]) {
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  form.dataset.quizforgeAutofillChecked = '1';
  return true;
})(__QUIZFORGE_AUTOFILL_CREDENTIALS__);
