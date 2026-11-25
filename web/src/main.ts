// Startup: the page's scenes become its tabs and the first is shown; with none, the start screen (the home tab). A live
// page (gemmy serve) also follows the server, through its status events. After that the viewer runs on its own. Each
// part of the page is wired here, in order.
import { mountOverlay } from "./react/overlay";
import "./render/draw";
import "./render/triad";
import { wireFlyKeys } from "./camera/fly";
import { wireKeyboard } from "./ui/keyboard";
import { wirePicking } from "./ui/picking";
import { releasePivot } from "./ui/pivot";
import { wireStage } from "./ui/stage";
import { attachOpeners, startTabs } from "./ui/loader";
import { startLive } from "./ui/live";
import { byId, pageName } from "./ui/dom";
import { type Source, sourcesToOpen } from "./scene/source";
import { EXAMPLES_FILE, galleryAt } from "./scene/examples";
import type { Scene } from "./types";

const embedded = document.getElementById("scene-data")!.textContent!.trim();
const mode = document.querySelector<HTMLMetaElement>('meta[name="gemmy-mode"]')?.content;
const page = pageName.peek();

// The scenes the page opens: its own (embedded in the page, or live from gemmy serve), else what the address asks for,
// else the page's defaults. The address is read only when the page has no scene of its own. The front page of a hosted
// site (examples.json beside it) has no defaults: it opens the start screen, where the examples are.
async function pageSources(): Promise<Source[]> {
  if (embedded) return [{ kind: "embedded", doc: JSON.parse(embedded) as Scene, page }];
  if (mode === "live") return [{ kind: "live", page }];
  return sourcesToOpen(location.search, location.href, await defaultsToOpen());
}
async function defaultsToOpen(): Promise<string[]> {
  const frontPage = (await galleryAt(new URL(EXAMPLES_FILE, location.href).href)) !== null;
  return frontPage ? [] : defaultScenes();
}
// The page's default scenes: one gemmy-default-scene meta per scene, in document order.
function defaultScenes(): string[] {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="gemmy-default-scene"]')]
    .map((meta) => meta.content)
    .filter((scene) => scene !== "");
}

// The page comes in at once, not piece by piece: the stage and the controls stay hidden (body.booting, page.html) until
// the first tab is shown and the fonts are in, then fade in together (style.css). A slow scene is not waited for past
// REVEAL_LATEST_MS, so its loading message shows.
const REVEAL_LATEST_MS = 800;
async function revealWhenReady(firstTab: Promise<void>): Promise<void> {
  const ready = firstTab.then(() => document.fonts.ready);
  await Promise.race([ready, new Promise((done) => setTimeout(done, REVEAL_LATEST_MS))]);
  // after the frame that draws the first tab
  requestAnimationFrame(() => requestAnimationFrame(() => document.body.classList.remove("booting")));
}

mountOverlay(byId("overlay"));
wireStage();
wirePicking(releasePivot);
wireKeyboard();
wireFlyKeys();
// The live page's own status comes first, so its follow note hears the first tab shown.
if (mode === "live") startLive(page);
attachOpeners();
void revealWhenReady(startTabs(pageSources));
