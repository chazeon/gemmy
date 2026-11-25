// DOM helpers for the ui files. The page (web/page.html) is fixed, so a missing element means a broken page: the
// lookup fails with the id it could not find.

export function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error(`gemmy viewer: the page has no #${id}`);
  return element as T;
}

// The nearest element at or above an event target that matches the selector (null for the document or a miss).
export function closestOf(target: EventTarget | null, selector: string): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>(selector) : null;
}

// Keeps a floating element's edge inside [low, high]. When the range is empty (the box is wider than the window), the
// low edge wins, so the box sticks to the window's near side. Tooltips and popovers both rely on that.
export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(value, high));
}
