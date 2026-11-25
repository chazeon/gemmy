// Sharing the view: the camera in the page's address (#view=...), restored when the first scene is shown, and the Copy
// link item of the ☰ menu. The address is written when the camera has stopped moving, quietly (replaceState).
import * as THREE from "three";
import { isPersp } from "../camera/view";
import { VIEW_KEY, type ViewPose, decodeView, encodeView, placedPose } from "../camera/viewhash";
import { controls } from "../render/draw";
import { camera, extent, lens, requestRender } from "../state";
import type { Vec3 } from "../types";
import { byId } from "./dom";
import { note } from "./toast";
import { VIEWS, switchProjection } from "./ui";

const SETTLE_MS = 200; // the address is written once the camera has been still for a read this long
const NOTE_MS = 5000;

const vector = (v: THREE.Vector3): Vec3 => [v.x, v.y, v.z];

// The camera as the address describes it.
export function currentPose(): ViewPose {
  return {
    projection: isPersp() ? "persp" : "ortho",
    lens,
    zoom: camera.zoom,
    eye: vector(camera.position),
    at: vector(controls.target),
    up: vector(camera.up),
  };
}

// The camera goes to the pose: its projection and lens first (as the lens buttons switch), then position, target and up.
// The pose is placed for this structure first (placedPose: an orthographic eye at the standard distance, a perspective
// one clamped to the trackball's limits); a pose with no usable direction shows the default view. The address then holds
// the pose as shown, so a bad address is replaced by the good one.
export function applyPose(pose: ViewPose): void {
  const placed = placedPose(pose, extent, controls);
  if (!placed) {
    VIEWS.rotated();
    return;
  }
  switchProjection(pose.projection, pose.projection === "persp" ? pose.lens : lens);
  camera.position.fromArray(placed.eye);
  controls.target.fromArray(placed.at);
  camera.up.fromArray(placed.up);
  camera.lookAt(controls.target);
  if (pose.projection === "ortho") {
    camera.zoom = placed.zoom;
    camera.updateProjectionMatrix();
  }
  writeAddress(encodeView(currentPose()));
  requestRender();
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

// Writes the view when the camera has stopped: the pose is read every SETTLE_MS and written once two reads in a row agree
// and differ from what the address holds. A drag or a glide therefore writes once, at its end. Started once a scene is
// shown, from the view it shows, so the address is not rewritten before there is anything to describe.
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

// The address that opens the scene shown (its own link, for a scene from ?scene= or ?gist=), or null for an embedded or
// local scene, which no link can carry: then the link has the view only, and opens this page.
let sceneLink: string | null = null;
export function setSceneLink(link: string | null): void {
  sceneLink = link;
}

function copyLink(): void {
  const url = new URL(sceneLink ?? location.href);
  url.hash = `${VIEW_KEY}=${encodeView(currentPose())}`;
  const said = sceneLink === null
    ? "Copied the view only: an embedded or local scene cannot go in a link, so the link opens this page at this view."
    : "Copied the link: this scene, at this view.";
  const refused = () => note("Could not copy the link: the browser refused the clipboard.", NOTE_MS);
  try {
    navigator.clipboard.writeText(url.href).then(() => note(said, NOTE_MS), refused);
  } catch {
    refused();
  }
}
byId("copy-link").addEventListener("click", copyLink);
