// Sharing the view: the camera in the page's address (#view=...), restored when the first scene is shown, and the Copy
// link item of the ☰ menu. The address is written when the camera has stopped moving, quietly (replaceState).
import { setView, viewNow } from "../camera/view";
import { VIEW_KEY, type ViewPose, decodeView, encodeView, poseOf, viewFromPose } from "../camera/viewhash";
import { lens, loaded } from "../state";
import { byId } from "./dom";
import { note } from "./toast";
import { VIEWS } from "./views";

const SETTLE_MS = 200; // the address is written once the camera has been still for a read this long
const NOTE_MS = 5000;

// The camera as the address describes it.
const currentPose = (): ViewPose => poseOf(viewNow(), loaded.value.extent);

// The camera goes to the pose: the state it gives for this structure (camera/viewhash.ts viewFromPose: an orthographic
// eye's distance is not used, a perspective one is the zoom). A pose with no usable direction shows the default view.
// The address then holds the pose as shown, so a bad address is replaced by the good one.
export function applyPose(pose: ViewPose): void {
  const next = viewFromPose(pose, loaded.value.extent, lens.value);
  if (!next) {
    VIEWS.rotated();
    return;
  }
  setView(next);
  writeAddress(encodeView(currentPose()));
}

// The view in the address is for the first scene shown; it is taken once, so a scene opened later keeps its own view.
let pending: ViewPose | null = readAddressPose();
function readAddressPose(): ViewPose | null {
  const text = new URLSearchParams(location.hash.slice(1)).get(VIEW_KEY);
  return text === null ? null : decodeView(text);
}
export function takePendingPose(): ViewPose | null {
  const pose = pending;
  pending = null;
  return pose;
}

// The address, written as the camera's view. replaceState: no history entry, and no page reload.
function writeAddress(text: string): void {
  const url = new URL(location.href);
  url.hash = `${VIEW_KEY}=${text}`;
  history.replaceState(history.state, "", url.href);
}

// Writes the view when the camera has stopped: the pose is read every SETTLE_MS and written once two reads in a row
// agree and differ from what the address holds. A drag or a glide therefore writes once, at its end. Started once a
// scene is shown, from the view it shows, so the address is not rewritten before there is anything to describe.
let watching = false;
export function watchView(): void {
  if (watching) return;
  watching = true;
  let written = encodeView(currentPose());
  let previous = written;
  setInterval(() => {
    const now = encodeView(currentPose());
    if (now === previous && now !== written) {
      written = now;
      writeAddress(now);
    }
    previous = now;
  }, SETTLE_MS);
}

// The address that opens the scene shown (linkOf in scene/source.ts), or null for an embedded or dropped scene, which
// no link can carry: then Copy link gives the view only, which opens this page.
let sceneLink: string | null = null;
export function setSceneLink(link: string | null): void {
  sceneLink = link;
}

function copyLink(): void {
  const url = new URL(sceneLink ?? location.href);
  url.hash = `${VIEW_KEY}=${encodeView(currentPose())}`;
  const said =
    sceneLink === null
      ? "Copied the view only: an embedded or local scene cannot go in a link, " +
        "so the link opens this page at this view."
      : "Copied the link: this scene, at this view.";
  const refused = () => note("Could not copy the link: the browser refused the clipboard.", NOTE_MS);
  try {
    navigator.clipboard.writeText(url.href).then(() => note(said, NOTE_MS), refused);
  } catch {
    refused();
  }
}
byId("copy-link").addEventListener("click", copyLink);
