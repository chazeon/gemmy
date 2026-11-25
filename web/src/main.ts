// Startup: the page's scenes become its tabs and the first is shown. A live page (gemmy serve) also follows the server,
// through its status events. After that the viewer runs on its own. Each part of the page is wired here, in order.
import "./render/draw";
import "./render/triad";
import { wireFlyKeys } from "./camera/fly";
import { wireKeyboard } from "./ui/keyboard";
import { wireLensBar } from "./ui/lens-bar";
import { wirePanels } from "./ui/panels";
import { wirePicking } from "./ui/picking";
import { releasePivot } from "./ui/pivot";
import { wireReadout } from "./ui/readout";
import { wireStage } from "./ui/stage";
import { wireToolbarButtons } from "./ui/toolbar-buttons";
import { wireTooltips } from "./ui/tooltip";
import { wireViewButtons } from "./ui/views";
import { attachOpeners, startTabs } from "./ui/loader";
import { startLive } from "./ui/live";
import { pageName } from "./ui/dom";
import { type Source, sourcesToOpen } from "./scene/source";
import type { Scene } from "./types";

const embedded = document.getElementById("scene-data")!.textContent!.trim();
const mode = document.querySelector<HTMLMetaElement>('meta[name="gemmy-mode"]')?.content;
const page = pageName.read();

// The scenes the page opens: its own (embedded in the page, or live from gemmy serve), else what the address asks for
// or the page's defaults. The address is read only when the page has no scene of its own.
function pageSources(): Source[] {
  if (embedded) return [{ kind: "embedded", doc: JSON.parse(embedded) as Scene, page }];
  if (mode === "live") return [{ kind: "live", page }];
  return sourcesToOpen(location.search, location.href, defaultScenes());
}
// The page's default scenes: one gemmy-default-scene meta per scene, in document order.
function defaultScenes(): string[] {
  return [...document.querySelectorAll<HTMLMetaElement>('meta[name="gemmy-default-scene"]')]
    .map((meta) => meta.content)
    .filter((scene) => scene !== "");
}

wireStage();
wireViewButtons();
wireLensBar();
wireToolbarButtons();
wireTooltips();
wireReadout();
wirePicking(releasePivot);
wirePanels();
wireKeyboard();
wireFlyKeys();
// The live page's own status comes first, so its follow note hears the first tab shown.
if (mode === "live") startLive(page);
startTabs(pageSources);
attachOpeners();
