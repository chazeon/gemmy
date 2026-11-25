// The Export menu's actions: the PNG and SVG pictures, and the render settings (saved as TOML or JSON, or copied with
// the render command). Each action is an entry of EXPORTS, keyed by its button's data-export name; a feature adds an
// item of its own with registerExport (ui/live.ts does for the serve page's render item).
import { renderer, scene, stage } from "../render/draw";
import { buildTracedSvg } from "../trace/traced";
import { exportView, renderCommand, settingsJson, settingsToml } from "../export/settings";
import { drawTriad } from "../render/triad";
import { renderTriad } from "../render/triad3d";
import { pageCamera } from "../camera/view";
import { camera, loaded, outlines, requestRender, showAtoms, showBox } from "../state";
import { outlineScale } from "./outline-scale";
import { byId } from "./dom";

const PNG_SCALE = 2; // the PNG is twice the window in each direction, whatever the screen's own pixel ratio
const KB = 1024;
const DOWNLOAD_REVOKE_MS = 10000; // a blob URL is kept this long, so the browser has started the download
const DEFAULT_SCENE_FILE = "scene.json";

// The view as the render settings describe it (camera, zoom, target, box and lens).
export const currentView = () =>
  exportView({
    ...pageCamera(),
    centre: loaded.value.centre,
    box: showBox.value,
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
    navigator.clipboard.writeText(text).then(() => {
      exportText.hidden = true;
      say(`Copied ${what}.`);
    }, fallback);
  } catch {
    fallback();
  }
}

// ---- the image and vector exports ----
// The PNG is drawn by the renderer at PNG_SCALE, with the 3D triad in its corner, then the letters on top; the page
// background fills it unless transparent.
function exportPng(transparent: boolean) {
  const w = stage.clientWidth,
    h = stage.clientHeight,
    ratio = renderer.getPixelRatio();
  renderer.setPixelRatio(PNG_SCALE);
  renderer.setSize(w, h);
  renderer.render(scene, camera.value);
  renderTriad(transparent);
  const out = document.createElement("canvas");
  out.width = w * PNG_SCALE;
  out.height = h * PNG_SCALE;
  const ctx = out.getContext("2d") as CanvasRenderingContext2D;
  if (!transparent) {
    ctx.fillStyle = getComputedStyle(document.body).backgroundColor;
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.drawImage(renderer.domElement, 0, 0); // same task as the render, so the buffer is still valid
  ctx.drawImage(triadAt(PNG_SCALE, transparent), 0, 0);
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
function triadAt(scale: number, transparent: boolean): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  drawTriad(canvas, canvas.getContext("2d") as CanvasRenderingContext2D, scale, transparent);
  return canvas;
}

// The SVG export (trace/traced.ts): the same view, drawn from the GPU's object ids.
function exportSvg() {
  const { data } = loaded.value;
  if (!data) {
    say("Load a scene first: there is no scene on show to export.", true);
    return;
  }
  const boxColor = getComputedStyle(document.documentElement).getPropertyValue("--box").trim();
  let result: ReturnType<typeof buildTracedSvg>;
  try {
    result = buildTracedSvg({
      data,
      centre: loaded.value.centre,
      extent: loaded.value.extent,
      ...pageCamera(),
      show: { atoms: showAtoms.value, box: showBox.value },
      outlines: outlines.value,
      outlineScale: outlineScale.value,
      lattice: loaded.value.lattice.map((v) => v.toArray()),
      boxColor,
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
  say(
    `Saved view.svg (${Math.round(result.text.length / KB)} kB, ${result.paths} paths, ${Math.round(result.ms)} ms).`,
  );
}

function sceneFileName(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="gemmy-scene-file"]');
  return meta?.content || DEFAULT_SCENE_FILE;
}

// ---- the menu's items ----
type ExportRun = (item?: HTMLElement) => unknown;
const EXPORTS = new Map<string, ExportRun>([
  ["svg", exportSvg],
  ["png", () => exportPng(byId<HTMLInputElement>("png-transparent").checked)],
  ["save-toml", () => saveFile("render-settings.toml", "application/toml", settingsToml(currentView()))],
  ["save-json", () => saveFile("render-settings.json", "application/json", settingsJson(currentView()))],
  ["copy-toml", () => copyText(settingsToml(currentView()), "the TOML settings")],
  ["copy-json", () => copyText(settingsJson(currentView()), "the JSON settings")],
  ["copy-command", () => copyText(renderCommand(currentView(), sceneFileName()), "the command")],
]);

// Adds an item to the menu, under its data-export name.
export function registerExport(name: string, run: ExportRun): void {
  EXPORTS.set(name, run);
}
// Runs the item with this data-export name (a name with no item does nothing).
export function runExport(name: string | undefined, item: HTMLElement): void {
  EXPORTS.get(name ?? "")?.(item);
}
