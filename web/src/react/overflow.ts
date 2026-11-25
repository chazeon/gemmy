// The fade on a row that scrolls (ui/overflow.ts): its edges are marked after each layout, so a button hidden past an
// edge shows the fade.
import { type RefObject, useLayoutEffect } from "react";
import { watchOverflow } from "../ui/overflow";

export function useOverflowFade(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    if (ref.current) watchOverflow(ref.current);
  });
}
