// Panels that open and shut with the same fade and zoom as shadcn's menus (tw-animate-css). A shut panel stays drawn
// while its exit animation runs, then goes. `state` is the data-state the animation classes key on.
import { useEffect, useRef, useState } from "react";

// tw-animate-css's default duration
const EXIT_MS = 150;

export function usePresence(open: boolean): { shown: boolean; state: "open" | "closed" } {
  const [leaving, setLeaving] = useState(false);
  // Only a panel that was open leaves: one shut from the start (the page's first draw) plays no exit.
  const wasOpen = useRef(open);
  useEffect(() => {
    const left = wasOpen.current && !open;
    wasOpen.current = open;
    if (!left) return;
    setLeaving(true);
    const timer = setTimeout(() => setLeaving(false), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open]);
  return { shown: open || leaving, state: open ? "open" : "closed" };
}

// The fade and zoom in and out; a panel adds the side it slides from (e.g. slide-in-from-bottom-2).
export const PANEL_MOTION =
  "data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=closed]:fill-mode-forwards motion-reduce:animate-none";
