// The page's tabs. Every scene the page shows is a tab, whatever its source (scene/source.ts): the page's own scene, a
// scene the address names, a file that is dropped or chosen, or the home tab, the start screen (ui/home.ts),
// which shows until a scene is opened from it. The first tab is shown at startup; the others load when first chosen.
// Whatever a load reports is shown as plain text. A structure's loading is in structure-load.ts, its type map in
// type-map-flow.ts, and the attempts that make a load current in attempts.ts.
import { fetchGist, fetchLive, fetchPageFile, fetchScene, fetchServedVersion } from "../scene/fetch";
import { sceneFromFile } from "../scene/read";
import { HOME, type PageStructureSource, type Source, fromOf, hasTypes, linkOf, nameOf } from "../scene/source";
import type { Scene } from "../types";
import { setSceneLink, takePendingPose } from "./share";
import { pageName } from "./dom";
import { errorText } from "../errors";
import { busy, clearTypePrompt, fail, focusUrl, hideCard, showHome } from "./home";
import { showDetails, showInspector } from "./panels";
import { type FileMemory, memoryOfStage, openScene, updateScene } from "./stage";
import { type TabHandlers, showTabs } from "./tab-bar";
import { addTab, chooseLeaving, closeTab, openTabs, tabsOf, uniqueLabel } from "./tab-model";
import { type Attempt, attemptOf, beginAttempt, invalidateAttempts, stopIfStale } from "./attempts";
import { hideModel, showModel } from "./structure-config";
import type { StructureModel } from "./structure-model";
import { loadStructure } from "./structure-load";
import type { AppliedMap, LearnedMap } from "./type-resolution";
import { askForTypes, showAppliedMap, type MapHost } from "./type-map-flow";
import { rememberMap } from "./type-preset-store";
import { ConfigFileError, TypeMapRejected, TypesNeeded } from "./types-needed";
import { clearNote, note } from "./message";
import { allowOpen } from "./open-files";

// A tab: its label in the bar, its source, and the scene once loaded (kept, so choosing the tab again does not load
// it). `attempt` counts the tab's loads (ui/attempts.ts); `told` is the loaded scene whose notes were shown, so they show
// once; `autoMatchOff` is set by Undo, so the tab's next load asks for its map rather than applying a saved one; `memory` is
// the view and selection the file was left with, restored when it is shown again (ui/stage.ts).
interface Tab {
  label: string;
  source: Source;
  loaded: Promise<Loaded> | null;
  attempt: number;
  told: Loaded | null;
  autoMatchOff: boolean;
  memory: FileMemory | null;
}
// A loaded scene and the title it is shown under (a gist's title is its file, which only the load knows). A structure
// also has its model, and the notes its load raised.
interface Loaded {
  doc: Scene;
  name: string;
  model?: StructureModel;
  warnings?: string[];
  applied?: AppliedMap;
  learned?: LearnedMap;
}

// A load that takes longer than this shows the card's "Loading…" text; a quicker one does not flash the card.
const PROGRESS_MS = 150;

// What the loader keeps between events. `tabs` is the list and its current tab (the file island shows it: ui/tab-bar.ts);
// `shown` is the tab whose scene is on the stage (null until one loads) and `servedVersion` the server's version of the live scene on the stage or being loaded (a status with this version has
// nothing to load). The live loads run one after another (`liveTurn`), so each compares the version with what the
// stage shows when its turn comes. `tabListeners` hear which tab is being shown, before it loads (live.ts shows the
// follow note with it).
const state = {
  tabs: tabsOf<Tab>([]),
  shown: null as Tab | null,
  servedVersion: null as string | null,
  liveTurn: Promise.resolve(),
  tabListeners: [] as ((source: Source) => void)[],
};

function inLiveTurn<T>(task: () => Promise<T>): Promise<T> {
  const result = state.liveTurn.then(task);
  const ignore = () => undefined;
  state.liveTurn = result.then(ignore, ignore); // a failed load does not stop the ones after it
  return result;
}
export function onTabChange(listener: (source: Source) => void): void {
  state.tabListeners.push(listener);
}

