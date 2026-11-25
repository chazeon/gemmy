// The a b c triad in the SVG: the same solids the live triad draws (render/triad-model.ts), traced like the structure.
// Their own passes (an orthographic camera with the view's orientation, over the corner the live triad occupies) give
// each solid's region and outline, and regions.ts writes them with the fade as the group's opacity. The letters are
// text at the arrow tips, as the page draws them. The group is placed at the corner, so the export's triad lines up
// with the live one.
import * as THREE from "three";
import { AXIS_FONT, AXIS_LETTERS, LOOK } from "../config";
import { fmt, linearHex } from "../export/markup";
import { type Attrs, svgEl } from "../export/svg-dom";
import { type SvgOptions, type View, vec3, viewOfCorner } from "../export/view";
import { OUTLINE_THICKNESS } from "../render/draw";
import { type TriadItem, triadLayout } from "../render/triad-layout";
import {
  type TriadPart,
  partMatrix,
  placeTriadCamera,
  shapeGeometry,
  triadCorner,
  triadModel,
} from "../render/triad-model";
import { type Passes, objectBoxes } from "./buffers";
import { LinePass } from "./edges";
import type { MeshRole, TracedObject } from "./objects";
import { type PassView, type Project, disposeMeshes, projector, renderPasses } from "./passes";
import { type Group, type Layers, type Outlines, curveLookup, ownCurves, traceRegions } from "./regions";
import { snapTolerance } from "./stretch";

// The triad's solids are numbered after the structure's objects in their own id space (their own passes), so their clip
// ids have their own prefix.
const CLIP_PREFIX = "t";

interface TriadSvg {
  node: SVGElement; // the group, in the page's coordinates
  paths: number; // the path elements in it
}

// The triad of the view `o` (its orientation, lattice and size) traced at `scale` render px per CSS px. `view` is the
// structure's view, which gives the axes' directions on the screen.
export function traceTriad(o: SvgOptions, view: View, scale: number): TriadSvg {
  const directions = o.lattice.map((vector) => {
    const v = vec3(vector);
    return [v.dot(view.right), v.dot(view.up), v.dot(view.back)];
  });
  const layout = triadLayout(directions, o.width, o.height);
  // The passes are whole pixels, so the corner is rounded up to them: its frustum is then the image exactly, one unit a
  // px.
  const exact = triadCorner(layout, o.width, o.height);
  const corner = { ...exact, width: Math.ceil(exact.width), height: Math.ceil(exact.height) };
  const top = o.height - corner.height; // the corner's top edge, in the page's rows
  const orientation = new THREE.Quaternion().fromArray(o.quaternion);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  placeTriadCamera(camera, orientation, corner, layout.length);

  // The solids in table order: each axis's shaft and head, then the ball. Each carries its axis's fade.
  const model = triadModel(
    layout.length,
    o.lattice.map((vector) => new THREE.Vector3(...vector)),
  );
  const fadeOf = (part: TriadPart): number =>
    part.axis === null ? 0 : (layout.items.find((item: TriadItem) => item.index === part.axis)?.fade ?? 0);
  const parts = model.map((part) => ({ part, fade: fadeOf(part) }));
  const { meshes, shells, dispose } = solidMeshes(model);

  const pass: PassView = { camera, origin: new THREE.Vector3() };
  const passes = renderPasses(
    { meshes, shells, thin: [], lines: [] },
    { cssWidth: corner.width, cssHeight: corner.height, scale, outlineScale: o.outlineScale, view: pass },
  );
  const group = triadGroup({
    passes,
    project: projector(passes.width, passes.height, pass),
    view: viewOfCorner(orientation, [corner.originX, corner.height - corner.originY]),
    scale,
    parts,
    outlines: {
      on: o.outlines,
      hex: linearHex(LOOK.outline),
      width: OUTLINE_THICKNESS * corner.height,
      scale: o.outlineScale,
      // The live triad's shells are plain meshes, so their outline is not capped to the arrow's radius.
      capped: false,
    },
  });
  const layers = traceRegions(group);
  const letters = layout.items.map((item) => letter(item, layout.fontSize, top));
  dispose();
  return { node: triadNode(layers, letters, top), paths: layers.paths };
}

