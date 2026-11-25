// Constants shared by the viewer modules. GEMMY and AXIS_FONT.faces read the two placeholders that gemmy.view fills in
// when it writes the page (globals.d.ts): the numbers the Blender render uses, and the axis label face.

// Same as gemmy's 3to2d look: rotated orthographic view, flat two-tone toon shading, dark outlines.
export const LOOK = {
  azimuth: 35, elevation: 28,
  dark: 0.72,               // brightness of the shaded band
  threshold: 0.25,          // N.L above which a surface is lit
  key: ([-0.55, 0.6, 0.6] as [number, number, number]),   // key light, screen-relative: right, up, towards the viewer
  outline: ([0.02, 0.02, 0.05] as [number, number, number]),
  axisColors: ["#cc3833", "#389e47", "#3861cc"],
};
// Same numbers as gemmy.render.runner (dash and dot sizes in bond radii, floors in angstrom) and ArrowStyle defaults.
export const DASH = { length: 6, gap: 4, min: 0.1 };
export const DOT = { radius: 1.6, spacing: 8, spacingMin: 0.12 };
export const ARROW = { radius: 0.05, color: [0.04, 0.04, 0.05], headRadiusRatio: 2.8, headLengthRatio: 0.6 };
// One click on a toolbar button; holding it keeps going at the per-second rate.
export const STEP = { rotate: 15, pan: 0.05, zoom: 1.1 };      // degrees, fraction of the view height, factor
export const RATE = { rotate: 90, pan: 0.4, zoom: 1.8 };       // per second while held
export const EPS = 1e-9;
// How far a pointer may move between press and release and still be a click (picking) or not yet a drag (the pivot).
export const POINTER_SLOP_PX = 5;
// Numbers shared with the Blender render, embedded from gemmy.view.render_constants (camera framing, lens, triad).
export const GEMMY = __CONSTANTS_JSON__;
// The axis labels' face, the bundled Source Sans 3 Bold Italic subset (gemmy/render/fonts, SIL OFL 1.1) that Blender
// also uses (bold, and the regular italic for the a/b/c buttons), as base64 TTF: the triad, the buttons and the
// exported SVG all draw the same glyphs.
export const AXIS_FONT = { family: "Gemmy Axis Labels", faces: __AXIS_FONTS_JSON__ }; // CSS weight -> base64 TTF
export const axisFontFace = (weights = Object.keys(AXIS_FONT.faces)) => weights.map((w) =>
  `@font-face { font-family: "${AXIS_FONT.family}"; font-style: italic; font-weight: ${w}; src: url(data:font/ttf;base64,${AXIS_FONT.faces[w]}) format("truetype"); }`).join("\n");
