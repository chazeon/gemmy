// The Export menu's actions: the PNG and SVG pictures, and the render settings (saved as TOML or JSON, or copied with
// the render command). The menu (src/react/export-menu.tsx) runs one by its name; each action says what happened in the
// page's toast (ui/toast.ts). Two signals hold what the menu shows: the text the clipboard refused (a dialog to copy it
// by hand), and the serve page's Render item (set by ui/live.ts).
import { signal } from "@preact/signals-core";
import { renderer, scene, stage } from "../render/draw";
import { buildTracedSvg } from "../trace/traced";
import { exportView, renderCommand, settingsJson, settingsToml } from "../export/settings";
import { drawTriad } from "../render/triad";
import { renderTriad } from "../render/triad3d";
import { pageCamera } from "../camera/view";
import { camera, loaded, outlines, requestRender, showAtoms, showBox } from "../state";
import { outlineScale } from "./outline-scale";
import { note } from "./toast";

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

// The text the clipboard refused: the menu shows it in a dialog, selected, for the user to copy.
export const copyFallback = signal<{ text: string; what: string } | null>(null);
// The serve page's Render item: its action, when the server has Blender set up (ui/live.ts), else null.
export const renderView = signal<(() => void) | null>(null);

// ---- saving and copying ----
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
  note(`Saved ${name}.`);
}

// Copy inside the click (browsers only allow it there); when the clipboard refuses, the dialog shows the text instead.
function copyText(text: string, what: string) {
  const refused = () => {
    copyFallback.value = { text, what };
    note(`Could not use the clipboard: ${what} is shown, press Ctrl/Cmd+C to copy it.`);
  };
  try {
    navigator.clipboard.writeText(text).then(() => note(`Copied ${what}.`), refused);
  } catch {
    refused();
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
      note(`Saved view.png (${out.width} × ${out.height}).`);
    } else {
      note("The browser could not make the PNG.");
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
    note("Load a scene first: there is no scene on show to export.");
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
    note(`The SVG export failed: ${error instanceof Error ? error.message : String(error)}`);
    return;
  } finally {
    requestRender(); // the passes drew into the GPU's buffers: the live view is redrawn either way
  }
  download("view.svg", new Blob([result.text], { type: "image/svg+xml" }));
  if (result.paths === 0) {
    note("Saved view.svg, but nothing in this view is visible: the file has no shapes.");
    return;
  }
  note(
    `Saved view.svg (${Math.round(result.text.length / KB)} kB, ${result.paths} paths, ${Math.round(result.ms)} ms).`,
  );
}

function sceneFileName(): string {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="gemmy-scene-file"]');
  return meta?.content || DEFAULT_SCENE_FILE;
}

// ---- the menu's actions ----
export type ExportAction =
  | "png"
  | "svg"
  | "save-toml"
  | "save-json"
  | "copy-toml"
  | "copy-json"
  | "copy-command"
  | "render-view";

// Runs one action of the menu. The PNG takes whether its background is transparent.
export function runExport(action: ExportAction, options: { transparent?: boolean } = {}): void {
  switch (action) {
    case "png":
      exportPng(options.transparent ?? true);
      return;
    case "svg":
      exportSvg();
      return;
    case "save-toml":
      saveFile("render-settings.toml", "application/toml", settingsToml(currentView()));
      return;
    case "save-json":
      saveFile("render-settings.json", "application/json", settingsJson(currentView()));
      return;
    case "copy-toml":
      copyText(settingsToml(currentView()), "the TOML settings");
      return;
    case "copy-json":
      copyText(settingsJson(currentView()), "the JSON settings");
      return;
    case "copy-command":
      copyText(renderCommand(currentView(), sceneFileName()), "the command");
      return;
    case "render-view":
      renderView.peek()?.();
      return;
  }
}
