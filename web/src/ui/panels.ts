// The two panels that fold: the details panel (to its (i) button) and the lens and zoom column (to its aperture
// button). On a phone only one may be open, so each one's opening closes the other: that rule lives here, with both.
import { byId } from "./dom";
import { remembered } from "./storage";

// ---- phone or desktop ----
// The phone breakpoint. web/style.css has the same 640 px in its phone @media rule; change both together.
const PHONE_MAX_WIDTH = 640;
export const narrowScreen = matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);

// A fold's open or shut choice, remembered per browser as "1" (open) or "0" (shut).
type Choice = "1" | "0" | null;
const choiceStore = (key: string) => remembered<Choice>(key, (raw) => (raw === "1" || raw === "0" ? raw : null));
const asChoice = (open: boolean): Choice => (open ? "1" : "0");
const isOpen = (choice: Choice): boolean | null => (choice === null ? null : choice === "1");

// ---- the details panel ----
// It folds to an (i) button. A scene opens with it shown when something is selected; a pick opens it, clearing the
// pick leaves it as it is, and the user's own open or close is remembered and wins on the next visit.
const INFO_KEY = "gemmy.info-open";
const infoPanel = byId("info"),
  infoButton = byId("info-button"),
  infoClose = byId("info-close");
const infoStore = choiceStore(INFO_KEY);
let rememberedInfo: boolean | null = isOpen(infoStore.read());
// Whether the user last opened or closed the details panel (null when they never did).
export function infoChoice(): boolean | null {
  return rememberedInfo;
}

export function showInfo(open: boolean) {
  if (open && narrowScreen.matches) showViewControls(false); // a phone has room for one of them at the bottom
  infoPanel.hidden = !open;
  infoButton.hidden = open;
  infoButton.setAttribute("aria-expanded", String(open));
}
export function toggleInfo() {
  const open = infoPanel.hidden;
  showInfo(open);
  rememberedInfo = open;
  infoStore.write(asChoice(open));
  (open ? infoClose : infoButton).focus({ preventScroll: true });
}

// ---- the lens and zoom column ----
// It folds into its aperture button: open on wide screens, folded on a phone, where it would cover the triad.
const VIEW_CONTROLS_KEY = "gemmy.view-controls-open";
const viewBar = byId("bottom"),
  viewToggle = byId("view-toggle");
const viewStore = choiceStore(VIEW_CONTROLS_KEY);
let viewOpen = isOpen(viewStore.read()) ?? !narrowScreen.matches;

function showViewControls(open: boolean) {
  viewBar.classList.toggle("folded", !open);
  viewToggle.setAttribute("aria-expanded", String(open));
}

// Wires the two folds: the buttons, and the column's first state.
export function wirePanels(): void {
  infoButton.addEventListener("click", toggleInfo);
  infoClose.addEventListener("click", toggleInfo);
  showViewControls(viewOpen);
  viewToggle.addEventListener("click", () => {
    viewOpen = !viewOpen;
    if (viewOpen && narrowScreen.matches && !infoPanel.hidden) showInfo(false);
    showViewControls(viewOpen);
    viewStore.write(asChoice(viewOpen));
  });
}
