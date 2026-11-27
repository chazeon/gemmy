// The a b c triad in 3D: three arrows and the origin ball, drawn into the bottom-left corner of the page after the
// structure. A second scene with an orthographic camera takes the main camera's orientation (not its position), so the
// arrows never warp with the lens. The arrows use the atoms' toon shading and outline (draw.ts), and the depth test
// gives the occlusion: an arrow pointing away goes behind the ball and the arrows pointing towards the viewer. The
// solids and the camera come from triad-model.ts (shared with the SVG trace). The letters are not here: they stay flat
// text on the page (triad.ts).
import * as THREE from "three";
import { LOOK } from "../config";
import { outlines, camera, loaded } from "../state";
import { captureMode } from "../ui/capture";
import {
  OUTLINE_THICKNESS,
  OUTLINE_VERTEX_SHADER,
  addToonLights,
  cssVar,
  outlineMaterial,
  renderer,
  stage,
  toon,
} from "./draw";
import { type TriadItem, latticeInView, triadLayout } from "./triad-layout";
import { type TriadPart, placeTriadCamera, shapeGeometry, triadCorner, triadModel } from "./triad-model";

// Every solid is drawn with its outline: a toon-shaded mesh, and the inverted-hull shell behind it (draw.ts
// OUTLINE_VERTEX_SHADER), which has its own colour and opacity so that the fade reaches the outline too.
interface Solid {
  mesh: THREE.Mesh;
  outline: THREE.Mesh;
  toon: THREE.MeshToonMaterial;
  shell: THREE.ShaderMaterial;
}

const triadScene = new THREE.Scene();
const triadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
triadScene.add(triadCamera);
addToonLights(triadScene, triadCamera);

// The solids in the model's order (shafts, heads, then the ball): one record each, made once and kept for the page.
const SOLID_COUNT = 2 * LOOK.axisColors.length + 1;
const solids: Solid[] = Array.from({ length: SOLID_COUNT }, () => {
  const toonMat = toonMaterial();
  const shell = outlineShell();
  return { toon: toonMat, shell, mesh: new THREE.Mesh(undefined, toonMat), outline: new THREE.Mesh(undefined, shell) };
});
for (const solid of solids) {
  for (const mesh of [solid.mesh, solid.outline]) {
    mesh.frustumCulled = false; // the arrows sit at the origin and the camera always frames them
    triadScene.add(mesh);
  }
}

// The geometry depends on the triad length, so it is rebuilt when the length changes (on resize), not every frame.
let builtLength = 0;

// Each frame: the camera follows the main camera's orientation, the arrows and ball are set out for this frame's
// length and theme, then the triad is drawn into its corner with the depth buffer cleared, so the arrows go over the
// structure but are occluded among themselves. `transparent` is the PNG export without a page background: the faded
// parts then take their opacity rather than a mix toward the background.
export function renderTriad(transparent = false, inset = 0): void {
  if (captureMode) return; // capture mode draws the structure alone
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  const layout = triadLayout(latticeInView(loaded.value.lattice, camera.value.quaternion), width, height, inset);
  const corner = triadCorner(layout, width, height);
  const parts = triadModel(layout.length, loaded.value.lattice);
  ensureGeometry(parts, layout.length);
  placeTriadCamera(triadCamera, camera.value.quaternion, corner, layout.length);
  const background = transparent ? null : new THREE.Color(cssVar("--bg").trim());
  paintSolids(parts, layout.items, background);
  placeSolids(parts);

  const autoClear = renderer.autoClear;
  renderer.autoClear = false; // the colour stays: the triad goes over the structure
  renderer.setViewport(0, 0, corner.width, corner.height);
  renderer.setScissor(0, 0, corner.width, corner.height);
  renderer.setScissorTest(true);
  renderer.clearDepth();
  renderer.render(triadScene, triadCamera);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, width, height);
  renderer.autoClear = autoClear;
}

// Colours, fades and the Outlines toggle for this frame. On the page an axis pointing away is mixed toward the background
// by its fade (as the 2D triad was); in a transparent image it is drawn at its opacity instead. The outlines follow the
// same rule, and the ball is never faded.
function paintSolids(parts: TriadPart[], items: TriadItem[], background: THREE.Color | null): void {
  parts.forEach((part, index) => {
    const fade = part.axis === null ? 0 : (items.find((item) => item.index === part.axis)?.fade ?? 0);
    const { toon: material, shell } = solids[index];
    const base = new THREE.Color(part.colour);
    const outlineBase = new THREE.Color().fromArray(LOOK.outline);
    material.color.copy(background === null ? base : base.lerp(background, fade));
    shell.uniforms.outlineColor.value.copy(background === null ? outlineBase : outlineBase.lerp(background, fade));
    material.opacity = background === null ? 1 - fade : 1;
    shell.uniforms.opacity.value = material.opacity;
    shell.uniforms.outlineScale.value = outlineMaterial.uniforms.outlineScale.value; // the user's outline width
  });
  for (const { outline } of solids) outline.visible = outlines.value; // the Outlines toggle, as the structure's
}

// The shapes for the current length: each solid's geometry, shared by its outline.
function ensureGeometry(parts: TriadPart[], length: number): void {
  if (length === builtLength) return;
  builtLength = length;
  parts.forEach((part, index) => {
    const geometry = shapeGeometry(part.shape);
    for (const mesh of [solids[index].mesh, solids[index].outline]) {
      mesh.geometry.dispose();
      mesh.geometry = geometry;
    }
  });
}

// Each solid and its outline at its place in the triad.
function placeSolids(parts: TriadPart[]): void {
  parts.forEach((part, index) => {
    for (const mesh of [solids[index].mesh, solids[index].outline]) {
      mesh.position.copy(part.position);
      mesh.quaternion.copy(part.quaternion);
    }
  });
}

// The toon material of the arrows and the ball: the atoms' shading (toon(null, {}) is the arrow colour; its clone takes
// the same gradient and its own colour). Transparent, so an arrow can be drawn at its opacity in a transparent image.
function toonMaterial(): THREE.MeshToonMaterial {
  const material = toon(null, {}).clone();
  material.transparent = true;
  return material;
}

// The inverted-hull outline of the atoms (draw.ts OUTLINE_VERTEX_SHADER), with its own colour and opacity uniforms.
function outlineShell(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    transparent: true,
    uniforms: {
      outlineThickness: { value: OUTLINE_THICKNESS },
      outlineScale: { value: 1 },
      outlineColor: { value: new THREE.Color().fromArray(LOOK.outline) },
      opacity: { value: 1 },
    },
    vertexShader: OUTLINE_VERTEX_SHADER,
    fragmentShader: `
    uniform vec3 outlineColor;
    uniform float opacity;
    void main() {
      gl_FragColor = vec4(outlineColor, opacity);
      #include <colorspace_fragment>
    }`,
  });
}
