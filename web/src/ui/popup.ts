// The one popup open at a time: a menu, a dropdown or a popover (the file menu, the Export menu, the keyboard
// help). Each one opens and shuts through this signal, so opening one closes any other. The ids are the popups' own
// (react/use-popup.ts).
import { signal } from "@preact/signals-core";

export const openPopup = signal<string | null>(null);

export function setPopupOpen(id: string, open: boolean): void {
  if (open) openPopup.value = id;
  else if (openPopup.peek() === id) openPopup.value = null;
}
