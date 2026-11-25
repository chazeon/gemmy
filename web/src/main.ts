// Startup: open the embedded scene (or follow a live server), then the viewer runs on its own.
import { settingsJson } from "./camera/framing";
import { sceneBounds } from "./scene/bounds";
import "./render/draw";
import { VIEWS } from "./ui/ui";
import "./render/triad";
import { infoChoice, narrowScreen, showInfo } from "./ui/panels";
import { select } from "./ui/picking";
import { describe, dist } from "./ui/readout";
import { resize } from "./render/loop";
import { EXPORTS, currentView, exportMenu, exportPopover } from "./ui/menus";
import { load } from "./scene/load";
import { attachOpeners, startLoader, type Shown } from "./ui/loader";
import { applyPose, setSceneLink, takePendingPose, watchView } from "./ui/share";
import type { ViewPose } from "./camera/viewhash";
import { centre, polyTargets, points, requestRender } from "./state";
import type { Scene } from "./types";

// ---- first scene ----
// Open with the polyhedron nearest the middle selected, so the readout shows what the viewer measures.
function openScene(doc: Scene, view: ViewPose | null = null) {
  load(doc, sceneBounds(doc));
  if (view) applyPose(view);
  else VIEWS.rotated();
  const middle = [...polyTargets].sort((p, q) =>
    dist(points.get(p.poly.center_point_id)!.position, centre) - dist(points.get(q.poly.center_point_id)!.position, centre))[0];
  select(middle ?? null);
  showInfo(infoChoice ?? (Boolean(middle) && !narrowScreen.matches)); // a phone opens with it folded
  watchView();
}
// The page's scene, one of three ways: embedded (gemmy view, the built site's example pages), live (gemmy serve, which
// follows the server), or none, when the viewer asks for a scene by URL, gist or file (the loader).
// A scene shown from the loader: its name is the title, and where it came from is under the title.
function showLoaded(shown: Shown) {
  setSceneLink(shown.link);
  openScene(shown.doc, takePendingPose());
  (document.querySelector(".name h1") as HTMLElement).textContent = shown.name;
  (document.querySelector(".name .sub") as HTMLElement).textContent = shown.from;
  document.title = `gemmy: ${shown.name}`;
}
const embedded = document.getElementById("scene-data")!.textContent!.trim();
const mode = document.querySelector<HTMLMetaElement>('meta[name="gemmy-mode"]')?.content;
// On a live page, a scene dropped or opened replaces the followed one: the page stops following the server until reload.
let following = mode === "live";
function showDropped(shown: Shown) {
  following = false;
  showLoaded(shown);
  const note = document.getElementById("follow-note") as HTMLElement;
  note.textContent = `Showing ${shown.name} — reload to follow the server again`;
  note.hidden = false;
  (document.getElementById("banner") as HTMLElement).hidden = false;
}
if (embedded) {
  openScene(JSON.parse(embedded) as Scene, takePendingPose());
} else if (mode === "live") {
  // Live mode (gemmy serve): the server pushes a status on every change; a new version means fetch the scene.
  describe(null);
  resize();
  const banner = document.getElementById("banner") as HTMLElement;
  const errorLine = (banner.querySelector(".err") as HTMLElement), toast = document.getElementById("toast") as HTMLElement;
  const followNote = document.getElementById("follow-note") as HTMLElement;
  // Opening a URL needs the hosted pages' loader, which a serve page does not have: the item says so.
  const openUrl = document.getElementById("open-url") as HTMLButtonElement;
  openUrl.disabled = true;
  openUrl.title = "Not on a gemmy serve page: it has no loader for an address (drop a file, or Open scene…)";
  let seen = null, opened = false, renderedAt, toastTimer;
  const showToast = (text: string, stay?: boolean) => {
    clearTimeout(toastTimer);
    toast.textContent = text;
    toast.hidden = false;
    toast.classList.remove("fade");
    if (!stay) toastTimer = setTimeout(() => {
      toast.classList.add("fade");
      toastTimer = setTimeout(() => { toast.hidden = true; }, 400);
    }, 3000);
  };
  // The serve-only menu item: send the exported settings (camera and cell box are what the server takes).
  const renderViewItem = (exportMenu.querySelector('[data-export="render-view"]') as HTMLElement);
  EXPORTS["render-view"] = async () => {
    exportPopover.close(true);
    try {
      const response = await fetch("render-view", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: settingsJson(currentView()),
      });
      const reply = await response.json();
      if (response.ok) showToast("Render queued with this view");
      else showToast(`Could not use this view: ${reply.error}`, true);
    } catch (error) { showToast(`Could not use this view: ${error}`, true); }
  };
  const showStatus = (s) => {
    const r = s.render;
    renderViewItem.hidden = !r?.enabled;
    errorLine.textContent = [s.error, r?.error ? `Blender error: ${r.error}` : ""].filter(Boolean).join("\n\n");
    errorLine.hidden = !errorLine.textContent;
    banner.hidden = errorLine.hidden && followNote.hidden;
    if (r?.state === "rendering") showToast(`Rendering ${r.output}…`, true);
    else if (r?.time && r.time !== renderedAt && renderedAt !== undefined) showToast(`${r.output} updated`);
    else if (toast.textContent!.startsWith("Rendering")) toast.hidden = true; // finished with an error, or no change
    renderedAt = r?.time ?? null; // the first status only records the time: no "updated" for an old render
  };
  const refresh = async () => {
    try {
      const response = await fetch("scene.json", { cache: "no-store" });
      if (!response.ok) return;
      const doc: Scene = await response.json();
      if (opened) { load(doc, sceneBounds(doc)); requestRender(); } else { openScene(doc, takePendingPose()); opened = true; }
    } catch (error) { errorLine.textContent = String(error); errorLine.hidden = banner.hidden = false; }
  };
  const events = new EventSource("events");
  events.addEventListener("status", (e) => {
    const s = JSON.parse(e.data);
    showStatus(s);
    if (following && s.version && s.version !== seen) { seen = s.version; refresh(); }
  });
} else {
  startLoader(showLoaded);
}
attachOpeners((shown) => (mode === "live" ? showDropped(shown) : showLoaded(shown)));
