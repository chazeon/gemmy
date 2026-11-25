// Opening a scene that the page does not embed: from ?scene= or ?gist= in the address, from the page's default scenes
// (the built site's example pages and front page), from a URL typed into the empty state, or from a file (dropped on the
// page, or the ☰ menu's Open scene…). A file is read here and never uploaded. Each scene the page shows is a tab (the
// list is plain data in tab-model.ts); a file that is dropped or opened is added as a tab of its own. Whatever a load
// reports is shown as plain text.
import { fetchGist, fetchScene } from "../scene/fetch";
import { type Opening, type SceneSource, linkFor, resolveWebUrl, sceneName, sourcesToOpen } from "../scene/source";
import { sceneFromFile } from "../scene/read";
import type { Scene } from "../types";
import { byId } from "./dom";
import { watchOverflow } from "./overflow";
import { type TabList, addTab, chooseTab, closeTab, tabsOf, uniqueLabel } from "./tab-model";

// What a page shows for a scene: the scene, its name (the title), where it came from (under the title) and the address
// that opens it again (null for a file, which no link can carry). `live` marks the page's own scene on a gemmy serve
// page: the page follows the server while it is the one shown.
export interface Shown {
  doc: Scene;
  name: string;
  from: string;
  link: string | null;
  live?: boolean;
}
export type Show = (shown: Shown) => void;

// A scene the page shows itself (embedded in the page, or live from gemmy serve): its tab, first in the bar.
export interface OwnScene {
  label: string;
  load: () => Promise<Shown>;
}

// A tab: its label in the bar, what it loads (for a message), whether the user added it (a file, which can be closed),
// and the load itself. The shown scene is kept once loaded, so choosing the tab again does not load it again.
interface ClientTab {
  label: string;
  what: string;
  local: boolean;
  load: () => Promise<Shown>;
  loaded: Promise<Shown> | null;
}

const empty = byId("empty"), emptyStatus = byId("empty-status"), emptyError = byId("empty-error");
const urlForm = byId<HTMLFormElement>("empty-url"), urlInput = byId<HTMLInputElement>("scene-url");
const fileInput = byId<HTMLInputElement>("scene-file");
const closeButton = byId("empty-close");

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// Whether a scene is on the stage (behind the card). Only then can the card close back to it.
let sceneOpen = false;

// The tabs and the strip that shows them. The strip is the page's own when it has one (a server-built strip, whose link
// to the page's own scene is `ownLink`), else one made above the page's name when the first tab is added.
let showScene: Show = () => {};
let tabs: TabList<ClientTab> = tabsOf([]);
let bar: HTMLElement | null = null;
let ownLink: HTMLAnchorElement | null = null;

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
  return { doc: await fetchScene(source.url), name: sceneName(source), from: source.url, link };
}
async function readFile(file: File): Promise<Shown> {
  return { doc: await sceneFromFile(file), name: file.name, from: "local file", link: null };
}

// Shows a loaded scene, or says what failed (the load or the drawing) under the card, naming what was asked for.
async function present(what: string, loading: () => Promise<Shown>, show: Show): Promise<void> {
  busy(`Loading ${what}…`);
  try {
    show(await loading());
    sceneOpen = true;
    hideCard();
  } catch (error) {
    fail(`Could not load ${what}: ${messageOf(error)}`);
  }
}

// ---- the tabs ----
function tabFor(label: string, what: string, local: boolean, load: () => Promise<Shown>): ClientTab {
  return { label, what, local, load, loaded: null };
}

// The tab's shown scene, loaded once. A failed load is cleared, so choosing the tab again tries it again.
function loadOnce(tab: ClientTab): Promise<Shown> {
  tab.loaded ??= tab.load().catch((error: unknown) => {
    tab.loaded = null;
    throw error;
  });
  return tab.loaded;
}

function showCurrent(): Promise<void> {
  const tab = tabs.tabs[tabs.current];
  return present(tab.what, () => loadOnce(tab), showScene);
}

function choose(k: number): Promise<void> {
  tabs = chooseTab(tabs, k);
  renderBar();
  return showCurrent();
}

// Closing a tab that is shown brings up the one before it; closing another leaves the scene on the stage as it is.
function closeAt(k: number): Promise<void> {
  const wasCurrent = k === tabs.current;
  tabs = closeTab(tabs, k);
  renderBar();
  return wasCurrent ? showCurrent() : Promise.resolve();
}

