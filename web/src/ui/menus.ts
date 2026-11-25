// The popovers: the ☰ menu, Export and help. Each opens next to its button, one at a time, and closes on Escape or an
// outside press. Export's items save or copy the view (as PNG, SVG or render settings).
import { renderer, scene, stage, controls } from "../render/draw";
import { buildTracedSvg } from "../trace/traced";
import { exportView, renderCommand, settingsJson, settingsToml } from "../camera/framing";
import { drawTriad } from "../render/triad";
import { isPersp, currentZoom } from "../camera/view";
import { camera, centre, data, extent, lattice, lens, outlines, requestRender, show } from "../state";
import { byId, clamp, closestOf } from "./dom";
import { ThemeChoice, currentTheme, isThemeChoice, onThemeChange, setTheme } from "./theme";
import { chooseOutlineScale, onOutlineScaleChange, outlineScale } from "./outline-scale";
import { showUrlForm } from "./loader";

// ---- what the Export menu saves ----
const PNG_SCALE = 2; // the PNG is twice the window in each direction, whatever the screen's own pixel ratio
const KB = 1024;
const DOWNLOAD_REVOKE_MS = 10000; // a blob URL is kept this long, so the browser has started the download
const DEFAULT_SCENE_FILE = "scene.json";

function projectionName(): "persp" | "ortho" {
  return isPersp() ? "persp" : "ortho";
}
// The view as the render settings describe it (camera, zoom, target, box and lens).
export const currentView = () => exportView({
  quaternion: camera.quaternion.toArray(), zoom: currentZoom(), target: controls.target.toArray(), centre,
  box: show.box, width: stage.clientWidth, height: stage.clientHeight, projection: projectionName(), lens,
});

// ---- saving and copying ----
const exportStatus = byId("export-status");
function say(text: string, failed = false) {
  exportStatus.textContent = text;
  exportStatus.classList.toggle("err", failed);
}
function download(name: string, blob: Blob) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(link.href), DOWNLOAD_REVOKE_MS);
}
function saveFile(name: string, type: string, text: string) {
  download(name, new Blob([text], { type }));
  say(`Saved ${name}.`);
}

// The text box that holds the settings when the clipboard refuses them: the text is selected for the user to copy.
const exportText = byId<HTMLTextAreaElement>("export-text");
function showSelectedText(text: string, what: string) {
  exportText.value = text;
  exportText.hidden = false;
  exportText.focus();
  exportText.select();
  say(`Could not use the clipboard: ${what} is selected, press Ctrl/Cmd+C.`, true);
}
// Copy inside the click handler (browsers only allow it there); when refused, show the text selected instead.
function copyText(text: string, what: string) {
  const fallback = () => showSelectedText(text, what);
  try {
    navigator.clipboard.writeText(text).then(() => { exportText.hidden = true; say(`Copied ${what}.`); }, fallback);
  } catch {
    fallback();
  }
}

