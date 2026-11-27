// The page's layout modes, in one module. The phone width is the one number the page's phone rules and its desktop breakpoint
// are cut at: style.css (the phone @media rules), tailwind.css (--breakpoint-wide, one above) and the React side read it from
// here, and tests/test_ui_breakpoints.py fails when a literal in those files differs. The mode is an attribute on <html>,
// data-mode, which follows the window's width. The other states are attributes on <html> too: data-dock (set by ui/panels.ts)
// and data-scene, which is "none" on the start screen and "shown" with a scene (ui/home.ts sets it).

/** The phone's width: at most this is a phone (its sheets, its bottom row); above it is the wide layout, with the dock. */
export const PHONE_MAX_WIDTH = 640;

const phoneQuery = matchMedia(`(max-width: ${PHONE_MAX_WIDTH}px)`);

function setMode(): void {
  document.documentElement.dataset.mode = phoneQuery.matches ? "phone" : "wide";
}
setMode();
phoneQuery.addEventListener("change", setMode);

// The scene state: "shown" with a scene (the default), "none" on the start screen, where the scene's controls are hidden.
export function setScene(state: "none" | "shown"): void {
  document.documentElement.dataset.scene = state;
}
setScene("shown");
export function sceneShown(): boolean {
  return document.documentElement.dataset.scene === "shown";
}
