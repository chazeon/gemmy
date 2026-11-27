// The keyboard help's open state: the ? key (ui/keyboard.ts) and the ? button toggle it, and React draws the panel
// (src/react/help.tsx). The help and the details card open in the same place, above the corner island: one at a time. The
// help is one of the popups (ui/popup.ts), so opening it closes the others.
import { computed } from "@preact/signals-core";
import { showDetails } from "./panels";
import { openPopup, setPopupOpen } from "./popup";

const HELP = "help";
export const helpOpen = computed(() => openPopup.value === HELP);

export function showHelp(open: boolean): void {
  if (open) showDetails(false);
  setPopupOpen(HELP, open);
}

export function toggleHelp(): void {
  showHelp(!helpOpen.value);
}