// The tab that is shown (the list's current one), if the page has any.
const currentTab = (): Tab | undefined => state.tabs.tabs[state.tabs.current];
const isOpen = (tab: Tab): boolean => state.tabs.tabs.includes(tab);
const currentIsHome = (): boolean => currentTab()?.source.kind === "home";
const shows = (tab: Tab, attempt: Attempt): boolean => attempt.current() && tab === currentTab();

function tabOf(label: string, source: Source): Tab {
  return { label, source, loaded: null, attempt: 0, told: null, autoMatchOff: false, memory: null };
}

function homeTab(): Tab {
  return tabOf(nameOf(HOME), HOME);
}

// ---- loading ----
async function loadSource(tab: Tab, attempt: Attempt): Promise<Loaded> {
  const { source } = tab;
  switch (source.kind) {
    case "home":
      throw new Error("the home tab has no scene to load");
    case "embedded":
      return { doc: source.doc, name: nameOf(source) };
    case "live": {
      // The version is noted before the scene is read, so the scene is at least that version, and a status that comes
      // while it loads (with another version) loads again.
      const version = await fetchServedVersion();
      stopIfStale(attempt);
      state.servedVersion = version;
      const doc = await fetchLive();
      stopIfStale(attempt);
      return { doc, name: nameOf(source) };
    }
    case "url":
      return { doc: await fetchScene(source.url), name: nameOf(source) };
    case "gist": {
      const { name, doc } = await fetchGist(source.id, source.file);
      return { doc, name };
    }
    case "file":
      return { doc: await sceneFromFile(source.file), name: nameOf(source) };
    case "structure":
      return loadStructure(source, attempt, !tab.autoMatchOff);
    case "page-structure":
      return loadPageStructure(source, attempt, !tab.autoMatchOff);
  }
}

// A structure of the page's folder: its files are fetched, then it loads as a dropped structure does (with its type map,
// when the source has one).
async function loadPageStructure(source: PageStructureSource, attempt: Attempt, autoMatch: boolean): Promise<Loaded> {
  const [file, ...sidecars] = await Promise.all([source.file, ...source.sidecars].map(fetchPageFile));
  stopIfStale(attempt);
  return loadStructure({ kind: "structure", file, sidecars, types: source.types }, attempt, autoMatch);
}

// A tab's scene: loaded once and kept, and a failed load is cleared so choosing the tab tries again. Each load starts a
// new attempt, which the tab counts (a load that is still running is not started again). A live scene is never kept:
// the server may have a newer one by the time its tab is chosen, and its loads run in turn.
function loadTab(tab: Tab): Promise<Loaded> {
  const cached = tab.source.kind === "live" ? null : tab.loaded;
  if (cached !== null) return cached;
  const attempt = beginAttempt(tab, () => isOpen(tab));
  const starting = tab.source.kind === "live" ? inLiveTurn(() => loadSource(tab, attempt)) : loadSource(tab, attempt);
  const loading: Promise<Loaded> = starting.then(
    (loaded) => {
      if (loaded.learned !== undefined && attempt.current()) {
        rememberMap(loaded.learned.fileName, loaded.learned.signature, loaded.learned.types);
      }
      return loaded;
    },
    (error: unknown) => {
      if (tab.loaded === loading) tab.loaded = null;
      throw error;
    },
  );
  if (tab.source.kind !== "live") tab.loaded = loading;
  return loading;
}

// The home tab: the start screen over the stage. Its name is the page's title; a gemmy serve page lists its served
// scene (the live tab's name) first.
function showHomeTab(): void {
  state.shown = null;
  hideModel();
  setSceneLink(null);
  pageName.value = { name: nameOf(HOME), from: fromOf(HOME) };
  document.title = "gemmy";
  // The details card's buttons act on the scene that is on the stage, which the start screen covers: it closes.
  showDetails(false);
  showInspector(false);
  const live = state.tabs.tabs.find((tab) => tab.source.kind === "live");
  showHome(live ? nameOf(live.source) : null);
}

