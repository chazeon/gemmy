// The offscreen passes the traced SVG reads back, all with the live camera and the live structure's transform, so each
// pixel lines up with the live view exactly:
//   - the object id of every pixel (the depth test decides which object is in front, so occlusion and intersections come
//     out of the GPU);
//   - the toon band of every pixel (lit or dark);
//   - the depth of the nearest object at every pixel (for the sub-pixel visibility of edges and the cell box, and the
//     depth jumps that make a silhouette).
// The keys combine the first two: key = 2 * id + dark, so each object has a lit key and a dark key; key 0 is background.
import * as THREE from "three";
import { LOOK } from "../config";
import { renderer, root } from "../render/draw";
import { camera } from "../state";

// ---- constants ----
// draw.ts builds its toon gradient with this many texels. The band pass must put the lit/dark edge where the gradient
// does, so the same count gives the same cut (see LIT_CUT).
const TOON_STEPS = 16;
const DEPTH_SCALE = 16777215; // 2^24 - 1: the depth is packed into the three bytes of a pixel
const BACKGROUND_DEPTH = 2; // the depth of a pixel with no object: beyond any NDC depth in [0, 1]

// The id pass: a flat colour per object, no lighting, no tone mapping, no antialiasing. The id is split into bytes, low
// byte first, and written as exact 0..255 values (the render target is 8-bit and colour management is off for it).
const ID_VERTEX = `
    attribute float objectId;
    flat varying float vObject;
    void main() {
      vObject = objectId;
      vec4 local = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        local = instanceMatrix * local;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * local;
    }`;
const ID_FRAGMENT = `
    flat varying float vObject;
    void main() {
      float lo = mod(vObject, 256.0);
      float mid = mod(floor(vObject / 256.0), 256.0);
      float hi = floor(vObject / 65536.0);
      gl_FragColor = vec4(lo, mid, hi, 255.0) / 255.0;
    }`;

// The band pass: red is 1 where the toon material is lit and 0 where it is shaded. The normal is the same one the toon
// material uses (view space, from the instance matrix the way draw.ts's outline shader transforms it), and the light is
// the key light, which hangs off the camera at LOOK.key, so its direction in view space is LOOK.key itself.
const BAND_VERTEX = `
    varying vec3 vNormal;
    void main() {
      vec3 n = normal;
      vec4 local = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        mat3 m = mat3(instanceMatrix);
        // dividing each column by its squared length gives the inverse transpose for a scaled instance
        n = m * (n / vec3(dot(m[0], m[0]), dot(m[1], m[1]), dot(m[2], m[2])));
        local = instanceMatrix * local;
      #endif
      vNormal = normalMatrix * n;
      gl_Position = projectionMatrix * modelViewMatrix * local;
    }`;
const BAND_FRAGMENT = `
    uniform vec3 lightDir; // view space, unit length: towards the key light
    uniform float litCut; // N.L at which the toon gradient turns lit
    varying vec3 vNormal;
    void main() {
      float lit = dot(normalize(vNormal), lightDir) >= litCut ? 1.0 : 0.0;
      gl_FragColor = vec4(lit, 0.0, 0.0, 1.0);
    }`;

// The depth pass: the fragment's depth (gl_FragCoord.z, the NDC depth mapped to 0..1) packed into 24 bits.
const DEPTH_FRAGMENT = `
    void main() {
      float v = floor(gl_FragCoord.z * ${DEPTH_SCALE.toFixed(1)} + 0.5);
      gl_FragColor = vec4(mod(v, 256.0), mod(floor(v / 256.0), 256.0), floor(v / 65536.0), 255.0) / 255.0;
    }`;
const PLAIN_VERTEX = `
    void main() {
      vec4 local = vec4(position, 1.0);
      #ifdef USE_INSTANCING
        local = instanceMatrix * local;
      #endif
      gl_Position = projectionMatrix * modelViewMatrix * local;
    }`;

