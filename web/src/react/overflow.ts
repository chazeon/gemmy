// The fade on a row that scrolls (ui/overflow.ts): its edges are marked after each draw, so a button hidden past an edge
// shows the fade. The watch is dropped before the next draw and on unmount, so a row that is gone is not kept.
import { type RefObject, useLayoutEffect } from "react";
import { watchOverflow } from "../ui/overflow";

export function useOverflowFade(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (el) return watchOverflow(el);
  });
}
