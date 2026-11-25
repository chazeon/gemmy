// The start screen (the home tab): the card over the stage. React draws it (react/home.tsx) from the signals here, so this
// module keeps the state and the logic that is not drawing: the card's status and error, the name of the scene a gemmy
// serve page serves, the examples gallery (read once from examples.json), what an address typed in the Open card means
// (a gist or a scene URL), and New tab's request for the address box. The loader (ui/loader.ts) shows, fills and hides the
// card through the functions below, and wires the actions the card calls.
import { signal } from "@preact/signals-core";
import { type Example, type Gallery, galleryNear, sceneAddressOf } from "../scene/examples";
import { type SceneSource, gistSourceOf, resolveWebUrl } from "../scene/source";

interface HomeActions {
  openSource(source: SceneSource): void;
  openServed(): void;
  openFile(): void;
}

// The card: shown over the stage or not, the status of a scene that is loading, its error, and the name of the scene a
// gemmy serve page serves (null on any other page).
export interface CardState {
  shown: boolean;
  status: string;
  error: string | null;
  served: string | null;
}
export const card = signal<CardState>({ shown: false, status: "", error: null, served: null });

// The gallery: undefined until it is read, null when the site has none (no examples.json, or one that does not read).
export const gallery = signal<Gallery | null | undefined>(undefined);

let actions: HomeActions;
let galleryRead = false;
let focusPending = false;

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

// ---- the card: shown over the stage, with the status and the error of the scene being loaded ----
function show(patch: Partial<CardState>): void {
  card.value = { ...card.value, shown: true, ...patch };
  document.body.classList.add("no-scene");
}
export function busy(text: string): void {
  show({ status: text, error: null });
}
export function fail(text: string): void {
  show({ status: "", error: text });
}
export function hideCard(): void {
  card.value = { ...card.value, shown: false, status: "", error: null };
  document.body.classList.remove("no-scene");
}

// The start screen itself. `served` is the name of the scene a gemmy serve page serves, or null on any other page.
export function showHome(served: string | null): void {
  show({ status: "", error: null, served });
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
  return { kind: "url", url: resolveWebUrl(value, base), byDefault: false };
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
    fail(messageOf(error));
  }
}

export function openExample(found: Gallery, example: Example): void {
  actions.openSource({ kind: "url", url: sceneAddressOf(found, example), byDefault: false });
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
