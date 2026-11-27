// The panels that fold: the details card (react/selection-card.tsx, to its details button, react/details-button.tsx), the
// inspector dock (react/inspector/inspector.tsx, its style sections for the tab on show, opened by its edge tab or on a phone
// by the customize button) and the lens and zoom row (to its aperture button, react/lens-row.tsx). On a phone the card and
// the dock are bottom sheets, and the lens row folds while either is open: each one's opening closes the others. That rule
// lives here, with them.
import { effect, signal } from "@preact/signals-core";
import type { SectionId } from "../react/inspector/contract";
import { captureMode } from "./capture";
import { showHelp } from "./help";
import { remembered } from "./storage";

// ---- phone or desktop ----
// The phone breakpoint. web/style.css has the same 640 px in its phone @media rule, and web/tailwind.css the desktop `wide`
// breakpoint (641 px); change them together. The React side reads this through hooks/use-mobile.ts.
export const PHONE_MAX_WIDTH = 640;
export const narrowScreen = matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);

// Which sheet (the card or the dock) was opened last: when the window crosses to phone width with both open, that one stays.
let lastSheet: "details" | "inspector" | null = null;

// A fold's open or shut choice, remembered per browser as "1" (open) or "0" (shut).
type Choice = "1" | "0" | null;
const choiceStore = (key: string) => remembered<Choice>(key, (raw) => (raw === "1" || raw === "0" ? raw : null));
const asChoice = (open: boolean): Choice => (open ? "1" : "0");
const isOpen = (choice: Choice): boolean | null => (choice === null ? null : choice === "1");

// ---- the details card ----
// The card of the picked object is open or shut. The details button and the i key toggle it, its close button shuts it, and a
// pick opens it. The user's own choice is remembered; a scene's first showing uses it (ui/stage.ts).
export const detailsOpen = signal(false);

// Where the focus goes after the user opens or shuts the card: the card itself ("card"), or the details button ("button").
// React takes the request and clears it (react/selection-card.tsx, react/details-button.tsx).
export const detailsFocus = signal<"card" | "button" | null>(null);

const DETAILS_KEY = "gemmy.details-open";
const detailsStore = choiceStore(DETAILS_KEY);
let rememberedDetails: boolean | null = isOpen(detailsStore.read());
// Whether the user last opened or shut the card (null when they never did).
export function detailsChoice(): boolean | null {
  return rememberedDetails;
}

// Shows or shuts the card without moving the focus or remembering the choice: a load, the help, a pick, and a scene's first
// showing. Opening it shuts the help (they open in the same place, ui/help.ts) and a phone's lens row.
export function showDetails(open: boolean): void {
  if (open) lastSheet = "details";
  if (open && narrowScreen.matches) {
    showViewControls(false); // a phone has room for one of them at the bottom
    showInspector(false); // and one sheet at a time
  }
  if (open) showHelp(false);
  detailsOpen.value = open;
}

// The user opens or shuts the card (the details button, the i key, the card's close button): remembered, and the focus
// moves into the card when it opens, back to the button when it shuts.
export function chooseDetails(open: boolean): void {
  showDetails(open);
  rememberedDetails = open;
  detailsStore.write(asChoice(open));
  detailsFocus.value = open ? "card" : "button";
}

export function toggleDetails(): void {
  chooseDetails(!detailsOpen.value);
}

// ---- the inspector dock ----
// Crossing to phone width while the card and the dock are both open: the sheets would overlap, so the one opened last stays
// and the other shuts. The edge tab is hidden on a phone, so focus on it moves to the customize button (the dock's phone
// opener). Crossing back changes nothing.
function reconcileForPhone(): void {
  if (!narrowScreen.matches || !detailsOpen.value || !inspector.value.open) return;
  const fromEdgeTab = focusWasOn("inspector-tab");
  if (lastSheet === "inspector") showDetails(false);
  else showInspector(false);
  if (fromEdgeTab) focusWhenDrawn("customize-button", DRAW_FRAMES);
}

// The id of the element that last took the focus. A control the page hides (the edge tab on a phone) drops the focus to the
// body, and whether it has done so when the width changes depends on whether the page was drawn in between; so the
// question is where the focus last was, not where it is now.
let lastFocusedId = "";
document.addEventListener("focusin", (event) => {
  lastFocusedId = event.target instanceof HTMLElement ? event.target.id : "";
});
function focusWasOn(id: string): boolean {
  const focused = document.activeElement;
  const onBody = focused === null || focused === document.body;
  return focused?.id === id || (onBody && lastFocusedId === id);
}

