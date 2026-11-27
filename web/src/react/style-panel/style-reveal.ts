// The folder a click asked the dock to show (style-target.ts): its target, and a counter, so a second click on the same
// folder is a new request. A section takes its request once, when its pane is there to show it.
import { signal } from "@preact/signals-core";
import type { SectionId } from "../inspector/contract";
import type { StyleTarget } from "./style-target";

export const styleReveal = signal<(StyleTarget & { nonce: number; focus: boolean }) | null>(null);
let nonce = 0;
let taken = 0;

// A pick shows the folder without taking the focus (a focus would close a popover the user has open); a saved draft
// focuses the rule it made, where the draft was.
export function revealStyle(target: StyleTarget, focus = false): void {
  nonce += 1;
  styleReveal.value = { ...target, nonce, focus };
}

// The key a pane of this section should show now, once per request; null when there is none for it.
export function takeReveal(section: SectionId): { key: string; focus: boolean } | null {
  const request = styleReveal.value;
  if (request === null || request.nonce === taken || request.section !== section) return null;
  taken = request.nonce;
  return { key: request.key, focus: request.focus };
}