// Shows the current tab's scene: the one path for every source. A tab's notes are shown once, when its load first shows.
// The prompt and the note of the tab before are cleared at once, so nothing of an earlier load outlives the switch.
async function showCurrent(): Promise<void> {
  const tab = currentTab();
  if (!tab) return;
  // The file on the stage keeps its view and selection before the page moves on (docs/ui.md, rule 2).
  if (state.shown) state.shown.memory = memoryOfStage();
  clearTypePrompt();
  clearNote();
  for (const listener of state.tabListeners) listener(tab.source);
  if (tab.source.kind === "home") {
    showHomeTab();
    return;
  }
  const loading = loadTab(tab);
  const attempt = attemptOf(tab, tab.attempt, () => isOpen(tab));
  const progress = setTimeout(() => {
    if (shows(tab, attempt)) busy(`Loading ${nameOf(tab.source)}…`);
  }, PROGRESS_MS);
  try {
    const loaded = await loading;
    clearTimeout(progress);
    if (shows(tab, attempt)) showLoaded(tab, loaded);
  } catch (error) {
    clearTimeout(progress);
    if (shows(tab, attempt)) failedLoad(tab, attempt, error);
  }
}

function showLoaded(tab: Tab, loaded: Loaded): void {
  openScene(loaded.doc, takePendingPose(), tab.memory);
  state.shown = tab;
  if (loaded.model) {
    showModel(loaded.model, (doc) => {
      loaded.doc = doc; // the tab keeps the scene its config compiles to
    });
  } else {
    hideModel();
  }
  setSceneLink(linkOf(tab.source, location.href));
  pageName.value = { name: loaded.name, from: fromOf(tab.source) };
  document.title = `gemmy: ${loaded.name}`;
  hideCard();
  tellOnce(tab, loaded);
}

// The notes of a load: a saved map that was used, else the warnings its compile raised. Shown once per load.
function tellOnce(tab: Tab, loaded: Loaded): void {
  if (tab.told === loaded) return;
  tab.told = loaded;
  if (loaded.applied !== undefined) showAppliedMap(tab, loaded.applied, typeMapHost);
  else if (loaded.warnings !== undefined && loaded.warnings.length > 0)
    note(loaded.warnings.join(" "), { kind: "warning" });
}

// A load that failed: a type map the card asks for, a map that did not read (the form stays up with the reason), or a
// message on the card. The card's buttons would act on the scene before, so they close.
function failedLoad(tab: Tab, attempt: Attempt, error: unknown): void {
  showDetails(false);
  showInspector(false);
  if (error instanceof TypesNeeded) {
    askForTypes(tab, error, attempt, typeMapHost);
    return;
  }
  if (error instanceof TypeMapRejected) {
    const draft = hasTypes(tab.source) ? tab.source.types : undefined;
    askForTypes(tab, error.needs, attempt, typeMapHost, { error: errorText(error), draft });
    return;
  }
  // A config's error already starts with the config's file name, so it is shown as it is.
  if (error instanceof ConfigFileError) {
    fail(errorText(error));
    return;
  }
  fail(`Could not load ${nameOf(tab.source)}: ${errorText(error)}`);
}

// The type map form's host: the tab is loaded again with its source as it is now.
function reloadTab(tab: Tab): void {
  tab.loaded = null;
  if (tab === currentTab()) void showCurrent();
}
const typeMapHost: MapHost<Tab> = { reload: reloadTab };

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
    const attempt = beginAttempt(tab, () => isOpen(tab));
    const loaded = await loadSource(tab, attempt);
    if (shows(tab, attempt)) updateScene(loaded.doc);
  });
}

