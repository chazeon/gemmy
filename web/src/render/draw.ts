// The three.js scene the viewer draws: the renderer and cameras, the lights, the toon and outline materials, and the
// shared unit shapes that instancing.ts places. Built once when the page loads. scene/load.ts fills `root` from a scene
// document, and disposeScene() empties it again.
import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { ARROW, GEMMY, LOOK } from "../config";
import { camera } from "../state";
import type { Scene } from "../types";
import { MATRIX_SIZE } from "./instancing";
import { makeToonGradient, polygonOffsetOf } from "./toon";

// ---- constants (the Blender render's numbers where a counterpart exists) ----
// The canvas is drawn at the screen's pixel ratio, up to this many pixels per CSS pixel. triad.ts uses the same cap.
export const MAX_PIXEL_RATIO = 2;
const CLIP_NEAR = 0.1; // both cameras clip the same range; scene/load.ts widens the ortho far plane to the scene
const CLIP_FAR = 100;
const PLACEHOLDER_FOV_DEG = 30; // the perspective field of view until resize() sets it from the lens
// The outline shell's offset in clip space per unit of w. The full image height is 2 clip units, so this is about
// 0.0018 of the height on each side; trace/passes.ts uses the same number. Blender's counterpart is look.outline_width
// (looks.py:38, 0.0022 of the height, as a line width).
export const OUTLINE_THICKNESS = 0.0035;
// The outline is at most this share of the shape's on-screen radius (outlineWidth in OUTLINE_VERTEX_SHADER). Where
// atoms are a few pixels across, a constant width would be most of the shape, so it thins with them. Shapes with a
// radius above about OUTLINE_THICKNESS / OUTLINE_SIZE_FRACTION (about 1.5% of the image height) keep the constant
// width.
export const OUTLINE_SIZE_FRACTION = 0.12;
const ATOM_SEGMENTS = { width: 48, height: 24 }; // smooth spheres for the atoms; no counterpart in geom.py
const DOT_SEGMENTS = { width: 12, height: 8 }; // the dots of dotted bonds; same as geom.DOT_SEGMENTS and DOT_RINGS
const TUBE_SEGMENTS = 24; // around a cylinder or a cone; Blender uses geom.CYLINDER_SIDES = 32

// ---- renderer, scene and cameras ----
export const stage = document.getElementById("stage") as HTMLElement;
export const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO));
renderer.setClearColor(0x000000, 0); // transparent, so the page shows through
stage.appendChild(renderer.domElement);

export const scene = new THREE.Scene();
export const root = new THREE.Group(); // the structure: scene/load.ts adds the atoms, bonds and polyhedra here
scene.add(root);

export const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, CLIP_NEAR, CLIP_FAR); // resize() sets its frustum
export const perspCamera = new THREE.PerspectiveCamera(PLACEHOLDER_FOV_DEG, 1, CLIP_NEAR, CLIP_FAR);
perspCamera.filmGauge = GEMMY.sensorWidth; // Blender's sensor width: it spans the larger side of the image in both
scene.add(orthoCamera, perspCamera);
camera.value = orthoCamera; // the view starts orthographic (state.ts)

// ---- lights: toon irradiance ----
// The ambient light gives the shaded band (LOOK.dark), and the key light adds the rest, so a lit face comes out fully
// bright (addToonLights). The key light hangs off the camera, so it always comes from the upper left.
export const key = addToonLights(scene, orthoCamera);
// The trackball controls drive the camera on show. They are made here, next to the camera and the renderer.
export const controls = new TrackballControls(orthoCamera, renderer.domElement);

// ---- materials ----
// Polyhedron edges and the cell box are lines: the edges take the outline colour, the box takes the theme's colour.
export const edgeMaterial = new THREE.LineBasicMaterial({ color: srgbColor(LOOK.outline) });
export const boxMaterial = new THREE.LineBasicMaterial(); // its colour is set from the page theme (loop.ts)

