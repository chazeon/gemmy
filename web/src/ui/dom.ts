// DOM helpers for the ui files. The page (web/page.html) is fixed, so a missing element means a broken page: the
// lookup fails with the id it could not find.
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

// A copy of a page's <template>, as a fragment the caller fills in and inserts.
export function cloneTemplate(id: string): DocumentFragment {
  return byId<HTMLTemplateElement>(id).content.cloneNode(true) as DocumentFragment;
}

// The text of a template's slot (an element marked data-slot="name"). Text only, never HTML.
export function setSlot(root: ParentNode, name: string, text: string): void {
  root.querySelector<HTMLElement>(`[data-slot="${name}"]`)!.textContent = text;
}

// The page's name and its line under it (the title in the menu island).
const nameHeading = document.querySelector<HTMLElement>(".name h1")!;
const nameLine = document.querySelector<HTMLElement>(".name .sub")!;
export const pageName = {
  read(): PageNames {
    return { name: nameHeading.textContent!, from: nameLine.textContent! };
  },
  show(name: string, from: string): void {
    nameHeading.textContent = name;
    nameLine.textContent = from;
  },
};