// The customize button is hidden on a wide screen, and a focus on a hidden element is ignored. The phone styles are in
// place by the next frame, so the focus waits for the button to be drawn (a few frames at most, then it is left alone).
const DRAW_FRAMES = 10;
function focusWhenDrawn(id: string, frames: number): void {
  const button = document.getElementById(id);
  if (button?.checkVisibility()) {
    button.focus({ preventScroll: true });
    return;
  }
  if (frames > 0) requestAnimationFrame(() => focusWhenDrawn(id, frames - 1));
}
narrowScreen.addEventListener("change", reconcileForPhone);

// The dock is open or shut, and `focus` is the style folder it scrolls to. The folder's frame takes the request and clears it
// (react/inspector/dock-section.tsx).
// It starts as the user left it (or open on a wide screen when they never chose), so the first paint already has the dock
// where it belongs: no slide on load. The page's data-dock attribute (on html) follows the signal in the same synchronous step (below).
const INSPECTOR_KEY = "gemmy.inspector-open";
const inspectorStore = choiceStore(INSPECTOR_KEY);
let rememberedInspector: boolean | null = isOpen(inspectorStore.read());
export const inspector = signal<{ open: boolean; focus: SectionId | null }>({
  open: rememberedInspector ?? !narrowScreen.matches,
  focus: null,
});
// Capture mode has no dock, so the stage is never moved for one.
effect(() => {
  document.documentElement.dataset.dock = inspector.value.open && !captureMode ? "open" : "shut";
});

// Where the focus goes after the user opens or shuts the dock: the dock itself ("dock"), or the button it was opened from
// ("opener": the edge tab on a wide screen, the customize button on a phone; the one that is shown takes it). The React side
// takes the request and clears it (react/inspector/inspector.tsx, react/inspector-toggle.tsx, react/customize-button.tsx).
export const inspectorFocus = signal<"dock" | "opener" | null>(null);

// Whether the user last opened or shut the dock (null when they never did): a scene opens with the dock as it was left.
export function inspectorChoice(): boolean | null {
  return rememberedInspector;
}

function rememberInspector(open: boolean): void {
  rememberedInspector = open;
  inspectorStore.write(asChoice(open));
}

// Shows or shuts the dock without moving the focus or remembering the choice: a load, the help, and a scene's first
// showing (ui/stage.ts).
export function showInspector(open: boolean): void {
  if (open) lastSheet = "inspector";
  if (open && narrowScreen.matches) {
    showViewControls(false);
    detailsOpen.value = false; // a phone's dock and card are sheets in the same place: one at a time
  }
  if (open) showHelp(false); // the dock and the help open in the same place (ui/help.ts)
  inspector.value = { open, focus: null };
}

// The user opens the dock (the edge tab, or the customize button on a phone): remembered, the focus moves to the dock.
function openInspector(): void {
  showInspector(true);
  inspectorFocus.value = "dock";
  rememberInspector(true);
}

// A click on an object reveals its style folder in the dock, when the dock is open: the folder opens and scrolls to its
// header, and the focus stays where it was (a canvas click is not a keyboard move). A shut dock shows nothing.
export function revealFolder(at: SectionId): void {
  if (!inspector.value.open) return;
  inspector.value = { open: true, focus: at };
}

// The edge tab's and the customize button's press: opens the dock, or shuts it. Shutting it moves the focus back to the button.
export function toggleInspector(): void {
  if (inspector.value.open) {
    inspectorFocus.value = "opener";
    showInspector(false);
    rememberInspector(false);
  } else {
    openInspector();
  }
}

// The dock has taken its requested folder, or there is none on the page to take it: the request is cleared.
export function clearSectionFocus(): void {
  inspector.value = { ...inspector.value, focus: null };
}

// ---- each section's fold (react/inspector/dock-section.tsx), remembered per section ----
export function sectionChoice(id: SectionId): boolean | null {
  return isOpen(choiceStore(`gemmy.section.${id}`).read());
}

export function rememberSection(id: SectionId, open: boolean): void {
  choiceStore(`gemmy.section.${id}`).write(asChoice(open));
}

// ---- the lens and zoom row ----
// It folds into its aperture button: open on wide screens, folded on a phone, where it would cover the triad. The
// row reads this signal (react/lens-row.tsx); the button's choice is remembered.
const VIEW_CONTROLS_KEY = "gemmy.view-controls-open";
const viewStore = choiceStore(VIEW_CONTROLS_KEY);
export const viewControlsOpen = signal(isOpen(viewStore.read()) ?? !narrowScreen.matches);

function showViewControls(open: boolean) {
  viewControlsOpen.value = open;
}
// The aperture button: opens or folds the row. On a phone, opening it shuts the details card.
export function toggleViewControls(): void {
  const open = !viewControlsOpen.value;
  if (open && narrowScreen.matches) {
    showDetails(false);
    showInspector(false);
  }
  showViewControls(open);
  viewStore.write(asChoice(open));
}
