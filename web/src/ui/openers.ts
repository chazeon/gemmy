// The page's openers: a file dropped anywhere on the page, the file input (the start screen's Open file…, and the start
// screen's button), and the start screen's forms and gallery (ui/home.ts). Each one hands its sources to the loader
// (ui/loader.ts), which opens them as tabs.
import { compilerMeta } from "../scene/compiler";
import { sourcesOf } from "../scene/drop";
import type { Source } from "../scene/source";
import { byId } from "./dom";
import { wireHome } from "./home";
import { allowOpen } from "./open-files";

// The file types a page accepts when it cannot compile: scene files only.
const SCENE_ACCEPT = ".json,.gz,application/json,application/gzip";

const fileInput = byId<HTMLInputElement>("scene-file");

// What the openers ask of the loader: open sources as tabs, and show the served tab.
export interface OpenerHost {
  openSources(sources: readonly Source[]): void;
  openServed(): void;
}

// Drop a file anywhere on the page, the file input from the start screen's Open file…, and the start screen's
// forms and gallery (ui/home.ts).
export function attachOpeners(host: OpenerHost): void {
  // A page that compiles takes any file (a POSCAR has no extension to filter by); one that cannot takes scene files.
  fileInput.multiple = true;
  fileInput.accept = compilerMeta() === null ? SCENE_ACCEPT : "";
  wireHome({
    openSource: (source) => host.openSources([source]),
    openFile: () => fileInput.click(),
    openServed: () => host.openServed(),
  });
  // With the open-other-files flag off (ui/open-files.ts) the page is no drop target: no outline, and a drop is ignored.
  window.addEventListener("dragover", (event) => {
    if (!allowOpen.value) return;
    event.preventDefault();
    document.body.classList.add("dragging");
  });
  window.addEventListener("dragleave", (event) => {
    if (event.relatedTarget === null) document.body.classList.remove("dragging");
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault(); // the browser never opens a dropped file itself
    document.body.classList.remove("dragging");
    openFiles(Array.from(event.dataTransfer?.files ?? []), host);
  });
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = ""; // so choosing the same file again still fires
    openFiles(files, host);
  });
}

// Files the user dropped or chose: a tab each (scene files, or structures with their sidecars: scene/drop.ts). Off with the
// open-other-files flag (ui/open-files.ts), whatever asked for them.
function openFiles(files: File[], host: OpenerHost): void {
  if (!allowOpen.value || files.length === 0) return;
  host.openSources(sourcesOf(files));
}
