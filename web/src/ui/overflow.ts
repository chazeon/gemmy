// The toolbars that scroll (the tool row on a phone, the tab strip): a faded edge says that more buttons are hidden
// that way. A strip made later (the loader's tab bar) is watched with the same call, once its content is in place.
const EDGE_SLACK_PX = 2; // a scroll position this close to an end counts as the end (sub-pixel rounding)
const watched = new Set<HTMLElement>();

function markOverflow(el: HTMLElement): void {
  const { scrollLeft, scrollWidth, clientWidth } = el;
  el.classList.toggle("more-left", scrollLeft > EDGE_SLACK_PX);
  el.classList.toggle("more-right", scrollLeft + clientWidth < scrollWidth - EDGE_SLACK_PX);
}

// Watches a scroller (its scroll and the window's size, once) and marks its edges now.
export function watchOverflow(el: HTMLElement): void {
  if (!watched.has(el)) {
    watched.add(el);
    el.addEventListener("scroll", () => markOverflow(el), { passive: true });
  }
  markOverflow(el);
}
window.addEventListener("resize", () => watched.forEach(markOverflow));
