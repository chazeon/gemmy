// The fade on a row that scrolls (ui/overflow.ts): its edges are marked after each draw, so a button hidden past an edge
// shows the fade. The watch is dropped before the next draw and on unmount, so a row that is gone is not kept.
// useScrollEdges gives the same edges as state, for a control that is drawn only while its side has more (the chevrons).
import { type RefObject, useLayoutEffect, useState } from "react";
import { type Edges, edgesOf, watchOverflow } from "../ui/overflow";

export function useOverflowFade(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) return watchOverflow(el);
  });
}

const NO_EDGES: Edges = { left: false, right: false };

// The scroller's edges, measured after each draw (the first one after the layout), and again when its size changes (a
// resize, or a child that grows or shrinks) or it scrolls. The effect has no dependencies, so the observed
// children are the current ones after every draw. A measurement that changes nothing keeps the state, so it does not loop.
export function useScrollEdges(ref: RefObject<HTMLElement | null>): Edges {
  const [edges, setEdges] = useState(NO_EDGES);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () =>
      setEdges((previous) => {
        const next = edgesOf(el);
        return next.left === previous.left && next.right === previous.right ? previous : next;
      });
    measure();
    const sizes = new ResizeObserver(measure);
    sizes.observe(el);
    for (const child of el.children) sizes.observe(child);
    el.addEventListener("scroll", measure, { passive: true });
    return () => {
      sizes.disconnect();
      el.removeEventListener("scroll", measure);
    };
  });
  return edges;
}
