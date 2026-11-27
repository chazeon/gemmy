// The panels: the details card, the inspector dock, the lens and zoom row, and the popups (the keyboard help, the file menu and
// the Export menu). Each one is a row of PANELS, with its group, the place it opens into, its open signal and, for the ones the
// user opens and shuts, the choice remembered per browser. The rules for opening a panel live in setPanel, so no caller repeats
// them: a popup closes the other popup; a panel closes the others in its place (the details card and the help open above the
// corner island); a sheet (the card or the dock) closes the popups; and on a phone the bottom panels (the sheets and the row)
// are one at a time. The react side draws each signal (react/selection-card.tsx and the rest).
import { type ReadonlySignal, computed, effect, signal } from "@preact/signals-core";
import type { SectionId } from "../react/inspector/contract";
import { captureMode } from "./capture";
import { remembered } from "./storage";
import { PHONE_MAX_WIDTH } from "./layout-modes";

// ---- phone or desktop ----
// The phone breakpoint is PHONE_MAX_WIDTH (ui/layout-modes.ts): this test follows it, the CSS literals are checked against it
// (tests/test_ui_breakpoints.py), and the React side reads it through hooks/use-mobile.ts.
export const narrowScreen = matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);

// A choice the user makes, kept per browser as "1" (open) or "0" (shut). It is read once from storage and then kept here, so a
// choice survives in this visit even where storage refuses the write.
interface Remembered {
  read(): boolean | null;
  write(open: boolean): void;
}
function remember(key: string): Remembered {
  const store = remembered<"1" | "0" | null>(key, (raw) => (raw === "1" || raw === "0" ? raw : null));
  const stored = store.read();
  let choice: boolean | null = stored === null ? null : stored === "1";
  return {
    read: () => choice,
    write(open) {
      choice = open;
      store.write(open ? "1" : "0");
    },
  };
}

// ---- the panel table ----
// The element the focus goes to once the dock shuts: the edge tab on a wide screen, the customize button on a phone (the one shown).
const dockOpener = (): string => (narrowScreen.matches ? "customize-button" : "inspector-tab");

// The choices the user makes with a panel, kept per browser: one for a desktop screen and one for a phone, since a phone's
// sheets and row are not the desktop's (rule 4, docs/ui.md). The width is the one at the time of the choice.
function rememberPanel(key: string): Remembered {
  const wide = remember(key);
  const phone = remember(`${key}.phone`);
  return {
    read: () => (narrowScreen.matches ? phone : wide).read(),
    write: (open) => (narrowScreen.matches ? phone : wide).write(open),
  };
}
const detailsKept = rememberPanel("gemmy.details-open");
const inspectorKept = rememberPanel("gemmy.inspector-open");
const viewKept = rememberPanel("gemmy.view-controls-open");

// A phone's sheets start closed, whatever the user left: a scene's first showing opens the card when it has a pick and the dock
// on a desktop screen, as the user left them there (a desktop's choice when the user never chose).
export function detailsStartsOpen(picked: boolean): boolean {
  return !narrowScreen.matches && (detailsKept.read() ?? picked);
}
export function inspectorStartsOpen(): boolean {
  return !narrowScreen.matches && (inspectorKept.read() ?? true);
}

interface Panel {
  group: "sheet" | "popup" | "row";
  place: string;
  open: ReadonlySignal<boolean>;
  set(open: boolean): void; // writes the open state
  remember?: Remembered; // the user's own choice, kept (the panels the user opens and shuts)
  focus?: { open: string; shut: () => string }; // where the focus goes on the user's open or shut
}
// A panel whose open state is one boolean: a write of the same value changes nothing.
function flag(initial: boolean): Pick<Panel, "open" | "set"> {
  const open = signal(initial);
  return {
    open,
    set(value) {
      open.value = value;
    },
  };
}

// The dock's state: its open state and the style folder a click asked it to show. Every write makes a new object, so the dock's
// readers hear each show or shut, as they always have (the React side draws the dock from it).
const dock = signal<{ open: boolean; focus: SectionId | null }>({ open: inspectorStartsOpen(), focus: null });
export const inspector = dock;