// The toon gradient is looked up at dotNL * 0.5 + 0.5 and the texel is floor(coord * TOON_STEPS). A texel is lit from
// firstLit on (draw.ts makeToonGradient), so the lit test is dotNL >= 2 * firstLit / TOON_STEPS - 1.
const FIRST_LIT = Math.ceil(((LOOK.threshold + 1) / 2) * TOON_STEPS);
const LIT_CUT = (2 * FIRST_LIT) / TOON_STEPS - 1;

// The polyhedron faces are pushed back a little in the depth test, as draw.ts does (FACE_OFFSET_FACTOR and _UNITS), so the
// atoms that touch a face's vertex are in front of it in every pass, as in the live view.
const FACE_OFFSET_FACTOR = 1;
const FACE_OFFSET_UNITS = 1;

// One pass's shader material. faces: the polyhedron faces' version, with the offset above. The passes must agree on the
// offset, or a face would win a pixel in one pass and lose it in another.
export function passMaterial(pass: Pass, faces: boolean): THREE.ShaderMaterial {
  const offset = faces ? { polygonOffset: true, polygonOffsetFactor: FACE_OFFSET_FACTOR, polygonOffsetUnits: FACE_OFFSET_UNITS } : {};
  switch (pass) {
    case "id":
      return new THREE.ShaderMaterial({ vertexShader: ID_VERTEX, fragmentShader: ID_FRAGMENT, ...offset });
    case "band":
      return new THREE.ShaderMaterial({
        vertexShader: BAND_VERTEX,
        fragmentShader: BAND_FRAGMENT,
        uniforms: { lightDir: { value: new THREE.Vector3(...LOOK.key).normalize() }, litCut: { value: LIT_CUT } },
        ...offset,
      });
    case "depth":
      return new THREE.ShaderMaterial({ vertexShader: PLAIN_VERTEX, fragmentShader: DEPTH_FRAGMENT, ...offset });
  }
}
type Pass = "id" | "band" | "depth";

// The id scene: the structure's transform (root.position, the centre offset), then the object meshes.
function idScene(meshes: Drawable[]): THREE.Scene {
  const group = new THREE.Group();
  group.position.copy(root.position);
  group.add(...meshes);
  const scene = new THREE.Scene();
  scene.add(group);
  return scene;
}

interface Passes {
  keys: Uint32Array; // per pixel, top row first: 0 background, else 2 * id + dark
  lineId: Uint32Array; // per pixel, from the line pass: the id of the thin bond, edge or box line that is the nearest surface here (0: none)
  depth: Float32Array; // per pixel: the nearest object's NDC depth in 0..1, or BACKGROUND_DEPTH
  shell: Uint8Array; // per pixel: 1 where the live view's outline shell is the visible surface, else 0
  width: number;
  height: number;
}

// The outline shell, ported from render/draw.ts (outlineMaterial and its vertex shader): the back faces pushed out, with the
// on-screen-size cap. Only its visibility is read here, so the fragment writes a plain red 1.
const OUTLINE_THICKNESS = 0.0035; // draw.ts OUTLINE_THICKNESS (not exported there)
const OUTLINE_SIZE_FRACTION = 0.12; // draw.ts OUTLINE_SIZE_FRACTION (not exported there)
const SHELL_VERTEX = `
    uniform float outlineThickness;
    uniform float outlineScale;
    #define OUTLINE_SIZE_FRACTION ${OUTLINE_SIZE_FRACTION.toFixed(3)}
    float outlineWidth(float clipW, float radius) {
      float capWidth = OUTLINE_SIZE_FRACTION * radius * projectionMatrix[1][1] / clipW;
      return min(outlineThickness, capWidth);
    }
    void main() {
      vec4 local = vec4(position, 1.0);
      vec3 normalLocal = normal;
      float radius = 1e9;
      #ifdef USE_INSTANCING
        mat3 instanceRotation = mat3(instanceMatrix);
        normalLocal = instanceRotation * (normal / vec3(dot(instanceRotation[0], instanceRotation[0]), dot(instanceRotation[1], instanceRotation[1]), dot(instanceRotation[2], instanceRotation[2])));
        local = instanceMatrix * local;
        radius = min(length(instanceRotation[0]), length(instanceRotation[2]));
      #endif
      normalLocal = normalize(normalLocal);
      vec4 clipPos = projectionMatrix * modelViewMatrix * local;
      vec4 clipPosInward = projectionMatrix * modelViewMatrix * vec4(local.xyz - normalLocal, 1.0);
      float width = outlineWidth(clipPos.w, radius) * outlineScale;
      gl_Position = clipPos + normalize(clipPos - clipPosInward) * width * clipPos.w;
    }`;
