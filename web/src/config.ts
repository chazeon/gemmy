import type { Vec3 } from "./types";

// Constants shared by the viewer modules. GEMMY and AXIS_FONT.faces read the two placeholders that gemmy.view fills in
// when it writes the page (globals.d.ts): the numbers the Blender render uses, and the axis label face.

// Same as gemmy's 3to2d look: rotated orthographic view, flat two-tone toon shading, dark outlines.
export const LOOK = {
  azimuth: 35,
  elevation: 28,
  dark: 0.72, // brightness of the shaded band
  threshold: 0.25, // N.L above which a surface is lit
  // The key light, screen-relative: right, up, towards the viewer.
  key: [-0.55, 0.6, 0.6] satisfies Vec3,
  outline: [0.02, 0.02, 0.05] satisfies Vec3,
  axisColors: ["#cc3833", "#389e47", "#3861cc"],
};
// Same numbers as gemmy.render.runner (dash and dot sizes in bond radii, floors in angstrom) and ArrowStyle defaults.
export const DASH = { length: 6, gap: 4, min: 0.1 };
export const DOT = { radius: 1.6, spacing: 8, spacingMin: 0.12 };
export const ARROW = { radius: 0.05, color: [0.04, 0.04, 0.05], headRadiusRatio: 2.8, headLengthRatio: 0.6 };
// One tap of a turn, pan or zoom key or toolbar button (a press moves this much at once, smoothly); holding it keeps
// going at the per-second rate.
export const STEP = { rotate: 5, pan: 0.05, zoom: 1.1 }; // degrees, fraction of the view height, factor
export const RATE = { rotate: 90, pan: 0.4, zoom: 1.8 }; // per second while held
export const EPS = 1e-9; // a tolerance on lengths, zooms and dot products: below it a value counts as zero
// How far a pointer may move between press and release and still be a click (picking) or not yet a drag (the pivot).
export const POINTER_SLOP_PX = 5;
// Numbers shared with the Blender render, embedded from gemmy.view.render_constants (camera framing, lens, triad).
export const GEMMY = __CONSTANTS_JSON__;
// The axis labels' face, the bundled Source Sans 3 Bold Italic subset (gemmy/render/fonts, SIL OFL 1.1) that Blender
// also uses (bold, and the regular italic for the a/b/c buttons), as base64 TTF: the triad, the buttons and the
// exported SVG all draw the same glyphs. The page loads the faces as FontFace objects (render/triad.ts); the SVG
// carries its one face as a CSS rule in its own <style>.
export const AXIS_FONT = { family: "Gemmy Axis Labels", faces: __AXIS_FONTS_JSON__ }; // CSS weight -> base64 TTF
export const AXIS_LETTERS = "abc"; // the lattice vectors a, b, c, by axis index
export const axisFontFace = (weight: string) =>
  `@font-face { font-family: "${AXIS_FONT.family}"; font-style: italic; font-weight: ${weight}; ` +
  `src: url(data:font/ttf;base64,${AXIS_FONT.faces[weight]}) format("truetype"); }`;
