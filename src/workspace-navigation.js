const panel = document.getElementById('settings-panel');
const opener = document.getElementById('settings-open');
const closer = document.getElementById('settings-close');
function closeSettings() {
  panel.hidden = true;
  opener.setAttribute('aria-expanded', 'false');
  opener.focus();
}
opener.addEventListener('click', () => {
  if (!panel.hidden) return closeSettings();
  panel.hidden = false;
  opener.setAttribute('aria-expanded', 'true');
  closer.focus();
});
closer.addEventListener('click', closeSettings);
// Keep Google's folder picker usable above this non-modal settings panel.
panel.addEventListener('keydown', event => {
  if (event.key === 'Escape') { event.preventDefault(); closeSettings(); }
});
const links = [...document.querySelectorAll('.workspace-nav a')];
links.forEach(link => link.addEventListener('click', event => {
  const target = document.querySelector(link.hash);
  if (!target) return;
  event.preventDefault();
  panel.hidden = true;
  opener.setAttribute('aria-expanded', 'false');
  target.focus({ preventScroll: true });
  target.scrollIntoView({ block: 'start', behavior: 'instant' });
  links.forEach(item => item === link ? item.setAttribute('aria-current', 'location') : item.removeAttribute('aria-current'));
}));
function markSection() {
  const boundary = document.querySelector('.workspace-nav').getBoundingClientRect().bottom + 32;
  let current = links[0];
  let nearest = -Infinity;
  for (const link of links) {
    const top = document.querySelector(link.hash).getBoundingClientRect().top;
    if (top <= boundary && (top > nearest || (top === nearest && link.hasAttribute('aria-current')))) {
      current = link;
      nearest = top;
    }
  }
  links.forEach(link => {
    if (link === current) link.setAttribute('aria-current', 'location');
    else link.removeAttribute('aria-current');
  });
}
window.addEventListener('scroll', markSection, { passive: true });
window.addEventListener('resize', markSection);
markSection();
