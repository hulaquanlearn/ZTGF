// Explicit login checkbox; never persists or logs password values.
export function bindPasswordVisibility(input, checkbox) {
  checkbox.checked = false;
  input.type = 'password';
  checkbox.onchange = () => {
    const visible = checkbox.checked;
    input.type = visible ? 'text' : 'password';
  };
}
