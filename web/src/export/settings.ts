// The page's view as the settings `gemmy render` reads: the camera, the cell box and the resolution, as TOML, as JSON,
// and as the command line that reproduces the view. Pure: no THREE, no DOM.
import { type Projection, type Quat, applyQuaternion } from "../camera/framing";
import type { Vec } from "../geom/vector";

// ---- the view as the page exports it: settings for `gemmy render` ----

// The long side of an exported render, in pixels (the page's view is written at this size).
const EXPORT_LONG_SIDE = 1600;

// The page's camera, in page coordinates (the structure's centre is the origin). `box` is the cell box or null.
interface PageView {
  quaternion: Quat;
  zoom: number;
  target: Vec;
  centre: Vec;
  box: unknown; // truthy when the cell box is shown
  width: number;
  height: number;
  projection?: Projection;
  lens?: number;
}

// The same view in scene coordinates, as `gemmy render` takes it.
interface ExportedView {
  projection: Projection;
  lens: number | undefined;
  direction: number[];
  up: number[];
  zoom: number;
  target: number[];
  cellBox: boolean;
  resolution: [number, number];
}

// direction points from the target to the camera; up is the world direction shown up on screen. Numbers are rounded
// to the precision `gemmy render` needs, so the copied settings read well.
export function exportView(view: PageView): ExportedView {
  const { quaternion, zoom, target, centre, box, width, height } = view;
  return {
    projection: view.projection ?? "ortho",
    lens: view.projection === "persp" ? view.lens : undefined,
    direction: applyQuaternion(quaternion, [0, 0, 1]).map((x) => roundTo(x, 4)),
    up: applyQuaternion(quaternion, [0, 1, 0]).map((x) => roundTo(x, 4)),
    zoom: roundTo(zoom, 3),
    target: target.map((t, i) => roundTo(t + centre[i], 4)),
    cellBox: Boolean(box),
    resolution: resolutionFor(width, height),
  };
}

// The settings as the TOML and JSON files `gemmy render --settings` reads: tables of keys, in this order.
type SettingsTables = Record<string, Record<string, TomlValue>>;
function settingsObject(view: ExportedView): SettingsTables {
  return {
    look: { preset: "3to2d" },
    camera: {
      projection: view.projection,
      ...(view.lens === undefined ? {} : { lens: view.lens }),
      direction: view.direction,
      up: view.up,
      zoom: view.zoom,
      target: view.target,
    },
    cell_box: { show: view.cellBox },
    quality: { resolution: view.resolution },
  };
}
export const settingsJson = (view: ExportedView): string => `${JSON.stringify(settingsObject(view), null, 2)}\n`;
export function settingsToml(view: ExportedView): string {
  return Object.entries(settingsObject(view))
    .map(
      ([table, keys]) =>
        `[${table}]\n${Object.entries(keys)
          .map(([k, v]) => `${k} = ${tomlValue(v)}`)
          .join("\n")}\n`,
    )
    .join("\n");
}

// The `gemmy render` command line that reproduces the view (what the "copy command" button puts on the clipboard).
export function renderCommand(view: ExportedView, sceneFile: string): string {
  const [w, h] = view.resolution;
  return [
    "gemmy render",
    "--scene",
    shellWord(sceneFile),
    "--look.preset 3to2d",
    `--camera.projection ${view.projection}`,
    ...(view.lens === undefined ? [] : [`--camera.lens ${view.lens}`]),
    `--camera.direction ${view.direction.join(" ")}`,
    `--camera.up ${view.up.join(" ")}`,
    `--camera.zoom ${view.zoom}`,
    `--camera.target ${view.target.join(" ")}`,
    `--cell-box.show ${view.cellBox ? "True" : "False"}`,
    `--quality.resolution ${w} ${h}`,
    "--out view.png",
  ].join(" ");
}

// The export's resolution: the long side is EXPORT_LONG_SIDE pixels and the other keeps the aspect ratio.
function resolutionFor(width: number, height: number): [number, number] {
  const scale = EXPORT_LONG_SIDE / Math.max(width, height);
  return [Math.round(width * scale), Math.round(height * scale)];
}

// Rounds to `digits` decimals. `|| 0` turns -0 into 0, so the settings never say -0.
const roundTo = (x: number, digits: number): number => {
  const scale = 10 ** digits;
  return Math.round(x * scale) / scale || 0;
};

type TomlValue = string | number | boolean | readonly TomlValue[];
const tomlValue = (v: TomlValue): string => (Array.isArray(v) ? `[${v.map(tomlValue).join(", ")}]` : JSON.stringify(v));

// A path or word as a shell argument: plain words stay bare, anything else is single-quoted.
const shellWord = (text: string): string => (/^[\w@%+=:,./-]+$/.test(text) ? text : `'${text.replace(/'/g, "'\\''")}'`);
