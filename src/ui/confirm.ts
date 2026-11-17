/**
 * In-game two-click confirmation (the browser's confirm() dialog is silently blocked in some
 * embedded views, where it just answers "cancel"). The first click turns the button into a
 * confirmation prompt for a few seconds; a second click within that time returns true.
 */
export function confirmClick(btn: HTMLButtonElement, prompt: string, ms = 4000): boolean {
  if (btn.dataset.armed === '1') {
    delete btn.dataset.armed;
    btn.classList.remove('confirming');
    if (btn.dataset.label !== undefined) btn.textContent = btn.dataset.label;
    clearTimeout(Number(btn.dataset.timer));
    return true;
  }
  btn.dataset.armed = '1';
  btn.dataset.label = btn.textContent ?? '';
  btn.textContent = prompt;
  btn.classList.add('confirming');
  btn.dataset.timer = String(setTimeout(() => {
    if (btn.dataset.armed !== '1') return;
    delete btn.dataset.armed;
    btn.classList.remove('confirming');
    btn.textContent = btn.dataset.label ?? '';
  }, ms));
  return false;
}
