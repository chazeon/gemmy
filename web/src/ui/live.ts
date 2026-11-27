// The serve page (gemmy serve): its status events (the message line, the Render item of the Export menu), the
// follow note, and the server's new versions, which reload the live tab while it is the one shown (loader.ts
// reloadLive). A file's tab pauses the following; choosing the live tab again resumes it.
import { settingsJson } from "../export/settings";
import { type PageNames, nameOf } from "../scene/source";
import { currentView, renderView } from "./export";
import { onTabChange, reloadLive } from "./loader";
import { STAY, note, setStanding } from "./message";
import { addressShown } from "./home";

// What the server reports on each status event (serve.py, _status_locked).
interface RenderStatus {
  enabled: boolean; // a Blender render is set up for this server
  state: string; // "rendering" while Blender works, else "idle"
  output: string; // the image's file name
  time: string | null; // when the last good render finished (HH:MM:SS); null before the first
  error: string | null;
}
interface ServeStatus {
  version: string | null;
  error: string | null; // the last compile's error, if the last compile failed
  render: RenderStatus;
}

// The notes that are not about a render in progress go after this long.
const LIVE_TOAST_MS = 3000;

export function startLive(page: PageNames): void {
  addressShown.value = false; // a serve page has no loader for an address (ui/home.ts)
  followNote(page);
  // The first status only records the render's time: an old render is not reported as updated.
  let renderedAt: string | null | undefined;
  const showStatus = (status: ServeStatus): void => {
    const r = status.render;
    renderView.value = r.enabled ? sendRenderView : null; // the menu's item shows when Blender is set up
    setStanding(
      "error",
      [status.error, r.error ? `Blender error: ${r.error}` : ""].filter(Boolean).join(" ") || null,
      "error",
    );
    // The progress is a standing message of its own, so a timed note (an Undo, say) is not replaced by it. It is cleared
    // by name when the render finishes or fails.
    if (r.state === "rendering") setStanding("render", `Rendering ${r.output}…`);
    else {
      setStanding("render", null);
      if (r.time && r.time !== renderedAt && renderedAt !== undefined)
        note(`${r.output} updated`, { ms: LIVE_TOAST_MS });
    }
    renderedAt = r.time;
  };

  // Live mode: the server pushes a status on every change; a new version reloads the live tab if it is shown.
  const events = new EventSource("events");
  events.addEventListener("status", (e) => {
    const status: ServeStatus = JSON.parse(e.data);
    showStatus(status);
    reloadLive(status.version).catch((error) => setStanding("error", String(error), "error"));
  });
}

// The follow note says how to get the server's scene back, whenever another tab is the one shown (an info message).
function followNote(page: PageNames): void {
  onTabChange((source) => {
    setStanding(
      "follow",
      source.kind === "live" ? null : `Showing ${nameOf(source)} — choose ${page.name} to follow the server again`,
    );
  });
}

// The serve-only Export item: it sends the view's settings (the camera and the cell box are what the server takes),
// and the server renders them with Blender. The menu shows the item when Blender is set up (ui/export.ts renderView).
async function sendRenderView(): Promise<void> {
  try {
    const response = await fetch("render-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: settingsJson(currentView()),
    });
    const reply = (await response.json()) as { error?: string };
    if (response.ok) note("Render queued with this view", { ms: LIVE_TOAST_MS });
    else note(`Could not use this view: ${reply.error}`, { ms: STAY, kind: "error" });
  } catch (error) {
    note(`Could not use this view: ${error}`, { ms: STAY, kind: "error" });
  }
}
