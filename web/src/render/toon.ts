// The toon shading's numbers and gradient, shared by the live view (draw.ts) and the offscreen passes of the traced
// export (trace/passes.ts). The passes must cut the lit and shaded bands where the gradient does, and must offset the
// polyhedron faces the same way, or a face would win a pixel in one pass and lose it in another.
import * as THREE from "three";
import { LOOK } from "../config";

// The texels of the one-row gradient: each one is a flat band (NearestFilter).
const TOON_STEPS = 16;
// The first lit texel. Three looks up N.L * 0.5 + 0.5, and the texel is floor(coordinate * TOON_STEPS).
const FIRST_LIT = Math.ceil(((LOOK.threshold + 1) / 2) * TOON_STEPS);
// The N.L at which a surface turns lit: a texel is lit from FIRST_LIT on, so the lit test is dotNL >= LIT_CUT.
export const LIT_CUT = (2 * FIRST_LIT) / TOON_STEPS - 1;

// Polyhedron faces are pushed back a little in the depth test, so their edge lines draw over them.
const FACE_OFFSET_FACTOR = 1;
const FACE_OFFSET_UNITS = 1;
// The polygon offset of a material: faces take it, the other shapes do not.
export const polygonOffsetOf = (faces: boolean) => ({
  polygonOffset: faces,
  polygonOffsetFactor: FACE_OFFSET_FACTOR,
  polygonOffsetUnits: FACE_OFFSET_UNITS,
});

// A one-row gradient for the toon shading. Three looks up N.L, which runs from -1 to 1 across the row: texels below the
// threshold are black (the shaded band) and the rest are white, so the band edge sits at LOOK.threshold.
export function makeToonGradient(): THREE.DataTexture {
  const texels = Array.from({ length: TOON_STEPS }, (_, i) => (i >= FIRST_LIT ? 255 : 0));
  const texture = new THREE.DataTexture(new Uint8Array(texels), TOON_STEPS, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
}
