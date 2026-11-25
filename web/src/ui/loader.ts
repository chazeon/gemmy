// The page's tabs and the card that opens scenes. Every scene the page shows is a tab, whatever its source
// (scene/source.ts): the page's own scene, a scene the address names or a default, a file that is dropped or
// chosen (Open scene…). The first tab is shown at startup; the others load when first chosen. Whatever a load
// reports is shown as plain text.
import { fetchGist, fetchLive, fetchScene, fetchServedVersion } from "../scene/fetch";
import { sceneFromFile } from "../scene/read";
import { type Source, fromOf, linkOf, nameOf, resolveWebUrl } from "../scene/source";
import type { Scene } from "../types";
import { hasScene } from "../state";
import { setSceneLink, takePendingPose } from "./share";
import { byId, pageName } from "./dom";
import { openScene, updateScene } from "./stage";
import { type TabBar, makeBar, renderTabs } from "./tab-bar";
import { addTab, chooseTab, closeTab, tabsOf, uniqueLabel } from "./tab-model";

// A tab: its label in the bar, its source, and the scene once loaded (kept, so choosing the tab again does not load
// it).
interface Tab {
  label: string;
  source: Source;
  loaded: Promise<Loaded> | null;
}
// A loaded scene and the title it is shown under (a gist's title is its file, which only the load knows).
interface Loaded {
  doc: Scene;
  name: string;
}

// A load that takes longer than this shows the card's "Loading…" text; a quicker one does not flash the card.
const PROGRESS_MS = 150;

const empty = byId("empty"),
  emptyStatus = byId("empty-status"),
  emptyError = byId("empty-error");
const urlForm = byId<HTMLFormElement>("empty-url"),
  urlInput = byId<HTMLInputElement>("scene-url");
const fileInput = byId<HTMLInputElement>("scene-file");
const closeButton = byId("empty-close");

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// What the loader keeps between events. `tabs` is the list and its current tab; `bar` is the strip that shows it (null
// until a second tab, or a server-built strip, is there); `shown` is the tab whose scene is on the stage (null until
// one loads) and `servedVersion` the server's version of the live scene on the stage or being loaded (a status with
// this version has nothing to load). The live loads run one after another (`liveTurn`), so each compares the version
// with what the stage shows when its turn comes. `tabListeners` hear which tab is being shown, before it loads
// (live.ts shows the follow note with it).
const state = {
  tabs: tabsOf<Tab>([]),
  bar: null as TabBar | null,
  shown: null as Tab | null,
  servedVersion: null as string | null,
  liveTurn: Promise.resolve(),
  tabListeners: [] as ((source: Source) => void)[],
};

function inLiveTurn<T>(task: () => Promise<T>): Promise<T> {
  const result = state.liveTurn.then(task);
  state.liveTurn = result.then(
    () => undefined,
    () => undefined,
  ); // a failed load does not stop the ones after it
  return result;
}
export function onTabChange(listener: (source: Source) => void): void {
  state.tabListeners.push(listener);
}

