// The tab strip's state, as a signal (@preact/signals-core). The loader (ui/loader.ts) writes it whenever the tabs change,
// and the React strip (src/react/tab-strip.tsx) shows it. A page built with its own strip (gemmy serve's, a static
// site's) has that strip's links read once, when the overlay mounts, and removed from the page: React draws them from
// then on. The link of the page's own scene is the first tab (its button chooses the tab, without navigating).
import { signal } from "@preact/signals-core";
import { type StripLink, linksShown } from "./tab-model";

export interface StripTab {
  label: string;
  closable: boolean;
  home: boolean; // the start screen's tab: while it is the one shown, the strip's "+" (which opens it) is hidden
}
export interface TabHandlers {
  choose(k: number): void;
  close(k: number): void;
  add(): void;
  own(): void;
}
export interface TabBarView {
  visible: boolean; // the strip shows in place of the page's name
  links: readonly (StripLink & { current: boolean })[];
  tabs: readonly StripTab[];
  hasOwnLink: boolean; // tab 0 is the page's own link (in links), so the strip does not list it as a tab again
  current: number;
  handlers: TabHandlers;
}

// The tab that has just opened and a count of openings, so the strip pulses that tab once (react/tab-strip.tsx). The
// loader calls pulseTab with the index of the tab it opened or made.
export const tabPulse = signal({ tab: -1, serial: 0 });
export function pulseTab(k: number): void {
  tabPulse.value = { tab: k, serial: tabPulse.peek().serial + 1 };
}

const NO_HANDLERS: TabHandlers = { choose() {}, close() {}, add() {}, own() {} };
let serverLinks: StripLink[] = [];
export const tabBar = signal<TabBarView>({
  visible: false,
  links: [],
  tabs: [],
  hasOwnLink: false,
  current: 0,
  handlers: NO_HANDLERS,
});

// Reads the strip the server built into `container` (its nav.tabs, if any), and removes it from the page.
export function takeServerLinks(container: HTMLElement): void {
  const nav = container.querySelector("nav.tabs");
  if (nav === null) return;
  serverLinks = [...nav.querySelectorAll("a")].map((a) => ({
    label: a.textContent ?? "",
    href: a.getAttribute("href") ?? "",
    own: a.getAttribute("aria-current") === "page",
  }));
  nav.remove();
}

// The strip's state for the tabs now: `needed` says the loader needs a strip (more than one tab, or the start screen).
export function showTabs(tabs: readonly StripTab[], current: number, needed: boolean, handlers: TabHandlers): void {
  tabBar.value = {
    visible: needed || serverLinks.length > 0,
    links: linksShown(serverLinks, current),
    tabs,
    hasOwnLink: serverLinks.some((link) => link.own),
    current,
    handlers,
  };
}
