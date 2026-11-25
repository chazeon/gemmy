// Opening a scene that the page does not embed: from ?scene= or ?gist= in the address, from the page's default scene
// (the built site's example pages), from a URL typed into the empty state, or from a file (dropped on the page, or the ☰
// menu's Open scene…). A file is read here and never uploaded. Whatever a load reports is shown as plain text.
import { fetchGist, fetchScene } from "../scene/fetch";
import { type Opening, type SceneSource, linkFor, resolveWebUrl, sourceName, sourcesToOpen, tabLabel } from "../scene/source";
import { sceneFromFile } from "../scene/read";
import type { Scene } from "../types";
import { byId } from "./dom";

// What a page shows for a scene: the scene, its name (the title), where it came from (under the title) and the address
// that opens it again (null for a file, which no link can carry).
export interface Shown {
  doc: Scene;
  name: string;
  from: string;
  link: string | null;
}
export type Show = (shown: Shown) => void;

const empty = byId("empty"), emptyStatus = byId("empty-status"), emptyError = byId("empty-error");
const urlForm = byId<HTMLFormElement>("empty-url"), urlInput = byId<HTMLInputElement>("scene-url");
const fileInput = byId<HTMLInputElement>("scene-file");
const closeButton = byId("empty-close");

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Whether a scene is on the stage (behind the card). Only then can the card close back to it.
let sceneOpen = false;

// ---- the empty state and the messages under it ----
function showCard(): void {
  empty.hidden = false;
  closeButton.hidden = !sceneOpen;
  document.body.classList.add("no-scene");
}
function hideCard(): void {
  empty.hidden = true;
  emptyStatus.textContent = "";
  emptyError.hidden = true;
  document.body.classList.remove("no-scene");
}
function busy(text: string): void {
  showCard();
  emptyError.hidden = true;
  emptyStatus.textContent = text;
}
function fail(text: string): void {
  showCard();
  emptyStatus.textContent = "";
  emptyError.textContent = text;
  emptyError.hidden = false;
}

// ---- loading ----
function labelOf(source: SceneSource): string {
  return source.kind === "gist" ? `gist ${source.id}` : source.url;
}
async function loadSource(source: SceneSource, byDefault: boolean): Promise<Shown> {
  const link = linkFor(source, byDefault, location.href);
  if (source.kind === "gist") {
    const { name, doc } = await fetchGist(source.id, source.file);
    return { doc, name, from: labelOf(source), link };
  }
  return { doc: await fetchScene(source.url), name: sourceName(source.url), from: source.url, link };
}

// Shows a loaded scene, or says what failed (the load or the drawing) under the card, naming what was asked for.
async function present(label: string, loading: () => Promise<Shown>, show: Show): Promise<void> {
  busy(`Loading ${label}…`);
  try {
    show(await loading());
    sceneOpen = true;
    hideCard();
  } catch (error) {
    fail(`Could not load ${label}: ${messageOf(error)}`);
  }
}

function fromFile(file: File, show: Show): Promise<void> {
  return present(file.name, async () => ({ doc: await sceneFromFile(file), name: file.name, from: "local file", link: null }), show);
}

// The page's default scenes: one gemmy-default-scene meta per scene, in document order.
function defaultScenes(): string[] {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="gemmy-default-scene"]')]
    .map((meta) => meta.content)
    .filter((scene) => scene !== "");
}

export function startLoader(show: Show): void {
  let openings: Opening[];
  try {
    openings = sourcesToOpen(location.search, location.href, defaultScenes());
  } catch (error) {
    fail(messageOf(error));
    return;
  }
  if (openings.length === 0) {
    showCard();
  } else if (openings.length === 1) {
    const [only] = openings;
    void present(labelOf(only.source), () => loadSource(only.source, only.byDefault), show);
  } else {
    openTabs(openings, show);
  }
}

// Several scenes as tabs in the title bar, in the look of the built site's tabs. Each scene loads once, when its tab is
// first chosen; the first tab is chosen at once.
function openTabs(openings: Opening[], show: Show): void {
  const bar = document.createElement("nav");
  bar.className = "tabs";
  bar.setAttribute("aria-label", "Scenes");
  const loaded = new Map<number, Shown>();
  const buttons = openings.map(({ source }, k) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = tabLabel(source);
    button.addEventListener("click", () => choose(k));
    bar.appendChild(button);
    return button;
  });
  const choose = (k: number): void => {
    buttons.forEach((button, j) => {
      if (j === k) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
    const { source, byDefault } = openings[k];
    void present(labelOf(source), async () => {
      const shown = loaded.get(k) ?? (await loadSource(source, byDefault));
      loaded.set(k, shown);
      return shown;
    }, show);
  };
  byId("menu-island").insertBefore(bar, document.querySelector(".name"));
  choose(0);
}

// The ☰ menu's Open URL…: the card with its URL input focused, over the scene that stays behind it. On the empty page
// there is nothing behind the card, so it has no close control (showCard hides it).
export function showUrlForm(): void {
  showCard();
  urlInput.focus();
}
// Closes the card back to the scene behind it. Returns whether it did, so Esc knows it was used. On the empty page
// (no scene behind) it does nothing and returns false.
export function closeUrlForm(): boolean {
  if (empty.hidden || !sceneOpen) return false;
  hideCard();
  return true;
}

// Drop a file anywhere on the page, the file input from the ☰ menu or the empty state's button. Also the URL form in the
// empty state, which opens the page again with ?scene= for the URL (so the address shows what is open).
export function attachOpeners(show: Show): void {
  closeButton.addEventListener("click", () => closeUrlForm());
  window.addEventListener("dragover", (event) => {
    event.preventDefault();
    document.body.classList.add("dragging");
  });
  window.addEventListener("dragleave", (event) => {
    if (event.relatedTarget === null) document.body.classList.remove("dragging");
  });
  window.addEventListener("drop", (event) => {
    event.preventDefault();
    document.body.classList.remove("dragging");
    const file = event.dataTransfer?.files[0];
    if (file) void fromFile(file, show);
  });
  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    fileInput.value = ""; // so choosing the same file again still fires
    if (file) void fromFile(file, show);
  });
  byId("open-scene").addEventListener("click", () => fileInput.click());
  byId("empty-open").addEventListener("click", () => fileInput.click());
  urlForm.addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const url = resolveWebUrl(urlInput.value, location.href);
      location.search = new URLSearchParams({ scene: url }).toString();
    } catch (error) {
      fail(messageOf(error));
    }
  });
}
