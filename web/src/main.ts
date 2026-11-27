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
import { openServed, openSources, startTabs } from "./ui/loader";
import { attachOpeners } from "./ui/openers";
import { captureMode } from "./ui/capture";
import { installCaptureApi } from "./ui/capture-api";
import { startLive } from "./ui/live";
import { byId, pageName } from "./ui/dom";
import { errorText } from "./errors";
import { STAY, note } from "./ui/message";
import { type Source, parseSources } from "./scene/source";
import type { Scene } from "./types";

const embedded = document.getElementById("scene-data")!.textContent!.trim();
const mode = document.querySelector<HTMLMetaElement>('meta[name="gemmy-mode"]')?.content;
const page = pageName.peek();

// The scenes the page opens: its own (embedded in the page, or live from gemmy serve), else what the address asks for
// (?scene= or ?gist=), else none, and the start screen shows (the home tab).
function pageSources(): Source[] {
  if (embedded) return [{ kind: "embedded", doc: JSON.parse(embedded) as Scene, page }];
  if (mode === "live") return [{ kind: "live", page }];
  return parseSources(location.search, location.href);
}

// The page comes in at once, not piece by piece: the stage and the controls stay hidden (body.booting, page.html) until
// the first tab is shown and the fonts are in, then fade in together (style.css). A slow scene is not waited for past
// REVEAL_LATEST_MS, so its loading message shows. The reveal is one step: it shows the page and sets data-ready, which starts
// the slides (style.css: --slide-duration is 0 until then, so a dock restored as open is simply there).
const REVEAL_LATEST_MS = 800;
async function revealWhenReady(firstTab: Promise<void>): Promise<void> {
  const ready = firstTab.then(() => document.fonts.ready);
  await Promise.race([ready, new Promise((done) => setTimeout(done, REVEAL_LATEST_MS))]);
  // after the frame that draws the first tab
  await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  document.body.classList.remove("booting");
  document.documentElement.setAttribute("data-ready", "");
}

// Capture mode (ui/capture.ts) is the stage alone: no overlay, and none of the page's inputs.
if (!captureMode) {
  mountOverlay(byId("overlay"));
  wirePicking(releasePivot);
  wireKeyboard();
  wireFlyKeys();
}
wireStage();
// The live page's own status comes first, so its follow note hears the first tab shown.
if (mode === "live") startLive(page);
// The openers ask whether the page can compile. That answer never throws, but a failure while the openers are set up
// must not stop the page from starting: it is shown, and the page goes on.
if (!captureMode) {
  try {
    attachOpeners({ openSources, openServed });
  } catch (error) {
    note(`The page could not set up its file openers: ${errorText(error)}`, { ms: STAY, kind: "error" });
  }
}
const firstTab = startTabs(pageSources);
const revealed = revealWhenReady(firstTab);
if (captureMode) installCaptureApi(revealed);