const SHELL_FRAGMENT = `
    void main() {
      gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    }`;
const ZERO_FRAGMENT = `
    void main() {
      gl_FragColor = vec4(0.0);
    }`;

// The shell's material: the back faces only, as in the live view.
const shellMaterial = (): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  vertexShader: SHELL_VERTEX,
  fragmentShader: SHELL_FRAGMENT,
  side: THREE.BackSide,
  uniforms: { outlineThickness: { value: OUTLINE_THICKNESS }, outlineScale: { value: 1 } },
});

// The mask's occluders: the normal geometry writes depth and outputs 0, so a shell only shows where nothing nearer covers it.
// Polyhedron faces take the same polygon offset as the other passes, so their depth agrees with the live view's.
const occluderMaterial = (faces: boolean): THREE.ShaderMaterial => new THREE.ShaderMaterial({
  vertexShader: PLAIN_VERTEX,
  fragmentShader: ZERO_FRAGMENT,
  ...(faces ? { polygonOffset: true, polygonOffsetFactor: FACE_OFFSET_FACTOR, polygonOffsetUnits: FACE_OFFSET_UNITS } : {}),
});

// Drawn objects: meshes and line segments. A drawable's id is its objectId attribute; `kind` says which pass shows it.
export type Drawable = THREE.Mesh | THREE.LineSegments;

