// The serve page (gemmy serve): its status events (the banner, the toast, the Render item of the Export menu), the
// follow note, and the server's new versions, which reload the live tab while it is the one shown (loader.ts
// reloadLive). A file's tab pauses the following; choosing the live tab again resumes it.
import { settingsJson } from "../export/settings";
import { type PageNames, nameOf } from "../scene/source";
import { currentView, renderView } from "./export";
import { onTabChange, openUrlUnavailable, reloadLive } from "./loader";
import { STAY, hideNote, note, noteText } from "./toast";
import { byId } from "./dom";

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

// The toast's lines that are not about a render in progress go after this long.
const LIVE_TOAST_MS = 3000;

export function startLive(page: PageNames): void {
  disableOpenUrl();
  const banner = byId("banner");
  const errorLine = banner.querySelector<HTMLElement>(".err")!;
  const followLine = byId("follow-note");
  // The banner shows while either its error line or the follow note has something to say.
  const refreshBanner = (): void => {
    banner.hidden = followLine.hidden && errorLine.hidden;
  };
  followNote(page, followLine, refreshBanner);
  const showError = (text: string): void => {
    errorLine.textContent = text;
    errorLine.hidden = banner.hidden = false;
  };
  // The first status only records the render's time: an old render is not reported as updated.
  let renderedAt: string | null | undefined;
  const showStatus = (status: ServeStatus): void => {
    const r = status.render;
    renderView.value = r.enabled ? sendRenderView : null; // the menu's item shows when Blender is set up
    errorLine.textContent = [status.error, r.error ? `Blender error: ${r.error}` : ""].filter(Boolean).join("\n\n");
    errorLine.hidden = !errorLine.textContent;
    refreshBanner();
    if (r.state === "rendering") note(`Rendering ${r.output}…`, STAY);
    else if (r.time && r.time !== renderedAt && renderedAt !== undefined) note(`${r.output} updated`, LIVE_TOAST_MS);
    else if (noteText().startsWith("Rendering")) hideNote(); // finished with an error, or no change
    renderedAt = r.time;
  };

  // Live mode: the server pushes a status on every change; a new version reloads the live tab if it is shown.
  const events = new EventSource("events");
  events.addEventListener("status", (e) => {
    const status: ServeStatus = JSON.parse(e.data);
    showStatus(status);
    reloadLive(status.version).catch((error) => showError(String(error)));
  });
}

// Opening a URL needs the hosted pages' loader, which a serve page does not have: the menu's item says so.
function disableOpenUrl(): void {
  openUrlUnavailable.value =
    "Not on a gemmy serve page: it has no loader for an address (drop a file, or Open local file…)";
}

// The follow note says how to get the server's scene back, whenever another tab is the one shown.
function followNote(page: PageNames, followLine: HTMLElement, refreshBanner: () => void): void {
  onTabChange((source) => {
    followLine.hidden = source.kind === "live";
    if (!followLine.hidden)
      followLine.textContent = `Showing ${nameOf(source)} — choose ${page.name} to follow the server again`;
    refreshBanner();
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
    if (response.ok) note("Render queued with this view", LIVE_TOAST_MS);
    else note(`Could not use this view: ${reply.error}`, STAY);
  } catch (error) {
    note(`Could not use this view: ${error}`, STAY);
  }
}
