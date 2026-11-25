// The page's tabs. Every scene the page shows is a tab, whatever its source (scene/source.ts): the page's own scene, a
// scene the address names or a default, a file that is dropped or chosen, or the home tab, the start screen (ui/home.ts),
// which shows until a scene is opened from it. The first tab is shown at startup; the others load when first chosen.
// Whatever a load reports is shown as plain text.
import { fetchGist, fetchLive, fetchScene, fetchServedVersion } from "../scene/fetch";
import { sceneFromFile } from "../scene/read";
import { HOME, type Source, fromOf, linkOf, nameOf } from "../scene/source";
import type { Scene } from "../types";
import { setSceneLink, takePendingPose } from "./share";
import { signal } from "@preact/signals-core";
import { byId, pageName } from "./dom";
import { busy, fail, focusUrl, hideCard, showHome, wireHome } from "./home";
import { openScene, updateScene } from "./stage";
import { type TabHandlers, pulseTab, showTabs } from "./tab-bar";
import { addTab, chooseTab, closeTab, openTabs, tabsOf, uniqueLabel } from "./tab-model";

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

const fileInput = byId<HTMLInputElement>("scene-file");

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// What the loader keeps between events. `tabs` is the list and its current tab (the strip shows it: ui/tab-bar.ts);
// `loaderPage` is a page without an embedded scene, so it always has the strip and its + button (on a gemmy serve
// page, the way back to the served tab); `shown` is the tab whose scene is on the stage (null until one loads) and
// `servedVersion` the server's version of the live scene on the stage or being loaded (a status with this version has
// nothing to load). The live loads run one after another (`liveTurn`), so each compares the version with what the
// stage shows when its turn comes. `tabListeners` hear which tab is being shown, before it loads (live.ts shows the
// follow note with it).
const state = {
  tabs: tabsOf<Tab>([]),
  loaderPage: false,
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

// The tab that is shown (the list's current one), if the page has any.
const currentTab = (): Tab | undefined => state.tabs.tabs[state.tabs.current];
const currentIsHome = (): boolean => currentTab()?.source.kind === "home";

function homeTab(): Tab {
  return { label: nameOf(HOME), source: HOME, loaded: null };
}

// ---- loading ----
async function loadSource(source: Source): Promise<Loaded> {
  switch (source.kind) {
    case "home":
      throw new Error("the home tab has no scene to load");
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

// The home tab: the start screen over the stage. Its name is the page's title; a gemmy serve page lists its served
// scene (the live tab's name) first.
function showHomeTab(): void {
  state.shown = null;
  setSceneLink(null);
  pageName.value = { name: nameOf(HOME), from: fromOf(HOME) };
  document.title = "gemmy";
  const live = state.tabs.tabs.find((tab) => tab.source.kind === "live");
  showHome(live ? nameOf(live.source) : null);
}

// Shows the current tab's scene: the one path for every source. The shown scene goes on the stage, its title and line
// are set, and its link is the one Copy link gives. A tab that is no longer current when its load ends is not shown.
async function showCurrent(): Promise<void> {
  const tab = currentTab();
  if (!tab) return;
  for (const listener of state.tabListeners) listener(tab.source);
  if (tab.source.kind === "home") {
    showHomeTab();
    return;
  }
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
    pageName.value = { name: loaded.name, from: fromOf(tab.source) };
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
// Closing the last scene tab leaves the home tab.
function closeAt(k: number): Promise<void> {
  const wasCurrent = k === state.tabs.current;
  state.tabs = closeTab(state.tabs, k, homeTab());
  renderBar();
  return wasCurrent ? showCurrent() : Promise.resolve();
}

// ---- the tab bar ----
// The strip is needed on a loader page (its + is how a user gets to the start screen), with a second tab, or with the
// home tab. A gemmy view page with its one scene keeps its title instead.
function needsBar(): boolean {
  return state.loaderPage || state.tabs.tabs.length > 1 || state.tabs.tabs.some((tab) => tab.source.kind === "home");
}
// The page's own scene and a live scene are not closed from the strip. The home tab is closed while another tab remains
// (alone, it has nothing to leave); a scene tab can always be closed, and closing the last one leaves the home tab.
function isClosable(source: Source, many: boolean): boolean {
  if (source.kind === "home") return many;
  return source.kind !== "embedded" && source.kind !== "live";
}

// The strip's state for the tabs now (ui/tab-bar.ts draws it). The page's own link, if it has one, is tab 0.
function renderBar(): void {
  const many = state.tabs.tabs.length > 1;
  const handlers: TabHandlers = {
    choose: (k) => void choose(k),
    close: (k) => void closeAt(k),
    add: openHomeTab,
    own: () => {
      if (state.tabs.current !== 0) void choose(0);
    },
  };
  showTabs(
    state.tabs.tabs.map((tab) => ({
      label: tab.label,
      closable: isClosable(tab.source, many),
      home: tab.source.kind === "home",
    })),
    state.tabs.current,
    needsBar(),
    handlers,
  );
}

// The "+" button and New tab: the home tab, chosen when the page has one already; a new one pulses.
function openHomeTab(): void {
  const k = state.tabs.tabs.findIndex((tab) => tab.source.kind === "home");
  if (k >= 0) {
    void choose(k);
    return;
  }
  state.tabs = addTab(state.tabs, homeTab());
  renderBar();
  pulseTab(state.tabs.current);
  void showCurrent();
}

// ---- adding tabs ----
// A tab per source, labelled by its name made unique among the labels taken, so two files with the same name stay
// apart in the bar.
function tabsFor(sources: readonly Source[], taken: readonly string[]): Tab[] {
  const labels = [...taken];
  return sources.map((source) => {
    const label = uniqueLabel(nameOf(source), labels);
    labels.push(label);
    return { label, source, loaded: null };
  });
}

// Opens sources as tabs: in place of the home tab when it is the current one, else at the end. The first of them is
// shown.
function openSources(sources: readonly Source[]): void {
  const tabs = tabsFor(
    sources,
    state.tabs.tabs.map((tab) => tab.label),
  );
  state.tabs = openTabs(state.tabs, tabs, currentIsHome());
  renderBar();
  pulseTab(state.tabs.current);
  void showCurrent();
}

// The page's tabs at startup. `read` gives the page's sources, or throws when the address is bad (the message goes on
// the start screen). No sources: the home tab alone.
// Resolves once the first tab is shown (its scene drawn, or the start screen).
export async function startTabs(read: () => Promise<Source[]>): Promise<void> {
  let sources: Source[] = [];
  let problem: string | null = null;
  try {
    sources = await read();
  } catch (error) {
    problem = messageOf(error);
  }
  const opening = sources.length > 0 ? sources : [HOME];
  state.loaderPage = !opening.some((source) => source.kind === "embedded");
  state.tabs = openTabs(tabsOf<Tab>([]), tabsFor(opening, []), false);
  renderBar();
  if (problem !== null) fail(problem);
  await showCurrent();
}

// The ☰ menu's Open local file…: the file picker, the same one the start screen's button opens.
export function openSceneFile(): void {
  fileInput.click();
}

// Why New tab is unavailable on this page (a gemmy serve page has no loader for an address), or null when it is.
export const openUrlUnavailable = signal<string | null>(null);

// New tab in the ☰ menu: the home tab, with its address box focused.
export function openNewTab(): void {
  openHomeTab();
  focusUrl();
}

// Drop a file anywhere on the page, the file input from the ☰ menu or the start screen's button, and the start screen's
// forms and gallery (ui/home.ts).
export function attachOpeners(): void {
  wireHome({
    openSource: (source) => openSources([source]),
    openFile: () => fileInput.click(),
    openServed: () => {
      const k = state.tabs.tabs.findIndex((tab) => tab.source.kind === "live");
      if (k >= 0) void choose(k);
    },
  });
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
    openFiles(Array.from(event.dataTransfer?.files ?? []));
  });
  fileInput.addEventListener("change", () => {
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = ""; // so choosing the same file again still fires
    openFiles(files);
  });
}

// Files the user dropped or chose: a tab each.
function openFiles(files: File[]): void {
  if (files.length === 0) return;
  openSources(files.map((file): Source => ({ kind: "file", file })));
}