function choose(k: number): Promise<void> {
  // Choosing the file that is on the stage changes nothing: its view and selection stay (docs/ui.md, rule 2).
  if (k === state.tabs.current && state.shown === state.tabs.tabs[k]) return Promise.resolve();
  // The start screen is transient: leaving it for another file closes it (ui/tab-model.ts chooseLeaving).
  state.tabs = chooseLeaving(state.tabs, k, (tab) => tab.source.kind === "home");
  renderBar();
  return showCurrent();
}

// Closing a tab ends its loads and releases the stage's pointers to it. Closing a tab that is shown brings up its right
// neighbour, else its left one; closing another leaves the scene on the stage as it is. Closing the last scene tab leaves the home tab.
function closeAt(k: number): Promise<void> {
  const wasCurrent = k === state.tabs.current;
  const closed = state.tabs.tabs[k];
  invalidateAttempts(closed);
  if (state.shown === closed) {
    state.shown = null;
    hideModel();
  }
  state.tabs = closeTab(state.tabs, k, homeTab());
  renderBar();
  return wasCurrent ? showCurrent() : Promise.resolve();
}

// ---- the file island ----
// The page's own scene and a live scene are not closed from the file island. The home tab is closed while another tab
// remains (alone, it has nothing to leave). A scene tab can be closed, and closing the last one leaves the home tab, except
// with opening off, where the last file stays.
function isClosable(source: Source, many: boolean): boolean {
  if (source.kind === "home") return many;
  if (source.kind === "embedded" || source.kind === "live") return false;
  // With opening off the start screen opens nothing, so the last file stays (docs/ui.md, rule 6).
  return allowOpen.peek() || fileCount() > 1;
}

// How many open tabs are files (every tab but the start screen).
function fileCount(): number {
  return state.tabs.tabs.filter((tab) => tab.source.kind !== "home").length;
}

// The file island's state for the tabs now (ui/tab-bar.ts). The page's own link, if it has one, is tab 0.
function renderBar(): void {
  const many = state.tabs.tabs.length > 1;
  const handlers: TabHandlers = {
    choose: (k) => void choose(k),
    close: (k) => void closeAt(k),
    add: openNewTab,
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
    handlers,
  );
}

// The home tab (the New tab), chosen when the page has one already.
function openHomeTab(): void {
  const k = state.tabs.tabs.findIndex((tab) => tab.source.kind === "home");
  if (k >= 0) {
    void choose(k);
    return;
  }
  state.tabs = addTab(state.tabs, homeTab());
  renderBar();
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
    return tabOf(label, source);
  });
}

// Opens sources as tabs: in place of the home tab when it is the current one, else at the end. The first of them is
// shown.
export function openSources(sources: readonly Source[]): void {
  const tabs = tabsFor(
    sources,
    state.tabs.tabs.map((tab) => tab.label),
  );
  state.tabs = openTabs(state.tabs, tabs, currentIsHome());
  renderBar();
  void showCurrent();
}

// The page's tabs at startup. `read` gives the page's sources, or throws when the address is bad (the message goes on
// the start screen). No sources: the home tab alone.
// Resolves once the first tab is shown (its scene drawn, or the start screen).
export async function startTabs(read: () => Source[]): Promise<void> {
  let sources: Source[] = [];
  let problem: string | null = null;
  try {
    sources = read();
  } catch (error) {
    problem = errorText(error);
  }
  const opening = sources.length > 0 ? sources : [HOME];
  state.tabs = openTabs(tabsOf<Tab>([]), tabsFor(opening, []), false);
  renderBar();
  // The error goes on the start screen after the tab is shown: showing the home tab clears the card's error.
  await showCurrent();
  if (problem !== null) fail(problem);
}

// The start screen's served card: the live tab, chosen when the page has one.
export function openServed(): void {
  const k = state.tabs.tabs.findIndex((tab) => tab.source.kind === "live");
  if (k >= 0) void choose(k);
}

// The file island's +: the home tab, with its address box focused.
function openNewTab(): void {
  openHomeTab();
  focusUrl();
}
