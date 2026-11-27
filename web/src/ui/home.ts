// The start screen (the home tab): the card over the stage. React draws it (react/home.tsx) from the signals here, so this
// module keeps the state and the logic that is not drawing: the card's status and error, the name of the scene a gemmy
// serve page serves, the examples gallery (read once from examples.json), what an address typed in the Open card means
// (a gist or a scene URL), and New tab's request for the address box. The loader (ui/loader.ts) shows, fills and hides the
// card through the functions below, and wires the actions the card calls.
import { signal } from "@preact/signals-core";
import { type Example, type Gallery, galleryNear, structureOf } from "../scene/examples";
import { type SceneSource, type Source, gistSourceOf, resolveWebUrl } from "../scene/source";
import { errorText } from "../errors";
import type { TypePrompt } from "./types-needed";
import { setScene } from "./layout-modes";

interface HomeActions {
  openSource(source: Source): void;
  openServed(): void;
  openFile(): void;
}

// The card: shown over the stage or not, the status of a scene that is loading, its error, the name of the scene a
// gemmy serve page serves (null on any other page), and the type map a structure needs (null when none is asked for).
export interface CardState {
  shown: boolean;
  status: string;
  error: string | null;
  served: string | null;
  typePrompt: TypePrompt | null;
}
export const card = signal<CardState>({ shown: false, status: "", error: null, served: null, typePrompt: null });

// Whether the Open card has its address box: a gemmy serve page has no loader for an address, so it has none (ui/live.ts).
export const addressShown = signal(true);

// The gallery: undefined until it is read, null when the site has none (no examples.json, or one that does not read).
export const gallery = signal<Gallery | null | undefined>(undefined);

let actions: HomeActions;
let galleryRead = false;
let focusPending = false;

// What every card state sets to nothing: a status, an error and a type prompt are each one at a time.
const CLEARED = { status: "", error: null, typePrompt: null } satisfies Partial<CardState>;

// ---- the card: shown over the stage, with the status and the error of the scene being loaded ----
function show(patch: Partial<CardState>): void {
  card.value = { ...card.value, shown: true, ...patch };
  setScene("none");
}
export function busy(text: string): void {
  show({ ...CLEARED, status: text });
}
export function fail(text: string): void {
  show({ ...CLEARED, error: text });
}
// The card asks for a structure's type map: the form is drawn in it, with no status or error.
export function askTypes(prompt: TypePrompt): void {
  show({ ...CLEARED, typePrompt: prompt });
}
// The type prompt goes at once when the selection or its load changes, so it never outlives its load.
export function clearTypePrompt(): void {
  card.value = { ...card.value, typePrompt: null };
}
export function hideCard(): void {
  card.value = { ...card.value, ...CLEARED, shown: false };
  setScene("shown");
}

// The start screen itself. `served` is the name of the scene a gemmy serve page serves, or null on any other page.
export function showHome(served: string | null): void {
  show({ ...CLEARED, served });
  if (!galleryRead) {
    galleryRead = true;
    void galleryNear(location.href)
      .catch(() => null)
      .then((found) => {
        gallery.value = found;
      });
  }
}

// New tab: the address box takes the focus once it is drawn. The request is taken by the card when it draws (react/home.tsx).
export function focusUrl(): void {
  focusPending = true;
  card.value = { ...card.value };
}
export function takeFocusRequest(): boolean {
  const pending = focusPending;
  focusPending = false;
  return pending;
}

// ---- what the card's controls do ----
// A gist address (gist.github.com) or a hex id is a gist; anything else is a scene URL (resolved against this page).
const HEX_ID = /^[0-9a-f]+$/i;
function sourceOfAddress(text: string, base: string): SceneSource {
  const value = text.trim();
  if (HEX_ID.test(value) || isGistAddress(value)) return gistSourceOf(value);
  return { kind: "url", url: resolveWebUrl(value, base) };
}

function isGistAddress(value: string): boolean {
  try {
    return new URL(value).hostname === "gist.github.com";
  } catch {
    return false;
  }
}

// The address the Open card was given opens in place, as a tab. A bad one is said under the card.
export function openAddress(text: string): void {
  try {
    actions.openSource(sourceOfAddress(text, location.href));
  } catch (error) {
    fail(errorText(error));
  }
}

// A card opens its example's structure, compiled in the page: the same tab as the example's own page opens.
export function openExample(found: Gallery, example: Example): void {
  actions.openSource(structureOf(found, example));
}

export function openServed(): void {
  actions.openServed();
}

export function openFile(): void {
  actions.openFile();
}

export function wireHome(home: HomeActions): void {
  actions = home;
}
