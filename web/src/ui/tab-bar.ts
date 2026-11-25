// The tab strip: one button per tab, and for a file a ✕ while another tab remains (the last tab stays). A page built
// with its own strip (the server's) keeps its links: the page's own scene is its link (tab 0), so that tab has no
// button of its own there, and the link is current only while that scene is shown.
import { watchOverflow } from "./overflow";
import { byId, cloneTemplate } from "./dom";

export interface TabBar {
  element: HTMLElement;
  ownLink: HTMLAnchorElement | null;
}
export interface TabEntry {
  label: string;
  closable: boolean;
}
export interface TabActions {
  choose(k: number): void;
  close(k: number): void;
}

// The strip the page has, or one made above the page's name (the name is hidden behind the strip, as on a server-built
// strip). `onOwnLink` runs when the page's own link is clicked: that tab is chosen without navigating.
export function makeBar(onOwnLink: () => void): TabBar {
  const built = document.querySelector<HTMLElement>(".tabs");
  if (built) {
    const ownLink = built.querySelector<HTMLAnchorElement>('a[aria-current="page"]');
    ownLink?.addEventListener("click", (event) => {
      event.preventDefault();
      onOwnLink();
    });
    return { element: built, ownLink };
  }
  const nav = document.createElement("nav");
  nav.className = "tabs";
  nav.setAttribute("aria-label", "Scenes");
  byId("menu-island").insertBefore(nav, document.querySelector(".name"));
  return { element: nav, ownLink: null };
}

// Rebuilds the tab buttons from the entries, and marks the current one.
export function renderTabs(bar: TabBar, entries: readonly TabEntry[], current: number, actions: TabActions): void {
  const strip = bar.element;
  strip.querySelectorAll(".local-tab").forEach((element) => {
    element.remove();
  });
  entries.forEach((entry, k) => {
    if (k !== 0 || bar.ownLink === null) strip.appendChild(tabElement(entry, k === current, k, actions));
  });
  if (bar.ownLink !== null) {
    if (current === 0) bar.ownLink.setAttribute("aria-current", "page");
    else bar.ownLink.removeAttribute("aria-current");
  }
  watchOverflow(strip);
  strip.querySelector('[aria-current="page"]')?.scrollIntoView({ block: "nearest", inline: "nearest" });
}

function tabElement(entry: TabEntry, isCurrent: boolean, k: number, actions: TabActions): HTMLElement {
  const wrap = document.createElement("span");
  wrap.className = "local-tab";
  const choice = document.createElement("button");
  choice.type = "button";
  choice.textContent = entry.label;
  if (isCurrent) choice.setAttribute("aria-current", "page");
  choice.addEventListener("click", () => actions.choose(k));
  wrap.appendChild(choice);
  if (entry.closable) wrap.appendChild(closeButton(entry.label, () => actions.close(k)));
  return wrap;
}

function closeButton(label: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "tab-close";
  button.title = `Close ${label}`;
  button.setAttribute("aria-label", `Close ${label}`);
  button.append(cloneTemplate("close-icon"));
  button.addEventListener("click", onClick);
  return button;
}
