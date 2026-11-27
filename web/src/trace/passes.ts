// The offscreen passes the traced SVG reads back, all with the camera and the transform they are given (PassView: the
// live camera and the structure's transform for the structure, so each pixel lines up with the live view exactly):
//   - the object id of every pixel (the depth test decides which object is in front, so occlusion and intersections
//     come out of the GPU);
//   - the toon band of every pixel (lit or dark);
//   - the depth of the nearest object at every pixel (for the sub-pixel visibility of edges and the cell box, and the
//     depth jumps that make a silhouette).
// The keys combine the first two: key = 2 * id + dark, so each object has a lit key and a dark key; key 0 is
// background.
import * as THREE from "three";
import { LOOK } from "../config";
import { OUTLINE_THICKNESS, OUTLINE_VERTEX_SHADER, renderer } from "../render/draw";
import { LIT_CUT, polygonOffsetOf } from "../render/toon";
import { BACKGROUND_DEPTH, Passes, darkKey, litKey } from "./buffers";
import { roleOf } from "./objects";

const DEPTH_SCALE = 16777215; // 2^24 - 1: the depth is packed into the three bytes of a pixel

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

// The three per-pixel passes: id, band (lit or shaded) and depth.
type Pass = "id" | "band" | "depth";

const PASS_SHADERS: Record<
  Pass,
  { vertexShader: string; fragmentShader: string; uniforms: () => Record<string, THREE.IUniform> }
> = {
  id: { vertexShader: ID_VERTEX, fragmentShader: ID_FRAGMENT, uniforms: () => ({}) },
  band: {
    vertexShader: BAND_VERTEX,
    fragmentShader: BAND_FRAGMENT,
    uniforms: () => ({ lightDir: { value: new THREE.Vector3(...LOOK.key).normalize() }, litCut: { value: LIT_CUT } }),
  },
  depth: { vertexShader: PLAIN_VERTEX, fragmentShader: DEPTH_FRAGMENT, uniforms: () => ({}) },
};

// One pass's shader material. faces: the polyhedron faces' version, with the polygon offset of toon.ts. The passes must
// agree on the offset, or a face would win a pixel in one pass and lose it in another.
export function passMaterial(pass: Pass, faces: boolean): THREE.ShaderMaterial {
  const { vertexShader, fragmentShader, uniforms } = PASS_SHADERS[pass];
  return new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms: uniforms(), ...polygonOffsetOf(faces) });
}

// The camera the passes draw with, and the offset of the objects (the structure sits at the centre offset, the triad at
// the origin).
export interface PassView {
  camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
  origin: THREE.Vector3;
}

// The id scene: the objects, moved by the pass view's origin.
function idScene(meshes: Drawable[], origin: THREE.Vector3): THREE.Scene {
  const group = new THREE.Group();
  group.position.copy(origin);
  group.add(...meshes);
  const scene = new THREE.Scene();
  scene.add(group);
  return scene;
}

// A pass writes 0 or 255 for its flags; a byte at or above this reads as set.
const CHANNEL_ON = 128;

// The three bytes at `offset`, low byte first: the packing the id and depth shaders write.
function unpack24(bytes: Uint8Array, offset: number): number {
  return bytes[offset] + 256 * bytes[offset + 1] + 65536 * bytes[offset + 2];
}

// The outline shell: the same vertex shader as the live view (render/draw.ts), back faces only, drawn in the mask pass.
// Only its visibility is read here, so the fragment writes a plain red 1.
const SHELL_FRAGMENT = `
    void main() {
      gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);
    }`;
const ZERO_FRAGMENT = `
    void main() {
      gl_FragColor = vec4(0.0);
    }`;

// The shell's material: the back faces only, as in the live view.
const shellMaterial = (outlineScale: number): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({
    vertexShader: OUTLINE_VERTEX_SHADER,
    fragmentShader: SHELL_FRAGMENT,
    side: THREE.BackSide,
    uniforms: { outlineThickness: { value: OUTLINE_THICKNESS }, outlineScale: { value: outlineScale } },
  });

// The mask's occluders: the normal geometry writes depth and outputs 0, so a shell only shows where nothing nearer
// covers it. Polyhedron faces take the same polygon offset as the other passes, so their depth agrees with the live
// view's.
const occluderMaterial = (faces: boolean): THREE.ShaderMaterial =>
  new THREE.ShaderMaterial({ vertexShader: PLAIN_VERTEX, fragmentShader: ZERO_FRAGMENT, ...polygonOffsetOf(faces) });

