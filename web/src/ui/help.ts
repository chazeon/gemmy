// The keyboard help's open state: the ? key (ui/keyboard.ts) and the ? button toggle it, and React draws the panel
// (src/react/help.tsx). The help and the selection card open in the same place, above the corner island: one at a time.
import { signal } from "@preact/signals-core";
import { infoOpen } from "./panels";

export const helpOpen = signal(false);

export function showHelp(open: boolean): void {
  if (open) infoOpen.value = false;
  helpOpen.value = open;
}

export function toggleHelp(): void {
  showHelp(!helpOpen.value);
}