// The strip's tab buttons are rebuilt from the list. A server-built strip keeps its links: the page's own scene is
// its link (tab 0), so that tab has no button of its own there, and the link is current only while that scene is shown.
function renderBar(): void {
  const strip = bar;
  if (strip === null) return;
  strip.querySelectorAll(".local-tab").forEach((element) => element.remove());
  tabs.tabs.forEach((tab, k) => {
    if (k !== 0 || ownLink === null) strip.appendChild(tabElement(tab, k));
  });
  if (ownLink !== null) {
    if (tabs.current === 0) ownLink.setAttribute("aria-current", "page");
    else ownLink.removeAttribute("aria-current");
  }
  watchOverflow(strip);
  strip.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

// A tab as the strip shows it: its button, and for a file a ✕ while another tab remains (the last tab stays).
function tabElement(tab: ClientTab, k: number): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "local-tab";
  const choice = document.createElement("button");
  choice.type = "button";
  choice.textContent = tab.label;
  if (k === tabs.current) choice.setAttribute("aria-current", "page");
  choice.addEventListener("click", () => void choose(k));
  wrap.appendChild(choice);
  if (tab.local && tabs.tabs.length > 1) wrap.appendChild(tabCloseButton(tab, k));
  return wrap;
}

// The ✕ icon is the Lucide x, a constant string (never user text).
const CLOSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>';
function tabCloseButton(tab: ClientTab, k: number): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tab-close";
  button.title = `Close ${tab.label}`;
  button.setAttribute("aria-label", `Close ${tab.label}`);
  button.innerHTML = CLOSE_ICON;
  button.addEventListener("click", () => void closeAt(k));
  return button;
}

// The tab strip, made above the page's name (the name is hidden behind the strip, as on a server-built strip).
function ensureBar(): void {
  if (bar !== null) return;
  const built = document.querySelector<HTMLElement>(".tabs");
  if (built) {
    bar = built;
    ownLink = built.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
    // Its own scene is tab 0 here: choosing it does not navigate, the other links still do.
    ownLink?.addEventListener("click", (event) => {
      event.preventDefault();
      if (tabs.current !== 0) void choose(0);
    });
    return;
  }
  const nav = document.createElement("nav");
  nav.className = "tabs";
  nav.setAttribute("aria-label", "Scenes");
  byId("menu-island").insertBefore(nav, document.querySelector(".name"));
  bar = nav;
}

// Files the user dropped or chose: a tab each, labelled with the file name (made unique), and the last one is shown.
function addFiles(files: File[]): void {
  if (files.length === 0) return;
  ensureBar();
  for (const file of files) {
    const label = uniqueLabel(file.name, tabs.tabs.map((tab) => tab.label));
    tabs = addTab(tabs, tabFor(label, file.name, true, () => readFile(file)));
  }
  void choose(tabs.tabs.length - 1);
}

// The page's default scenes: one gemmy-default-scene meta per scene, in document order.
function defaultScenes(): string[] {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="gemmy-default-scene"]')]
    .map((meta) => meta.content)
    .filter((scene) => scene !== "");
}

export function startLoader(open: Show): void {
  showScene = open;
  let openings: Opening[];
  try {
    openings = sourcesToOpen(location.search, location.href, defaultScenes());
  } catch (error) {
    fail(messageOf(error));
    return;
  }
  if (openings.length === 0) {
    showCard();
    return;
  }
  // Several scenes are tabs from the start; the first is shown at once, and each loads when its tab is first chosen.
  tabs = tabsOf(openings.map(({ source, byDefault }) =>
    tabFor(sceneName(source), labelOf(source), false, () => loadSource(source, byDefault))));
  if (tabs.tabs.length > 1) ensureBar();
  void choose(0);
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
// empty state, which opens the page again with ?scene= for the URL (so the address shows what is open). `own` is the
// scene the page shows itself, if any: its tab comes first.
export function attachOpeners(open: Show, own: OwnScene | null): void {
  showScene = open;
  if (own) tabs = tabsOf([tabFor(own.label, own.label, false, own.load)]);
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
    addFiles(Array.from(event.dataTransfer?.files ?? []));
  });
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = ""; // so choosing the same file again still fires
    addFiles(files);
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
