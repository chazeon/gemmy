// DOM helpers for the ui files. The page (web/page.html) is fixed, so a missing element means a broken page: the
// lookup fails with the id it could not find.
import { signal } from "@preact/signals-core";
import type { PageNames } from "../scene/source";

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`gemmy viewer: the page has no #${id}`);
  return element as T;
}

// The nearest element at or above an event target that matches the selector (null for the document or a miss).
export function closestOf(target: EventTarget | null, selector: string): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(selector) : null;
}

// The page's name and its line under it: the file island's name when the island shows no menu (react/file-island.tsx).
// The page's own name is in the overlay's data attributes (web/page.html); the loader sets the name as each scene opens.
export const pageName = signal<PageNames>({
  name: byId("overlay").dataset.title ?? "",
  from: byId("overlay").dataset.subtitle ?? "",
});
