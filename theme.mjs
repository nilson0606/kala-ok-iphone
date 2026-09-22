const key = 'karaoke.theme.v1';
const picker = document.getElementById('theme-select');
function applyTheme(value) {
  const theme = value === 'warm' ? 'warm' : 'current';
  document.documentElement.dataset.theme = theme;
  picker.value = theme;
  document.querySelector('meta[name="theme-color"]').content = theme === 'warm' ? '#191310' : '#101411';
  window.dispatchEvent(new Event('karaoke-theme-change'));
}
let saved;
try { saved = localStorage.getItem(key); } catch { /* Private browser settings can block storage. */ }
applyTheme(saved);
picker.addEventListener('change', () => {
  applyTheme(picker.value);
  try { localStorage.setItem(key, picker.value); } catch { /* Theme still works for this visit. */ }
});