export const PANELS = {
  details: {
    group: "sheet",
    place: "corner",
    ...flag(false),
    remember: detailsKept,
    focus: { open: "info", shut: () => "details-button" },
  },
  inspector: {
    group: "sheet",
    place: "dock",
    open: computed(() => dock.value.open),
    set(value: boolean) {
      dock.value = { open: value, focus: null };
    },
    remember: inspectorKept,
    focus: { open: "inspector", shut: dockOpener },
  },
  view: { group: "row", place: "lens", ...flag(viewKept.read() ?? !narrowScreen.matches), remember: viewKept },
  help: { group: "popup", place: "corner", ...flag(false) },
  "file-menu": { group: "popup", place: "top", ...flag(false) },
  "export-menu": { group: "popup", place: "top", ...flag(false) },
} satisfies Record<string, Panel>;
export type PanelId = keyof typeof PANELS;
export const POPUPS = (Object.keys(PANELS) as PanelId[]).filter((id) => PANELS[id].group === "popup");

// Whether opening `panel` shuts `other`.
function shuts(panel: Panel, other: Panel): boolean {
  if (panel.group === "popup" && other.group === "popup") return true;
  if (panel.place === other.place) return true;
  if (panel.group === "sheet" && other.group === "popup") return true;
  return narrowScreen.matches && panel.group !== "popup" && other.group !== "popup";
}

// The sheet opened last (the card or the dock): when the window crosses to phone width with both open, that one stays.
let lastSheet: PanelId | null = null;

// Opens or shuts a panel, and shuts what the opening panel shuts. This is the one place the rules are applied. It does not
// move the focus or remember the choice (the user's actions do: chooseDetails, toggleInspector, toggleViewControls).
export function setPanel(id: PanelId, open: boolean): void {
  const panel: Panel = PANELS[id];
  if (open) {
    for (const other of Object.keys(PANELS) as PanelId[]) {
      if (other !== id && shuts(panel, PANELS[other])) PANELS[other].set(false);
    }
    if (panel.group === "sheet") lastSheet = id;
  }
  panel.set(open);
}

// Escape's close: the topmost popup, when one is open, else the phone sheet that holds the focus (its focus goes back to its
// opener). Returns whether it closed one (ui/keyboard.ts).
export function closeTopmost(): boolean {
  const popup = POPUPS.find((id) => PANELS[id].open.peek());
  if (popup !== undefined) {
    PANELS[popup].set(false);
    return true;
  }
  const sheet = narrowScreen.matches ? focusedSheet() : null;
  if (sheet === "details") chooseDetails(false);
  else if (sheet === "inspector") userSets("inspector", false);
  return sheet !== null;
}

// The sheet on a phone that holds the focus, by its element. The focus is in the page, so it is read from the page here.
function focusedSheet(): "details" | "inspector" | null {
  const focused = document.activeElement;
  if (focused === null) return null;
  if (document.getElementById("info")?.contains(focused)) return "details";
  if (document.getElementById("inspector")?.contains(focused)) return "inspector";
  return null;
}

// Puts the focus on an element once it is drawn: a panel's element mounts a frame after its signal changes, and a hidden element
// takes no focus. It waits a few frames for the element, then leaves the focus alone.
const DRAW_FRAMES = 10;
function focusWhenDrawn(id: string, frames = DRAW_FRAMES): void {
  const element = document.getElementById(id);
  if (element?.checkVisibility()) {
    element.focus({ preventScroll: true });
    return;
  }
  if (frames > 0) requestAnimationFrame(() => focusWhenDrawn(id, frames - 1));
}

// The user opens or shuts a panel: the choice is remembered (when the panel keeps one), and the focus moves to the panel when
// it opens, or back to its opener when it shuts.
function userSets(id: PanelId, open: boolean): void {
  const panel: Panel = PANELS[id];
  setPanel(id, open);
  panel.remember?.write(open);
  if (panel.focus) focusWhenDrawn(open ? panel.focus.open : panel.focus.shut());
}