// ---- the image and vector exports ----
// The PNG is drawn by the renderer at PNG_SCALE, then the triad on top; the page background fills it unless transparent.
function exportPng(transparent: boolean) {
  const w = stage.clientWidth, h = stage.clientHeight, ratio = renderer.getPixelRatio();
  renderer.setPixelRatio(PNG_SCALE);
  renderer.setSize(w, h);
  renderer.render(scene, camera);
  const out = document.createElement("canvas");
  out.width = w * PNG_SCALE;
  out.height = h * PNG_SCALE;
  const ctx = out.getContext("2d") as CanvasRenderingContext2D;
  if (!transparent) {
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(renderer.domElement, 0, 0); // same task as the render, so the buffer is still valid
  ctx.drawImage(triadAt(PNG_SCALE), 0, 0);
  renderer.setPixelRatio(ratio);
  renderer.setSize(w, h);
  requestRender();
  out.toBlob((blob) => {
    if (blob) {
      download("view.png", blob);
      say(`Saved view.png (${out.width} × ${out.height}).`);
    } else {
      say("The browser could not make the PNG.", true);
    }
  }, "image/png");
}
function triadAt(scale: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  drawTriad(canvas, canvas.getContext("2d") as CanvasRenderingContext2D, scale);
  return canvas;
}

// The SVG export (trace/traced.ts): the same view, drawn from the GPU's object ids.
function exportSvg() {
  const boxColor = getComputedStyle(document.documentElement).getPropertyValue("--box").trim();
  let result;
  try {
    result = buildTracedSvg({
      data, centre, extent, quaternion: camera.quaternion.toArray(), zoom: currentZoom(), target: controls.target.toArray(),
      projection: projectionName(), lens, width: stage.clientWidth, height: stage.clientHeight, show, outlines, outlineScale: outlineScale(),
      lattice: lattice.map((v) => v.toArray()), boxColor,
    });
  } catch (error) {
    say(`The SVG export failed: ${error instanceof Error ? error.message : String(error)}`, true);
    return;
  } finally {
    requestRender(); // the passes drew into the GPU's buffers: the live view is redrawn either way
  }
  download("view.svg", new Blob([result.text], { type: "image/svg+xml" }));
  if (result.paths === 0) {
    say("Saved view.svg, but nothing in this view is visible: the file has no shapes.", true);
    return;
  }
  say(`Saved view.svg (${Math.round(result.text.length / KB)} kB, ${result.paths} paths, ${Math.round(result.ms)} ms).`);
}

// What each Export button does, by its data-export name.
export const EXPORTS: Record<string, (item?: HTMLElement) => unknown> = {
  svg: exportSvg,
  png: () => exportPng(byId<HTMLInputElement>("png-transparent").checked),
  "save-toml": () => saveFile("render-settings.toml", "application/toml", settingsToml(currentView())),
  "save-json": () => saveFile("render-settings.json", "application/json", settingsJson(currentView())),
  "copy-toml": () => copyText(settingsToml(currentView()), "the TOML settings"),
  "copy-json": () => copyText(settingsJson(currentView()), "the JSON settings"),
  "copy-command": () => copyText(renderCommand(currentView(), sceneFileName()), "the command"),
};
function sceneFileName(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="gemmy-scene-file"]');
  return meta?.content || DEFAULT_SCENE_FILE;
}

// ---- popovers ----
// Where a popover goes: below its button in the top half of the window, above one in the bottom half, its near edge
// lined up with the button, and kept inside the window with a margin. Its height stops at the window's edge.
const POPOVER_GAP_PX = 6; // between the button and the popover
const POPOVER_MARGIN_PX = 8; // between the popover and the window's edge
const POPOVER_CLEARANCE_PX = 14; // the popover's height is kept this far from the window's edge

function placePopover(button: HTMLElement, panel: HTMLElement) {
  const r = button.getBoundingClientRect(), W = window.innerWidth, H = window.innerHeight;
  const below = r.top + r.height / 2 < H / 2;
  panel.style.maxHeight = `${(below ? H - r.bottom : r.top) - POPOVER_CLEARANCE_PX}px`;
  const w = panel.offsetWidth, h = panel.offsetHeight;
  const left = r.left + r.width / 2 < W / 2 ? r.left : r.right - w;
  panel.style.left = `${clamp(left, POPOVER_MARGIN_PX, W - w - POPOVER_MARGIN_PX)}px`;
  panel.style.top = `${below ? r.bottom + POPOVER_GAP_PX : r.top - POPOVER_GAP_PX - h}px`;
}

// The buttons and inputs a popover's arrow keys walk through (hidden ones are skipped).
function focusable(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>("button, input")].filter((el) => !el.hidden && !el.closest("[hidden]"));
}
// Arrow keys, Home and End move focus within a popover. Tab leaves it. Returns whether the key was used.
function moveFocus(key: string, list: HTMLElement[]): boolean {
  const i = list.indexOf(document.activeElement as HTMLElement);
  if (key === "ArrowDown") list[(i + 1) % list.length]?.focus();
  else if (key === "ArrowUp") list[(i + list.length - 1) % list.length]?.focus();
  else if (key === "Home") list[0]?.focus();
  else if (key === "End") list[list.length - 1]?.focus();
  else return false;
  return true;
}

