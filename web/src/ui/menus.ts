// The popovers: the ☰ menu, Export and help. Each opens next to its button, one at a time, and closes on Escape or an
// outside press. Export's items save or copy the view (as PNG, SVG or render settings; ui/export.ts).
import { MathUtils } from "three";
import { byId, closestOf } from "./dom";
import { showUrlForm } from "./loader";
import { runExport } from "./export";

// ---- popovers ----
// The ☰ menu, Export and help are native popovers (popover="auto" in page.html): their buttons open them through
// popovertarget, and the browser closes them on Escape or an outside press, keeps one open at a time and returns focus.
// What is left here: placing each panel under its button, aria-expanded, and the arrow keys between items.
const POPOVER_GAP_PX = 6; // between the button and the popover
const POPOVER_MARGIN_PX = 8; // between the popover and the window's edge
const POPOVER_CLEARANCE_PX = 14; // the popover's height is kept this far from the window's edge

// Where a popover goes: below its button in the top half of the window, above one in the bottom half, its near edge
// lined up with the button, and kept inside the window with a margin. Its height stops at the window's edge.
function placePopover(button: HTMLElement, panel: HTMLElement) {
  const r = button.getBoundingClientRect(),
    W = window.innerWidth,
    H = window.innerHeight;
  const below = r.top + r.height / 2 < H / 2;
  panel.style.maxHeight = `${(below ? H - r.bottom : r.top) - POPOVER_CLEARANCE_PX}px`;
  const w = panel.offsetWidth,
    h = panel.offsetHeight;
  const left = r.left + r.width / 2 < W / 2 ? r.left : r.right - w;
  panel.style.left = `${MathUtils.clamp(left, POPOVER_MARGIN_PX, W - w - POPOVER_MARGIN_PX)}px`;
  panel.style.top = `${below ? r.bottom + POPOVER_GAP_PX : r.top - POPOVER_GAP_PX - h}px`;
}

// The buttons and inputs the arrow keys walk through (hidden ones are skipped).
function focusable(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>("button, input")].filter(
    (el) => !el.hidden && !el.closest("[hidden]"),
  );
}
// Arrow keys, Home and End move focus within a popover. Returns whether the key was used.
function moveFocus(key: string, list: HTMLElement[]): boolean {
  const i = list.indexOf(document.activeElement as HTMLElement);
  if (key === "ArrowDown") list[(i + 1) % list.length]?.focus();
  else if (key === "ArrowUp") list[(i + list.length - 1) % list.length]?.focus();
  else if (key === "Home") list[0]?.focus();
  else if (key === "End") list[list.length - 1]?.focus();
  else return false;
  return true;
}

// Wires a popover to the button that opens it. When it opens it is placed and its first item focused; Tab closes it.
function wirePopover(button: HTMLElement, panel: HTMLElement): void {
  panel.addEventListener("toggle", (e) => {
    const open = (e as ToggleEvent).newState === "open";
    button.setAttribute("aria-expanded", String(open));
    if (!open) return;
    placePopover(button, panel);
    focusable(panel)[0]?.focus();
  });
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Tab") panel.hidePopover();
    else if (moveFocus(e.key, focusable(panel))) e.preventDefault();
  });
  window.addEventListener("resize", () => {
    if (panel.matches(":popover-open")) placePopover(button, panel);
  });
}

// ---- the popovers in use ----
export const exportMenu = byId("export-menu");
wirePopover(byId("export-button"), exportMenu);
const mainMenu = byId("main-menu");
wirePopover(byId("menu-button"), mainMenu);
// Open URL… closes the menu and shows the URL card over the scene (loader.ts).
byId("open-url").addEventListener("click", () => {
  mainMenu.hidePopover();
  showUrlForm();
});

// The help panel: the ? key (ui/keyboard.ts) opens and shuts it with togglePopover.
export const helpPanel = byId("help");
wirePopover(byId("help-button"), helpPanel);

exportMenu.addEventListener("click", (e) => {
  const item = closestOf(e.target, "[data-export]");
  if (item) runExport(item.dataset.export, item);
});
