// The hold-to-repeat of a toolbar button, as a hook: the press controller (ui/press.ts) with the button's latest move, so
// the props of a button may change between renders.
import { useRef, useState, type MouseEvent } from "react";
import type { Motion } from "../camera/fly";
import { makePress } from "../ui/press";

export function usePress(motion: () => Motion | null, beforeStart: () => void = () => {}) {
  const latest = useRef({ motion, beforeStart });
  latest.current = { motion, beforeStart };
  const [press] = useState(() =>
    makePress(
      () => latest.current.motion(),
      () => latest.current.beforeStart(),
    ),
  );
  return {
    onPointerDown: press.down,
    onPointerUp: press.up,
    onLostPointerCapture: press.up,
    onPointerCancel: press.cancel,
    onClick: (event: MouseEvent) => press.click(event.detail),
  };
}
