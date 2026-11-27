// The open files, as a signal (@preact/signals-core). The loader (ui/loader.ts) writes it whenever the files change, and
// the React file island (src/react/file-island.tsx) shows it: a dropdown of the files, or the one file's name as text.
// A page built with its own links (gemmy serve's, a static site's) has those links read once, when the overlay mounts,
// and removed from the page: React draws them in the dropdown from then on. The link of the page's own scene is the
// first file (its item chooses the file, without navigating).
import { signal } from "@preact/signals-core";
import { type PageLink, linksShown } from "./tab-model";

export interface FileTab {
  label: string;
  closable: boolean;
  home: boolean; // the start screen (the New tab), which the dropdown does not list as a file
}
export interface TabHandlers {
  choose(k: number): void;
  close(k: number): void;
  add(): void;
  own(): void;
}
export interface TabBarView {
  links: readonly (PageLink & { current: boolean })[];
  tabs: readonly FileTab[];
  hasOwnLink: boolean; // tab 0 is the page's own link (in links), so the dropdown does not list it as a file again
  current: number;
  handlers: TabHandlers;
}

const NO_HANDLERS: TabHandlers = { choose() {}, close() {}, add() {}, own() {} };
let serverLinks: PageLink[] = [];
export const tabBar = signal<TabBarView>({
  links: [],
  tabs: [],
  hasOwnLink: false,
  current: 0,
  handlers: NO_HANDLERS,
});

// Reads the links the server built into `container` (its nav.tabs, if any), and removes them from the page.
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

// The island's state for the files now.
export function showTabs(tabs: readonly FileTab[], current: number, handlers: TabHandlers): void {
  tabBar.value = {
    links: linksShown(serverLinks, current),
    tabs,
    hasOwnLink: serverLinks.some((link) => link.own),
    current,
    handlers,
  };
}
