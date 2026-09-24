/**
 * utils.js — tiny shared helpers used by more than one page script.
 */

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text ?? '';
  return div.innerHTML;
}

/**
 * Primary-button "pressed" feedback: clicking any .btn-primary adds
 * .btn-pressed, which admin-surveys.css / admin-questions.css style
 * as purple-20 instead of the default purple-100. It stays for 20s,
 * then reverts automatically. A second click while it's still
 * pressed restarts the 20s window rather than stacking timers.
 */
document.addEventListener('click', (event) => {
  const btn = event.target.closest('.btn-primary');
  if (!btn) return;

  btn.classList.add('btn-pressed');
  clearTimeout(btn._pressedTimeout);
  btn._pressedTimeout = setTimeout(() => {
    btn.classList.remove('btn-pressed');
  }, 20000);
});