// The outline of a mesh is a back-face copy of it, pushed outwards on the screen. three's OutlineEffect would do this
// too, but its vertex shader leaves out the instancing chunks, so an InstancedMesh would be displaced from the origin.
// Instances carry their normals through the instance matrix the way three does it, so stretched cylinders keep round
// outlines. trace/passes.ts draws the same shell with this vertex shader, so the traced outline matches the live one.
const MIN_OUTLINE_W = CLIP_NEAR; // a vertex at or nearer than the near plane (w is the depth) gets no push
const MIN_OUTLINE_DIRECTION = 1e-6; // a normal along the view ray has no screen direction, so no push either
export const OUTLINE_VERTEX_SHADER = `
    uniform float outlineThickness;
    uniform float outlineScale; // the user's width (ui/outline-scale.ts): 1 is the automatic width
    // A float literal: GLSL reads a bare integer as int.
    #define OUTLINE_SIZE_FRACTION ${OUTLINE_SIZE_FRACTION.toFixed(3)}
    #define MIN_OUTLINE_W ${MIN_OUTLINE_W.toFixed(3)}
    #define MIN_OUTLINE_DIRECTION ${MIN_OUTLINE_DIRECTION.toFixed(9)}

    // The outline's width, in NDC (the image spans 2 units). The shell is pushed out by this much and then multiplied
    // by w, so the clip-space offset is the same as the constant width was when the cap does not apply.
    //   Constant width: outlineThickness, a fixed share of the image height.
    //   Cap: OUTLINE_SIZE_FRACTION times the shape's on-screen radius. A sphere of radius r at depth d projects to
    //   r * P11 / w on the screen in NDC (P11 = projectionMatrix[1][1]; w = d in perspective, w = 1 in orthographic,
    //   so there r * P11 is the radius as it is). Dividing by w by hand gives the cap in NDC; with w = 1 it is r * P11.
    //   The shell is the smaller of the two, so the outline never exceeds today's width, and it thins only where the
    //   shape is small on the screen. A plain mesh (radius 1e9) has no cap.
    float outlineWidth(float clipW, float radius) {
      float capWidth = OUTLINE_SIZE_FRACTION * radius * projectionMatrix[1][1] / clipW;
      return min(outlineThickness, capWidth);
    }

    // The shell's clip position for one vertex: the vertex moved on the screen along its outward normal by the outline
    // width. clipNormal is projectionMatrix * modelViewMatrix applied to the normal as a direction (w = 0). Moving the
    // point by t along the normal moves its clip position by t * clipNormal, so the screen position moves in the
    // direction of (clipNormal.xy * w - clipNormal.w * clip.xy), exactly, with no offset point to pick. That direction
    // is normalised in 2D, so the outline is the full width in every direction. A vertex at or behind the near plane
    // has no usable screen position, so it stays where it is.
    vec4 outlinePosition(vec4 clipPos, vec4 clipNormal, float radius) {
      if (clipPos.w <= MIN_OUTLINE_W) return clipPos;
      vec2 screenDirection = clipPos.w * clipNormal.xy - clipNormal.w * clipPos.xy;
      float length2D = length(screenDirection);
      if (!(length2D > MIN_OUTLINE_DIRECTION)) return clipPos; // also false for NaN
      float width = outlineWidth(clipPos.w, radius) * outlineScale;
      return vec4(clipPos.xy + screenDirection / length2D * width * clipPos.w, clipPos.zw);
    }

    void main() {
      vec4 local = vec4(position, 1.0);
      vec3 normalLocal = normal;
      // The instance's cross-section radius: the shorter of its X and Z columns (a cylinder's axis is local Y, and
      // a sphere has equal columns). A plain mesh has no instance, so it gets no cap.
      float radius = 1e9;
      #ifdef USE_INSTANCING
        mat3 instanceRotation = mat3(instanceMatrix);
        // dividing each column by its squared length gives the inverse transpose for a scaled instance
        vec3 columnSquared = vec3(
          dot(instanceRotation[0], instanceRotation[0]),
          dot(instanceRotation[1], instanceRotation[1]),
          dot(instanceRotation[2], instanceRotation[2]));
        normalLocal = instanceRotation * (normal / columnSquared);
        local = instanceMatrix * local;
        radius = min(length(instanceRotation[0]), length(instanceRotation[2]));
      #endif
      normalLocal = normalize(normalLocal);
      mat4 clipFromLocal = projectionMatrix * modelViewMatrix;
      gl_Position = outlinePosition(clipFromLocal * local, clipFromLocal * vec4(normalLocal, 0.0), radius);
    }`;
