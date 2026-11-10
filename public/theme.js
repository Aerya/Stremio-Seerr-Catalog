(() => {
  const modes = ['system', 'light', 'dark'];
  const palettes = ['violet', 'ocean', 'forest', 'rose', 'amber'];
  const media = matchMedia('(prefers-color-scheme: dark)');
  let mode = 'system', palette = 'violet';
  try { mode = localStorage.getItem('appearance-mode') || mode; palette = localStorage.getItem('appearance-palette') || palette; } catch (_) {}
  function apply() {
    if (!modes.includes(mode)) mode = 'system';
    if (!palettes.includes(palette)) palette = 'violet';
    document.documentElement.dataset.theme = mode === 'system' ? (media.matches ? 'dark' : 'light') : mode;
    document.documentElement.dataset.palette = palette;
    if (document.getElementById('theme-mode')) document.getElementById('theme-mode').value = mode;
    if (document.getElementById('theme-palette')) document.getElementById('theme-palette').value = palette;
  }
  window.setAppearance = (nextMode, nextPalette) => {
    mode = nextMode || mode; palette = nextPalette || palette;
    try { localStorage.setItem('appearance-mode', mode); localStorage.setItem('appearance-palette', palette); } catch (_) {}
    apply();
  };
  media.addEventListener('change', apply);
  document.addEventListener('DOMContentLoaded', apply);
  apply();
})();