interface Popover {
  button: HTMLElement;
  panel: HTMLElement;
  place(): void;
  open(): void;
  close(refocus?: boolean): void;
  toggle(): void;
}
const popovers: Popover[] = [];

function popover(button: HTMLElement, panel: HTMLElement): Popover {
  const self: Popover = {
    button, panel,
    place: () => placePopover(button, panel),
    open() {
      for (const other of popovers) if (other !== self) other.close();
      panel.hidden = false;
      self.place();
      button.setAttribute("aria-expanded", "true");
      focusable(panel)[0]?.focus();
    },
    close(refocus = false) {
      if (panel.hidden) return;
      panel.hidden = true;
      button.setAttribute("aria-expanded", "false");
      if (refocus) button.focus();
    },
    toggle() {
      if (panel.hidden) self.open();
      else self.close();
    },
  };
  button.addEventListener("click", self.toggle);
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Tab") {
      self.close();
      return;
    }
    if (moveFocus(e.key, focusable(panel))) e.preventDefault();
  });
  popovers.push(self);
  return self;
}

// ---- the popovers in use ----
export const exportMenu = byId("export-menu");
export const exportPopover = popover(byId("export-button"), exportMenu);
const mainMenu = popover(byId("menu-button"), byId("main-menu"));
// Open URL… closes the menu and shows the URL card over the scene (loader.ts).
byId("open-url").addEventListener("click", () => {
  mainMenu.close();
  showUrlForm();
});

// ---- the theme row of the ☰ menu ----
// Three segments, Auto, Light and Dark; the one in use is pressed. A key press (T) can change the choice while the menu
// is shut, so the segments are set again whenever it changes.
const themeSegments = [...document.querySelectorAll<HTMLButtonElement>("[data-theme-choice]")];
function showThemeChoice(choice: ThemeChoice): void {
  for (const segment of themeSegments) segment.setAttribute("aria-pressed", String(segment.dataset.themeChoice === choice));
}
function chooseFromSegment(segment: HTMLButtonElement): void {
  const choice = segment.dataset.themeChoice;
  if (isThemeChoice(choice)) setTheme(choice);
}
for (const segment of themeSegments) segment.addEventListener("click", () => chooseFromSegment(segment));
onThemeChange(showThemeChoice);
showThemeChoice(currentTheme());
// ---- the outline width row of the ☰ menu ----
// Thin, Normal and Bold, as the theme's segments work: the one in use is pressed.
const outlineSegments = [...document.querySelectorAll<HTMLButtonElement>("[data-outline-scale]")];
function showOutlineScale(scale: number): void {
  for (const segment of outlineSegments) segment.setAttribute("aria-pressed", String(Number(segment.dataset.outlineScale) === scale));
}
for (const segment of outlineSegments) {
  segment.addEventListener("click", () => chooseOutlineScale(Number(segment.dataset.outlineScale)));
}
onOutlineScaleChange(showOutlineScale);
showOutlineScale(outlineScale());
export const helpPopover = popover(byId("help-button"), byId("help"));

exportMenu.addEventListener("click", (e) => {
  const item = closestOf(e.target, "[data-export]");
  if (item) EXPORTS[item.dataset.export ?? ""]?.(item);
});
window.addEventListener("keydown", (e) => {
  const open = popovers.find((p) => !p.panel.hidden);
  if (e.key === "Escape" && open) {
    open.close(true);
    e.preventDefault();
  }
});
// A press outside a popover (and its button) closes it.
document.addEventListener("pointerdown", (e) => {
  for (const p of popovers) {
    const inside = p.panel.contains(e.target as Node) || p.button.contains(e.target as Node);
    if (!inside) p.close();
  }
});
window.addEventListener("resize", () => {
  for (const p of popovers) if (!p.panel.hidden) p.place();
});