const OUTLINE_FRAGMENT_SHADER = `
    uniform vec3 outlineColor;
    void main() {
      gl_FragColor = vec4(outlineColor, 1.0);
      #include <colorspace_fragment>
    }`;
export const outlineMaterial = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  uniforms: {
    outlineThickness: { value: OUTLINE_THICKNESS },
    outlineScale: { value: 1 },
    // These numbers are read as linear colour (Color.fromArray) and colorspace_fragment then encodes them to sRGB, so
    // the outline shows lighter than the edges (edgeMaterial reads LOOK.outline as sRGB). Blender's Freestyle line
    // colour, set from the same numbers in renderer.py, is linear too; the render match depends on this.
    outlineColor: { value: new THREE.Color().fromArray(LOOK.outline) },
  },
  vertexShader: OUTLINE_VERTEX_SHADER,
  fragmentShader: OUTLINE_FRAGMENT_SHADER,
});

const toonGradient = makeToonGradient();
let toonMaterials = new Map<string, THREE.MeshToonMaterial>();

// The toon material of one material id, from the scene's material table (null: the arrow colour, which needs no table).
// Cached, so every mesh of one material shares it. faces: a polyhedron's faces. ghost: a see-through polyhedron,
// blended by its alpha so it does not hide what is inside.
export function toon(
  id: string | null,
  materials: Scene["materials"],
  { faces = false, ghost = false } = {},
): THREE.MeshToonMaterial {
  const cacheKey = `${id}|${faces}|${ghost}`;
  if (!toonMaterials.has(cacheKey)) toonMaterials.set(cacheKey, makeToon(id, materials, faces, ghost));
  return toonMaterials.get(cacheKey)!;
}

// ---- shared unit shapes, placed by instance matrices (see instancing.ts) ----
export const SHAPES = {
  sphere: () => new THREE.SphereGeometry(1, ATOM_SEGMENTS.width, ATOM_SEGMENTS.height),
  dot: () => new THREE.SphereGeometry(1, DOT_SEGMENTS.width, DOT_SEGMENTS.height),
  cylinder: () => new THREE.CylinderGeometry(1, 1, 1, TUBE_SEGMENTS, 1),
  cone: () => new THREE.ConeGeometry(1, 1, TUBE_SEGMENTS, 1),
};

// One InstancedMesh that draws every instance in `matrices` (MATRIX_SIZE numbers each).
export function instanced(
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  matrices: readonly number[],
): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length / MATRIX_SIZE);
  mesh.instanceMatrix.array.set(matrices);
  mesh.frustumCulled = false; // the instances span the structure, so a bounding sphere would only cost time
  return mesh;
}

// Sets the user's outline width, a multiplier on the automatic width (1 is the default).
export function setOutlineScale(scale: number): void {
  outlineMaterial.uniforms.outlineScale.value = scale;
}

// The outline of a mesh: the same geometry, and for an InstancedMesh the same matrices, drawn back-face with
// outlineMaterial.
export function outlineOf(mesh: THREE.Mesh): THREE.Mesh {
  if (mesh instanceof THREE.InstancedMesh) {
    const outline = new THREE.InstancedMesh(mesh.geometry, outlineMaterial, mesh.count);
    outline.instanceMatrix = mesh.instanceMatrix;
    outline.frustumCulled = false;
    return outline;
  }
  const outline = new THREE.Mesh(mesh.geometry, outlineMaterial);
  outline.frustumCulled = false;
  return outline;
}

