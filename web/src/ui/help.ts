// The keyboard help's open state: the ? key (ui/keyboard.ts) and the ? button toggle it, and React draws the panel
// (src/react/help.tsx). It is a popup of the panel table (ui/panels.ts), so it opens in the corner with the details card (one
// of the two at a time) and shuts any other popup.
import { PANELS, setPanel } from "./panels";

export const helpOpen = PANELS.help.open;

export function showHelp(open: boolean): void {
  setPanel("help", open);
}

export function toggleHelp(): void {
  showHelp(!helpOpen.value);
}