// Drawn objects: meshes and line segments. A drawable's id is its objectId attribute; `kind` says which pass shows it.
type Drawable = THREE.Mesh | THREE.LineSegments;

// The drawable groups renderPasses shows in each pass:
//   meshes: the objects of the id, band and depth passes (and the occluders of the other passes);
//   shells: the live view's outline shells, in the mask pass only;
//   thin: thin bonds and dots (drawn as lines), in the line pass only, with their table ids;
//   lines: the polyhedron edges and the cell box, in the line pass only, with their own ids.
interface Groups {
  meshes: THREE.Mesh[];
  shells: THREE.Mesh[];
  thin: THREE.Mesh[];
  lines: THREE.LineSegments[];
}

// The image renderPasses covers: its CSS size, the render scale, the user's outline width, and the view it draws with.
interface PassOptions {
  cssWidth: number;
  cssHeight: number;
  scale: number; // render px per CSS px
  outlineScale: number;
  view: PassView;
}

// The readbacks of a tile, by what they hold.
type Readback = "ids" | "bands" | "depths" | "masks" | "lineIds";
// The group that is on while a readback is drawn: the outline shells (the mask pass) or the thin shapes and lines (the
// line pass). The other passes show neither.
type Shown = "shells" | "lines" | null;
// One readback of a tile: the group it shows, and the material each drawable takes.
interface PassStep {
  read: Readback;
  shown: Shown;
  materialOf: (mesh: Drawable) => THREE.Material;
}

// Renders the image tile by tile when the GPU's texture limit is smaller than it. Each tile gets its five readbacks, in
// the order of the table in renderPasses; storeTile flips the rows, as the readback is bottom-up.
export function renderPasses(groups: Groups, options: PassOptions): Passes {
  const { meshes, shells, thin, lines } = groups;
  const { cssWidth, cssHeight, scale, outlineScale, view } = options;
  const { camera } = view;
  const width = cssWidth * scale;
  const height = cssHeight * scale;
  const count = width * height;
  const passes = new Passes(
    width,
    height,
    new Uint32Array(count),
    new Float32Array(count).fill(BACKGROUND_DEPTH),
    new Uint8Array(count),
    new Uint32Array(count),
  );
  // One scene for every pass: each group is switched on for the passes that use it.
  const all: Drawable[] = [...meshes, ...shells, ...thin, ...lines];
  const scene = idScene(all, view.origin);
  // Every material made here is freed when the passes are done.
  const used: THREE.Material[] = [];
  const keep = <T extends THREE.Material>(material: T): T => {
    used.push(material);
    return material;
  };
  // A solid pass: the atom material and the polyhedron-face material; a mesh takes the one its shape calls for.
  const solid = (pass: Pass) => {
    const atoms = keep(passMaterial(pass, false));
    const faces = keep(passMaterial(pass, true));
    return (mesh: Drawable) => (roleOf(mesh).shape === "polyhedron" ? faces : atoms);
  };
  // The materials are made in this order, and it matters: three.js draws opaque objects in material-id order, so where
  // two surfaces tie in depth the one drawn first wins a pixel. The solid passes come first, then the mask's, then the
  // line pass's, the order the traced output draws them in.
  const idSolid = solid("id");
  const bandSolid = solid("band");
  const depthSolid = solid("depth");
  const maskShell = keep(shellMaterial(outlineScale));
  // The occluders of the mask and line passes: the normal geometry, drawn as zero.
  const maskPlain = keep(occluderMaterial(false));
  const maskFaces = keep(occluderMaterial(true));
  const occluder = (mesh: Drawable) => (roleOf(mesh).shape === "polyhedron" ? maskFaces : maskPlain);
  const lineIdMaterial = keep(passMaterial("id", false));
  const PASSES: PassStep[] = [
    { read: "ids", shown: null, materialOf: idSolid },
    { read: "bands", shown: null, materialOf: bandSolid },
    { read: "depths", shown: null, materialOf: depthSolid },
    {
      read: "masks",
      shown: "shells",
      materialOf: (mesh) => (roleOf(mesh).role === "shell" ? maskShell : occluder(mesh)),
    },
    {
      read: "lineIds",
      shown: "lines",
      materialOf: (mesh) => {
        const { role } = roleOf(mesh);
        return role === "line" || role === "thin" ? lineIdMaterial : occluder(mesh);
      },
    },
  ];
  const showOnly = (shown: Shown) => {
    for (const m of shells) m.visible = shown === "shells";
    for (const m of [...thin, ...lines]) m.visible = shown === "lines";
  };
  const tile = renderer.capabilities.maxTextureSize;
  camera.updateMatrixWorld();
  try {
    for (let y0 = 0; y0 < height; y0 += tile) {
      for (let x0 = 0; x0 < width; x0 += tile) {
        const tw = Math.min(tile, width - x0);
        const th = Math.min(tile, height - y0);
        camera.setViewOffset(width, height, x0, y0, tw, th); // the full image's camera, looking at this tile only
        const reads = {} as Record<Readback, Uint8Array>;
        for (const step of PASSES) {
          showOnly(step.shown);
          reads[step.read] = readPass(scene, camera, all, step.materialOf, tw, th);
        }
        storeTile(passes, { x0, y0, tw, th, ...reads });
      }
    }
  } finally {
    // A failed pass must not leave the live view with a tile's camera or a render target bound.
    renderer.setRenderTarget(null);
    camera.clearViewOffset();
    for (const material of used) material.dispose();
  }
  return passes;
}

