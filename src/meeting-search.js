import { copyParagraphs } from './minutes-layout.js';

export function searchCleanCopy(report, query) {
  if (!report) return [];
  const terms = String(query).toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return copyParagraphs(report).map((text, index) => ({ text, index,
    score: terms.reduce((count, term) => count + Number(text.toLocaleLowerCase().includes(term)), 0) }))
    .filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.index - b.index).slice(0, 12);
}

export function jumpToSearchTarget(target, section) {
  if (!target || !section) return false;
  for (const item of document.querySelectorAll('.search-target')) item.classList.remove('search-target');
  let ancestor = target.parentElement;
  while (ancestor && ancestor !== section) {
    if (ancestor.tagName === 'DETAILS') ancestor.open = true;
    ancestor = ancestor.parentElement;
  }
  document.querySelector(`.workspace-nav a[href="#${section.id}"]`)?.click();
  const scroller = target.closest('#minutes, #segments');
  if (scroller) {
    scroller.scrollIntoView({ block: 'center', behavior: 'instant' });
    const padding = scroller.id === 'minutes' ? (scroller.querySelector('.minutes-nav')?.offsetHeight || 0) + 24 : 12;
    scroller.scrollTop += target.getBoundingClientRect().top - scroller.getBoundingClientRect().top - padding;
  }
  target.classList.add('search-target');
  target.setAttribute('tabindex', '-1');
  target.focus({ preventScroll: true });
  return true;
}
