// Bookmarks only change page position; they never touch playback or the current take.
const nav = document.querySelector('.section-nav');
function visit(hash) {
  const link = [...nav.querySelectorAll('a')].find(item => item.hash === hash);
  if (!link) return;
  const target = document.getElementById(hash.slice(1));
  if (!target) return;
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start' });
}
nav.addEventListener('click', event => {
  const link = event.target.closest('a');
  if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  history.replaceState(null, '', link.hash);
  visit(link.hash);
});
window.addEventListener('hashchange', () => visit(location.hash));
if (location.hash) requestAnimationFrame(() => visit(location.hash));