// The readbacks of one tile, at (x0, y0) of the full image, tw by th pixels.
type Tile = { x0: number; y0: number; tw: number; th: number } & Record<Readback, Uint8Array>;

// Copies a tile's readbacks into the passes: each pixel's object and band become its key, the rows are flipped to
// top-first.
function storeTile(out: Passes, t: Tile): void {
  for (let row = 0; row < t.th; row++) {
    const topRow = t.th - 1 - row; // readRenderTargetPixels is bottom-up
    for (let col = 0; col < t.tw; col++) {
      const src = (row * t.tw + col) * 4;
      const dst = (t.y0 + topRow) * out.width + t.x0 + col;
      out.shell[dst] = t.masks[src] >= CHANNEL_ON ? 1 : 0;
      out.lineId[dst] = unpack24(t.lineIds, src);
      const id = unpack24(t.ids, src);
      if (id === 0) continue;
      out.keys[dst] = t.bands[src] < CHANNEL_ON ? darkKey(id) : litKey(id);
      out.depth[dst] = unpack24(t.depths, src) / DEPTH_SCALE;
    }
  }
}

// One pass over one tile: every drawable drawn with `materialOf`, the pixels read back as RGBA bytes (bottom row
// first).
function readPass(
  scene: THREE.Scene,
  camera: PassView["camera"],
  all: Drawable[],
  materialOf: (mesh: Drawable) => THREE.Material,
  tw: number,
  th: number,
): Uint8Array {
  for (const mesh of all) mesh.material = materialOf(mesh);
  const target = new THREE.WebGLRenderTarget(tw, th, {
    depthBuffer: true,
    minFilter: THREE.NearestFilter,
    magFilter: THREE.NearestFilter,
    generateMipmaps: false,
  });
  try {
    renderer.setRenderTarget(target);
    renderer.render(scene, camera);
    const pixels = new Uint8Array(tw * th * 4);
    renderer.readRenderTargetPixels(target, 0, 0, tw, th, pixels);
    return pixels;
  } finally {
    renderer.setRenderTarget(null);
    target.dispose();
  }
}

// The meshes are built for this export alone, so their geometry goes when the export is done.
export function disposeMeshes(meshes: Drawable[]): void {
  for (const mesh of meshes) mesh.geometry.dispose();
}

// Maps a scene point to the render's pixel grid: x and y in render-scale pixels (y down), and the NDC depth in 0..1, by
// the same camera and offset the passes used.
export interface Projected {
  x: number; // render px, y down
  y: number;
  depth: number; // NDC depth mapped to 0..1
}
export type Project = (p: THREE.Vector3) => Projected;

export function projector(width: number, height: number, view: PassView): Project {
  return (p) => {
    const { camera } = view;
    const ndc = p
      .clone()
      .add(view.origin)
      .applyMatrix4(camera.matrixWorldInverse)
      .applyMatrix4(camera.projectionMatrix);
    return { x: ((ndc.x + 1) / 2) * width, y: ((1 - ndc.y) / 2) * height, depth: ndc.z / 2 + 0.5 };
  };
}
