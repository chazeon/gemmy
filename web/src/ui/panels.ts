// The two panels that fold: the details panel (to its (i) button) and the lens and zoom column (to its aperture
// button). On a phone only one may be open, so each one's opening closes the other: that rule lives here, with both.
import { byId } from "./dom";

// ---- phone or desktop ----
// The phone breakpoint. web/style.css has the same 640 px in its phone @media rule; change both together.
const PHONE_MAX_WIDTH = 640;
export const narrowScreen = matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);

// A choice the user made, remembered per browser. Null when nothing was remembered or storage is refused.
function readChoice(key: string): boolean | null {
  try {
    const value = localStorage.getItem(key);
    return value === null ? null : value === "1";
  } catch {
    return null;
  }
}
function saveChoice(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // storage refused: the choice lasts for this visit only
  }
}

// ---- the details panel ----
// It folds to an (i) button. A scene opens with it shown when something is selected; a pick opens it, clearing the
// pick leaves it as it is, and the user's own open or close is remembered and wins on the next visit.
const INFO_KEY = "gemmy.info-open";
const infoPanel = byId("info"), infoButton = byId("info-button"), infoClose = byId("info-close");
export let infoChoice: boolean | null = readChoice(INFO_KEY);

export function showInfo(open: boolean) {
  if (open && narrowScreen.matches) showViewControls(false); // a phone has room for one of them at the bottom
  infoPanel.hidden = !open;
  infoButton.hidden = open;
  infoButton.setAttribute("aria-expanded", String(open));
}
export function toggleInfo() {
  const open = infoPanel.hidden;
  showInfo(open);
  infoChoice = open;
  saveChoice(INFO_KEY, open);
  (open ? infoClose : infoButton).focus({ preventScroll: true });
}
infoButton.addEventListener("click", toggleInfo);
infoClose.addEventListener("click", toggleInfo);

// ---- the lens and zoom column ----
// It folds into its aperture button: open on wide screens, folded on a phone, where it would cover the triad.
const VIEW_KEY = "gemmy.view-controls-open";
const viewBar = byId("bottom"), viewToggle = byId("view-toggle");
let viewOpen = readChoice(VIEW_KEY) ?? !narrowScreen.matches;

function showViewControls(open: boolean) {
  viewBar.classList.toggle("folded", !open);
  viewToggle.setAttribute("aria-expanded", String(open));
}
showViewControls(viewOpen);

viewToggle.addEventListener("click", () => {
  viewOpen = !viewOpen;
  if (viewOpen && narrowScreen.matches && !infoPanel.hidden) showInfo(false);
  showViewControls(viewOpen);
  saveChoice(VIEW_KEY, viewOpen);
});