// The meshes of the solids, for the id, band, depth and mask passes: each solid and its outline shell share a geometry,
// and carry their object's id on every vertex. `dispose` frees them once the passes are done.
function solidMeshes(solids: TriadPart[]): { meshes: THREE.Mesh[]; shells: THREE.Mesh[]; dispose: () => void } {
  const placeholder = new THREE.MeshBasicMaterial();
  const meshes: THREE.Mesh[] = [];
  const shells: THREE.Mesh[] = [];
  solids.forEach((part, index) => {
    const geometry = shapeGeometry(part.shape);
    const count = geometry.getAttribute("position").count;
    geometry.setAttribute("objectId", new THREE.BufferAttribute(new Float32Array(count).fill(index + 1), 1));
    meshes.push(placed(new THREE.Mesh(geometry, placeholder), part, "solid"));
    shells.push(placed(new THREE.Mesh(geometry, placeholder), part, "shell"));
  });
  const dispose = () => {
    disposeMeshes([...meshes, ...shells]);
    placeholder.dispose();
  };
  return { meshes, shells, dispose };
}

function placed(mesh: THREE.Mesh, part: TriadPart, role: MeshRole["role"]): THREE.Mesh {
  mesh.position.copy(part.position);
  mesh.quaternion.copy(part.quaternion);
  mesh.userData = { shape: part.shape.kind, role } satisfies MeshRole;
  return mesh;
}

// The group of the triad: its solids with their passes, their curves (their own only: the triad has no crossings), and
// their paint. Each axis is drawn in its colour, faded by its opacity; the ball is white and never faded.
interface TriadGroupInput {
  passes: Passes;
  project: Project;
  view: View;
  scale: number;
  parts: { part: TriadPart; fade: number }[];
  outlines: Outlines;
}

function triadGroup({ passes, project, view, scale, parts, outlines }: TriadGroupInput): Group {
  const objects: TracedObject[] = parts.map(({ part }) => ({
    kind: part.shape.kind,
    material: null,
    alpha: 1,
    outlined: true,
    centre: [part.position.x, part.position.y, part.position.z],
    matrix: partMatrix(part),
  }));
  const index = new Map(objects.map((obj, i) => [obj, i] as const));
  const rgbOf = parts.map(({ part }) => hexRgb(part.colour));
  const own = (id: number) => ownCurves(objects[id - 1], view);
  return {
    scale,
    objects,
    passes,
    stats: objectBoxes(passes, objects.length),
    view,
    project,
    linePass: new LinePass(project, passes, scale),
    curves: curveLookup(own, () => []),
    tol: snapTolerance(scale),
    paint: {
      rgb: (obj) => rgbOf[index.get(obj)!],
      opacity: (obj) => 1 - parts[index.get(obj)!].fade,
    },
    outlines,
    thin: () => false,
    edgeLine: () => null,
    clipPrefix: CLIP_PREFIX,
  };
}

// One axis letter at its label: the label is in the page's rows, so it moves up by `top` into the group.
function letter(item: TriadItem, fontSize: number, top: number): SVGElement {
  const attrs: Attrs = {
    x: item.label.x,
    y: item.label.y - top,
    fill: LOOK.axisColors[item.index],
    opacity: 1 - item.fade,
    "text-anchor": "middle",
    "dominant-baseline": "central",
    "font-family": `'${AXIS_FONT.family}', sans-serif`,
    "font-style": "italic",
    "font-weight": 700,
    "font-size": fontSize,
  };
  return svgEl("text", attrs, [AXIS_LETTERS[item.index]]);
}

// The group in the page's coordinates: the corner's content, moved to the corner's top edge.
function triadNode(layers: Layers, letters: SVGElement[], top: number): SVGElement {
  return svgEl("g", { id: "triad", "stroke-linecap": "round", transform: `translate(0 ${fmt(top)})` }, [
    svgEl("defs", {}, layers.clips),
    ...layers.fills,
    ...layers.outlines,
    ...letters,
  ]);
}

// A colour from its CSS hex, as sRGB components in 0..1 (the form the fills take).
function hexRgb(hex: string): number[] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
}
