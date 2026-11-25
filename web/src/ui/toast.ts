// The toast: one short line under the top row. A note shows for its time, then fades (the .fade class, whose transition
// is FADE_MS in style.css) and is hidden. STAY keeps it until the next note or hideNote(): the serve page shows its
// Blender progress that way.
import { byId } from "./dom";

const DEFAULT_MS = 6000;
const FADE_MS = 400;
export const STAY = "stay";

const toast = byId("toast");
let timer: ReturnType<typeof setTimeout> | undefined;

export function note(text: string, ms: number | typeof STAY = DEFAULT_MS): void {
  clearTimeout(timer);
  toast.textContent = text;
  toast.hidden = false;
  toast.classList.remove("fade");
  if (ms === STAY) return;
  timer = setTimeout(() => {
    toast.classList.add("fade");
    timer = setTimeout(hideNote, FADE_MS);
  }, ms);
}

export function hideNote(): void {
  clearTimeout(timer);
  toast.hidden = true;
}

export const noteText = (): string => toast.textContent ?? "";
