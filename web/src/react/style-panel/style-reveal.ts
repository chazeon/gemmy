// The folder a click asked the dock to show (style-target.ts): its target, and a counter, so a second click on the same
// folder is a new request. A section takes its request once, when its pane is there to show it.
import { signal } from "@preact/signals-core";
import type { SectionId } from "../inspector/contract";
import type { StyleTarget } from "./style-target";

export const styleReveal = signal<(StyleTarget & { nonce: number }) | null>(null);
let nonce = 0;
let taken = 0;

export function revealStyle(target: StyleTarget): void {
  nonce += 1;
  styleReveal.value = { ...target, nonce };
}

// The key a pane of this section should show now, once per request; null when there is none for it.
export function takeReveal(section: SectionId): string | null {
  const request = styleReveal.value;
  if (request === null || request.nonce === taken || request.section !== section) return null;
  taken = request.nonce;
  return request.key;
}
