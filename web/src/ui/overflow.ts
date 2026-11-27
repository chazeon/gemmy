// The toolbars that scroll (the tool row on a phone, the lens row): a faded edge says that more buttons are hidden that
// way. React watches each one while it is drawn (react/overflow.ts), and the watch returns its unwatch.
const EDGE_SLACK_PX = 2; // a scroll position this close to an end counts as the end (sub-pixel rounding)
const watched = new Map<HTMLElement, () => void>();

// Which edges have more hidden past them: the scroll position is not at that end. A row that is not drawn has no width,
// so it has no edge with more.
export interface Edges {
  left: boolean;
  right: boolean;
}
export function edgesOf(el: HTMLElement): Edges {
  const { scrollLeft, scrollWidth, clientWidth } = el;
  return {
    left: scrollLeft > EDGE_SLACK_PX,
    right: scrollLeft + clientWidth < scrollWidth - EDGE_SLACK_PX,
  };
}

function markOverflow(el: HTMLElement): void {
  const edges = edgesOf(el);
  el.classList.toggle("more-left", edges.left);
  el.classList.toggle("more-right", edges.right);
}

// Watches a scroller (its scroll, and the window's size once) and marks its edges now. The returned function stops the
// watch and removes the scroll listener.
export function watchOverflow(el: HTMLElement): () => void {
  if (!watched.has(el)) {
    const onScroll = () => markOverflow(el);
    el.addEventListener("scroll", onScroll, { passive: true });
    watched.set(el, onScroll);
  }
  markOverflow(el);
  return () => {
    const onScroll = watched.get(el);
    if (onScroll === undefined) return;
    el.removeEventListener("scroll", onScroll);
    watched.delete(el);
  };
}
window.addEventListener("resize", () => {
  for (const el of watched.keys()) markOverflow(el);
});