// ---- the empty state and the messages under it ----
function showCard(): void {
  empty.hidden = false;
  closeButton.hidden = !hasScene();
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
async function loadSource(source: Source): Promise<Loaded> {
  switch (source.kind) {
    case "embedded":
      return { doc: source.doc, name: nameOf(source) };
    case "live":
      // The version is noted before the scene is read, so the scene is at least that version, and a status that comes
      // while it loads (with another version) loads again.
      state.servedVersion = await fetchServedVersion();
      return { doc: await fetchLive(), name: nameOf(source) };
    case "url":
      return { doc: await fetchScene(source.url), name: nameOf(source) };
    case "gist": {
      const { name, doc } = await fetchGist(source.id, source.file);
      return { doc, name };
    }
    case "file":
      return { doc: await sceneFromFile(source.file), name: nameOf(source) };
  }
}

// A tab's scene: loaded once and kept, and a failed load is cleared so choosing the tab tries again. A live scene is
// never kept: the server may have a newer one by the time its tab is chosen.
function loadTab(tab: Tab): Promise<Loaded> {
  if (tab.source.kind === "live") return inLiveTurn(() => loadSource(tab.source));
  tab.loaded ??= loadSource(tab.source).catch((error: unknown) => {
    tab.loaded = null;
    throw error;
  });
  return tab.loaded;
}

// The tab that is shown (the list's current one), if the page has any.
const currentTab = (): Tab | undefined => state.tabs.tabs[state.tabs.current];

// Shows the current tab's scene: the one path for every source. The shown scene goes on the stage, its title and line
// are set, and its link is the one Copy link gives. A tab that is no longer current when its load ends is not shown.
async function showCurrent(): Promise<void> {
  const tab = currentTab();
  if (!tab) return;
  for (const listener of state.tabListeners) listener(tab.source);
  const progress = setTimeout(() => {
    if (tab === currentTab()) busy(`Loading ${nameOf(tab.source)}…`);
  }, PROGRESS_MS);
  try {
    const loaded = await loadTab(tab);
    clearTimeout(progress);
    if (tab !== currentTab()) return;
    openScene(loaded.doc, takePendingPose());
    state.shown = tab;
    setSceneLink(linkOf(tab.source, location.href));
    pageName.show(loaded.name, fromOf(tab.source));
    document.title = `gemmy: ${loaded.name}`;
    hideCard();
  } catch (error) {
    clearTimeout(progress);
    if (tab === currentTab()) fail(`Could not load ${nameOf(tab.source)}: ${messageOf(error)}`);
  }
}

// gemmy serve reports a version (on its status): when the live tab is the one on the stage and the version is not the
// one on the stage, the scene is loaded in place. Otherwise, or with no version, nothing happens. When the live tab is
// current but not on the stage (no scene yet, or a file is shown, or its last load failed), it is opened the usual way
// (not awaited: the turn it would wait for is this one).
export function reloadLive(version: string | null | undefined): Promise<void> {
  return inLiveTurn(async () => {
    const tab = currentTab();
    if (!version || tab?.source.kind !== "live" || version === state.servedVersion) return;
    if (tab !== state.shown) {
      void showCurrent();
      return;
    }
    const loaded = await loadSource(tab.source);
    if (tab === currentTab()) updateScene(loaded.doc);
  });
}

function choose(k: number): Promise<void> {
  state.tabs = chooseTab(state.tabs, k);
  renderBar();
  return showCurrent();
}

// Closing a tab that is shown brings up the one before it; closing another leaves the scene on the stage as it is.
function closeAt(k: number): Promise<void> {
  const wasCurrent = k === state.tabs.current;
  state.tabs = closeTab(state.tabs, k);
  renderBar();
  return wasCurrent ? showCurrent() : Promise.resolve();
}

// ---- the tab bar ----
function renderBar(): void {
  if (state.bar === null) return;
  const many = state.tabs.tabs.length > 1;
  renderTabs(
    state.bar,
    state.tabs.tabs.map((tab) => ({ label: tab.label, closable: many && tab.source.kind === "file" })),
    state.tabs.current,
    { choose: (k) => void choose(k), close: (k) => void closeAt(k) },
  );
}

// The tab strip, made when the page has more than one tab. Its own link (a server-built strip) chooses tab 0.
function ensureBar(): void {
  state.bar ??= makeBar(() => {
    if (state.tabs.current !== 0) void choose(0);
  });
}

// ---- adding tabs ----
// A tab per source, labelled by its name made unique among the labels in the bar, so two files with the same name
// stay apart. The list's current tab is the last one added.
function addSources(sources: readonly Source[]): void {
  for (const source of sources) {
    const label = uniqueLabel(
      nameOf(source),
      state.tabs.tabs.map((tab) => tab.label),
    );
    state.tabs = addTab(state.tabs, { label, source, loaded: null });
  }
}

// Files the user dropped or chose: a tab each, and the last one is shown.
function addFiles(files: File[]): void {
  if (files.length === 0) return;
  ensureBar();
  addSources(files.map((file): Source => ({ kind: "file", file })));
  void choose(state.tabs.tabs.length - 1);
}

// The page's tabs at startup. `read` gives the page's sources; it runs here, so a bad address is said under the card.
// No sources: the empty card. Several: they are tabs from the start, and the first is shown at once.
export function startTabs(read: () => Source[]): void {
  let sources: Source[];
  try {
    sources = read();
  } catch (error) {
    fail(messageOf(error));
    return;
  }
  if (sources.length === 0) {
    showCard();
    return;
  }
  state.tabs = tabsOf([]);
  addSources(sources);
  if (state.tabs.tabs.length > 1) ensureBar();
  void choose(0);
}

// The ☰ menu's Open URL…: the card with its URL input focused, over the scene that stays behind it. On the
// empty page there is nothing behind the card, so it has no close control (showCard hides it).
export function showUrlForm(): void {
  showCard();
  urlInput.focus();
}
// Closes the card back to the scene behind it. Returns whether it did, so Esc knows it was used. On the empty page
// (no scene behind) it does nothing and returns false.
export function closeUrlForm(): boolean {
  if (empty.hidden || !hasScene()) return false;
  hideCard();
  return true;
}

// Drop a file anywhere on the page, the file input from the ☰ menu or the empty state's button. Also the URL form in
// the empty state, which opens the page again with ?scene= for the URL (so the address shows what is open).
export function attachOpeners(): void {
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