// ---- teardown ----
// Frees the geometries, instanced meshes and toon materials, then empties root. Called before a new scene is loaded.
export function disposeScene(): void {
  root.traverse((object) => {
    (object as THREE.Mesh).geometry?.dispose();
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  for (const material of toonMaterials.values()) material.dispose();
  toonMaterials = new Map();
  root.clear();
}

// ---- helpers ----
// A CSS custom property of the page, as written (the theme's colours and the label font come through here).
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name);
}

// A page colour as sRGB hex, for the page's scheme. The tokens are light-dark() of oklch colours (style.css), which three.js
// and SVG tools do not read, so a hidden probe takes the token as its colour, one pixel is painted with what the browser
// resolves, and the pixel is read back. The probe stays in the page.
const colourProbe = document.createElement("span");
colourProbe.hidden = true;
document.body.append(colourProbe);
const colourPixel = document
  .createElement("canvas")
  .getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D;
colourPixel.canvas.width = colourPixel.canvas.height = 1;
export function colourVar(name: string): string {
  colourProbe.style.color = `var(${name})`;
  colourPixel.fillStyle = getComputedStyle(colourProbe).color;
  colourPixel.fillRect(0, 0, 1, 1);
  const [r, g, b] = colourPixel.getImageData(0, 0, 1, 1).data;
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

// How far the live stage is moved left by the open dock, in CSS px: half the dock's space, which style.css sets (--dock-reserved,
// on the body: nothing unless the dock is open on a wide screen with a scene). The triad's corner is moved right by it to stay
// in view. Exports do not call this: they keep the full canvas.
export function dockInset(): number {
  return Number.parseFloat(getComputedStyle(document.body).getPropertyValue("--dock-reserved")) / 2;
}

// A page colour from its sRGB components (the scene's colours are sRGB, as colour pickers show them).
function srgbColor(rgb: readonly number[]): THREE.Color {
  return new THREE.Color().setRGB(rgb[0], rgb[1], rgb[2], THREE.SRGBColorSpace);
}

function baseColorOf(id: string | null, materials: Scene["materials"]): readonly number[] {
  return id === null ? ARROW.color : materials[id].base_color;
}

function alphaOf(id: string | null, materials: Scene["materials"]): number {
  return id === null ? 1 : (materials[id].alpha ?? 1);
}

function makeToon(
  id: string | null,
  materials: Scene["materials"],
  faces: boolean,
  ghost: boolean,
): THREE.MeshToonMaterial {
  const material = new THREE.MeshToonMaterial({
    color: srgbColor(baseColorOf(id, materials)),
    gradientMap: toonGradient,
    ...polygonOffsetOf(faces),
  });
  if (ghost) {
    material.transparent = true;
    material.opacity = alphaOf(id, materials);
    material.depthWrite = false;
    // Test hook: tests/browser/driver.mjs keeps window.__gl, and each see-through material's opacity is listed there, so
    // the panel scenario reads what a polyhedron is drawn at.
    const gl = (window as { __gl?: { opacities?: number[] } }).__gl;
    if (gl !== undefined) {
      gl.opacities ??= [];
      gl.opacities.push(material.opacity);
    }
  }
  return material;
}

// The toon lights of a scene (the structure's and the triad's): the ambient light goes in the scene, the key light with
// its target on the camera, so the key follows the camera. Returns the key light.
export function addToonLights(parent: THREE.Object3D, camera: THREE.Object3D): THREE.DirectionalLight {
  parent.add(new THREE.AmbientLight(0xffffff, LOOK.dark * Math.PI));
  const key = new THREE.DirectionalLight(0xffffff, (1 - LOOK.dark) * Math.PI);
  key.position.set(...LOOK.key);
  camera.add(key, key.target);
  return key;
}