// Renders `cssWidth` x `cssHeight` at `scale` times the stage, tile by tile when the GPU's texture limit is smaller.
//   meshes: the objects of the id, band and depth passes (and the occluders of the other passes);
//   shells: the live view's outline shells, in the mask pass only;
//   thin: thin bonds and dots (drawn as lines), in the line pass only, with their table ids;
//   lines: the polyhedron edges and the cell box, in the line pass only, with their own ids.
// Each tile gets five passes; the readback is bottom-up, so rows are flipped here.
export function renderPasses(meshes: THREE.Mesh[], shells: THREE.Mesh[], thin: THREE.Mesh[], lines: THREE.LineSegments[], cssWidth: number, cssHeight: number, scale: number): Passes {
  const width = cssWidth * scale;
  const height = cssHeight * scale;
  const keys = new Uint32Array(width * height);
  const depth = new Float32Array(width * height).fill(BACKGROUND_DEPTH);
  const shell = new Uint8Array(width * height);
  const lineId = new Uint32Array(width * height);
  // One scene for every pass: each group is switched on for the passes that use it.
  const all: Drawable[] = [...meshes, ...shells, ...thin, ...lines];
  const scene = idScene(all);
  // Each pass has an atom material and a polyhedron-face material; a mesh takes the one its shape calls for.
  const materials: Record<Pass, [THREE.ShaderMaterial, THREE.ShaderMaterial]> = {
    id: [passMaterial("id", false), passMaterial("id", true)],
    band: [passMaterial("band", false), passMaterial("band", true)],
    depth: [passMaterial("depth", false), passMaterial("depth", true)],
  };
  const pick = (pass: Pass) => (mesh: Drawable) => materials[pass][mesh.userData.shape === "polyhedron" ? 1 : 0];
  const maskShell = shellMaterial();
  const maskPlain = occluderMaterial(false);
  const maskFaces = occluderMaterial(true);
  const maskPick = (mesh: Drawable) => (mesh.userData.shell ? maskShell : mesh.userData.shape === "polyhedron" ? maskFaces : maskPlain);
  // The line pass: occluders are the normal geometry (zero output); thin bonds and lines write their ids.
  const lineIdMaterial = passMaterial("id", false);
  const linePick = (mesh: Drawable) => (mesh.userData.line || mesh.userData.thin ? lineIdMaterial : mesh.userData.shape === "polyhedron" ? maskFaces : maskPlain);
  // Which groups are on in each pass.
  const show = (pass: "id" | "band" | "depth" | "mask" | "line") => {
    for (const m of shells) m.visible = pass === "mask";
    for (const m of [...thin, ...lines]) m.visible = pass === "line";
  };
  const tile = renderer.capabilities.maxTextureSize;
  camera.updateMatrixWorld();
  for (let y0 = 0; y0 < height; y0 += tile) {
    for (let x0 = 0; x0 < width; x0 += tile) {
      const tw = Math.min(tile, width - x0);
      const th = Math.min(tile, height - y0);
      camera.setViewOffset(width, height, x0, y0, tw, th); // the full image's camera, looking at this tile only
      show("id");
      const ids = readPass(scene, all, pick("id"), tw, th);
      show("band");
      const bands = readPass(scene, all, pick("band"), tw, th);
      show("depth");
      const depths = readPass(scene, all, pick("depth"), tw, th);
      show("mask");
      const masks = readPass(scene, all, maskPick, tw, th);
      show("line");
      const lines32 = readPass(scene, all, linePick, tw, th);
      for (let row = 0; row < th; row++) {
        const topRow = th - 1 - row; // readRenderTargetPixels is bottom-up
        for (let col = 0; col < tw; col++) {
          const src = (row * tw + col) * 4;
          const dst = (y0 + topRow) * width + x0 + col;
          shell[dst] = masks[src] >= 128 ? 1 : 0;
          lineId[dst] = lines32[src] + 256 * lines32[src + 1] + 65536 * lines32[src + 2];
          const id = ids[src] + 256 * ids[src + 1] + 65536 * ids[src + 2];
          if (id === 0) continue;
          const dark = bands[src] < 128 ? 1 : 0; // the band pass writes 1 for lit, so the dark keys are the odd ones
          keys[dst] = 2 * id + dark;
          depth[dst] = (depths[src] + 256 * depths[src + 1] + 65536 * depths[src + 2]) / DEPTH_SCALE;
        }
      }
    }
  }
  camera.clearViewOffset();
  for (const pair of Object.values(materials)) for (const material of pair) material.dispose();
  maskShell.dispose();
  maskPlain.dispose();
  maskFaces.dispose();
  lineIdMaterial.dispose();
  return { keys, depth, shell, lineId, width, height };
}

// One pass over one tile: every drawable drawn with `materialOf`, the pixels read back as RGBA bytes (bottom row first).
function readPass(scene: THREE.Scene, all: Drawable[], materialOf: (mesh: Drawable) => THREE.Material, tw: number, th: number): Uint8Array {
  for (const mesh of all) mesh.material = materialOf(mesh);
  const target = new THREE.WebGLRenderTarget(tw, th, { depthBuffer: true, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false });
  renderer.setRenderTarget(target);
  renderer.render(scene, camera);
  const pixels = new Uint8Array(tw * th * 4);
  renderer.readRenderTargetPixels(target, 0, 0, tw, th, pixels);
  renderer.setRenderTarget(null);
  target.dispose();
  return pixels;
}

// The meshes are built for this export alone, so their geometry goes when the export is done.
export function disposeMeshes(meshes: Drawable[]): void {
  for (const mesh of meshes) mesh.geometry.dispose();
}

// Maps a scene point to the render's pixel grid: x and y in render-scale pixels (y down), and the NDC depth in 0..1, by the
// same camera and structure transform the passes used.
export function projector(width: number, height: number): (p: THREE.Vector3) => { x: number; y: number; depth: number } {
  return (p) => {
    const ndc = p.clone().add(root.position).applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
    return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height, depth: ndc.z / 2 + 0.5 };
  };
}
