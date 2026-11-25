// The two panels that fold: the details card (to its (i) button, drawn by src/react/info-card.tsx) and the lens and zoom
// column (to its aperture button, react/lens-column.tsx). On a phone only one may be open, so each one's opening closes
// the other: that rule lives here, with both.
import { signal } from "@preact/signals-core";
import { remembered } from "./storage";
import { helpOpen } from "./menus";

// ---- phone or desktop ----
// The phone breakpoint. web/style.css has the same 640 px in its phone @media rule; change both together.
const PHONE_MAX_WIDTH = 640;
export const narrowScreen = matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);

// A fold's open or shut choice, remembered per browser as "1" (open) or "0" (shut).
type Choice = "1" | "0" | null;
const choiceStore = (key: string) => remembered<Choice>(key, (raw) => (raw === "1" || raw === "0" ? raw : null));
const asChoice = (open: boolean): Choice => (open ? "1" : "0");
const isOpen = (choice: Choice): boolean | null => (choice === null ? null : choice === "1");

// ---- the details card ----
// It folds to an (i) button. A scene opens with it shown when something is selected; a pick opens it, clearing the
// pick leaves it as it is, and the user's own open or close is remembered and wins on the next visit.
const INFO_KEY = "gemmy.info-open";
const infoStore = choiceStore(INFO_KEY);
// Whether the card is open; the React card reads it (src/react/info-card.tsx).
export const infoOpen = signal(false);
// Where the focus goes after the user opens or folds the card: the card's close button, or the (i) button. React takes the
// request and clears it, once it has drawn the change (react/info-card.tsx, react/corner-buttons.tsx).
export const infoFocus = signal<"close" | "details" | null>(null);
let rememberedInfo: boolean | null = isOpen(infoStore.read());
// Whether the user last opened or closed the details card (null when they never did).
export function infoChoice(): boolean | null {
  return rememberedInfo;
}

export function showInfo(open: boolean) {
  if (open && narrowScreen.matches) showViewControls(false); // a phone has room for one of them at the bottom
  if (open) helpOpen.value = false; // the card and the help open in the same place (ui/menus.ts)
  infoOpen.value = open;
}
// The (i) button and the card's close button: the user's own choice, remembered, and the focus moves to the control they
// can reach next (infoFocus).
export function toggleInfo() {
  const open = !infoOpen.value;
  showInfo(open);
  rememberedInfo = open;
  infoStore.write(asChoice(open));
  infoFocus.value = open ? "close" : "details";
}

// ---- the lens and zoom column ----
// It folds into its aperture button: open on wide screens, folded on a phone, where it would cover the triad. The
// column reads this signal (react/lens-column.tsx); the button's choice is remembered.
const VIEW_CONTROLS_KEY = "gemmy.view-controls-open";
const viewStore = choiceStore(VIEW_CONTROLS_KEY);
export const viewControlsOpen = signal(isOpen(viewStore.read()) ?? !narrowScreen.matches);

function showViewControls(open: boolean) {
  viewControlsOpen.value = open;
}
// The aperture button: opens or folds the column. On a phone, opening it shuts the details card.
export function toggleViewControls(): void {
  const open = !viewControlsOpen.value;
  if (open && narrowScreen.matches && infoOpen.value) showInfo(false);
  showViewControls(open);
  viewStore.write(asChoice(open));
}