// ---- the details card ----
// The card of the picked object is open or shut. The details button and the i key toggle it, its close button shuts it, and a
// pick opens it. The user's own choice is remembered; a scene's first showing uses it (ui/stage.ts).
export const detailsOpen = PANELS.details.open;

// Shows or shuts the card without moving the focus or remembering the choice: a load, the help, a pick, and a scene's first
// showing.
export function showDetails(open: boolean): void {
  setPanel("details", open);
}

export function chooseDetails(open: boolean): void {
  userSets("details", open);
}

export function toggleDetails(): void {
  chooseDetails(!detailsOpen.value);
}

// ---- the inspector dock ----
// The id of the element that last took the focus. The browser may drop the focus from a control the page hides (the edge tab on a
// phone) before the width change is heard, so the question is where the focus last was, not where it is now.
let lastFocusedId = "";
document.addEventListener("focusin", (event) => {
  lastFocusedId = event.target instanceof HTMLElement ? event.target.id : "";
});
function focusWasOn(id: string): boolean {
  const focused = document.activeElement;
  const onBody = focused === null || focused === document.body;
  return focused?.id === id || (onBody && lastFocusedId === id);
}

// Crossing to phone width while the card and the dock are both open: the sheets would overlap, so the one opened last stays
// and the other shuts. The edge tab is hidden on a phone, so focus on it moves to the customize button (the dock's phone
// opener). Crossing back changes nothing.
function reconcileForPhone(): void {
  if (!narrowScreen.matches || !detailsOpen.value || !inspector.value.open) return;
  const fromEdgeTab = focusWasOn("inspector-tab");
  setPanel(lastSheet === "inspector" ? "details" : "inspector", false);
  if (fromEdgeTab) focusWhenDrawn("customize-button");
}
narrowScreen.addEventListener("change", reconcileForPhone);

// The dock is the page's data-dock attribute (on html), set in the same synchronous step, so the first paint already has the dock
// where it belongs: no slide on load. Capture mode has no dock, so the stage is never moved for one.
effect(() => {
  document.documentElement.dataset.dock = PANELS.inspector.open.value && !captureMode ? "open" : "shut";
});

// Shows or shuts the dock without moving the focus or remembering the choice: a load, the help, and a scene's first
// showing (ui/stage.ts).
export function showInspector(open: boolean): void {
  setPanel("inspector", open);
}

// The edge tab's and the customize button's press: opens the dock (the focus moves into it) or shuts it (the focus goes back to
// the opener).
export function toggleInspector(): void {
  userSets("inspector", !PANELS.inspector.open.value);
}

// A click on an object reveals its style folder in the dock, when the dock is open: the folder opens and scrolls to its
// header, and the focus stays where it was (a canvas click is not a keyboard move). A shut dock shows nothing.
export function revealFolder(at: SectionId): void {
  if (!inspector.value.open) return;
  inspector.value = { open: true, focus: at };
}

// The dock has taken its requested folder, or there is none on the page to take it: the request is cleared.
export function clearSectionFocus(): void {
  inspector.value = { ...inspector.value, focus: null };
}

// ---- each section's fold (react/inspector/dock-section.tsx), remembered per section ----
export function sectionChoice(id: SectionId): boolean | null {
  return remember(`gemmy.section.${id}`).read();
}

export function rememberSection(id: SectionId, open: boolean): void {
  remember(`gemmy.section.${id}`).write(open);
}

// ---- the lens and zoom row ----
// It folds into its aperture button: open on wide screens, folded on a phone, where it would cover the triad. The
// row reads this signal (react/lens-row.tsx); the button's choice is remembered.
export const viewControlsOpen = PANELS.view.open;

// The aperture button: opens or folds the row. On a phone, opening it shuts the sheets (setPanel).
export function toggleViewControls(): void {
  userSets("view", !viewControlsOpen.value);
}
