// Only changes presentation; never persists or logs password values.
export function bindPasswordVisibility(input, button) {
  button.onclick = () => {
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.textContent = visible ? '隐藏' : '显示';
    button.setAttribute('aria-label', visible ? '隐藏密码' : '显示密码');
    button.setAttribute('aria-pressed', String(visible));
  };
}
