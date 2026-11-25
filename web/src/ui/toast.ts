// The toast: one short line under the top row that fades after a few seconds. Live mode (gemmy serve) uses the same
// element for its Blender progress.
import { byId } from "./dom";

const DEFAULT_MS = 6000;
const toast = byId("toast");

export function note(text: string, ms = DEFAULT_MS): void {
  toast.textContent = text;
  toast.hidden = false;
  setTimeout(() => { toast.hidden = true; }, ms);
}
