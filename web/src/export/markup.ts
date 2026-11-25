// The pure part of the SVG export: number formatting and colours. Path data (trace/) and attribute values are built
// from these; the DOM that holds them is made in svg-dom.ts, which escapes the text itself. Nothing here touches the
// DOM.
import { Color, LinearSRGBColorSpace, SRGBColorSpace } from "three";

// Numbers are written to 2 decimals: sub-pixel accuracy, shorter files.
const SVG_PRECISION = 100;

// A number in the SVG: rounded to SVG_PRECISION decimals, -0 written as 0, and non-finite numbers (NaN, Infinity)
// written as 0 rather than as text that is not a number.
export const fmt = (x: number): string =>
  Number.isFinite(x) ? String(Math.round(x * SVG_PRECISION) / SVG_PRECISION || 0) : "0";

// A point as an SVG coordinate pair, "x y".
export const fmtPt = (p: readonly number[]): string => `${fmt(p[0])} ${fmt(p[1])}`;

// The CSS hex (#rrggbb) of an sRGB colour, as it is.
export function srgbHex(rgb: number[]): string {
  return `#${new Color().setRGB(rgb[0], rgb[1], rgb[2], SRGBColorSpace).getHexString()}`;
}

// The CSS hex of a colour given as linear components: the outline colour of the live view's shader and of Blender's
// Freestyle line, both read as linear (see render/draw.ts). getHexString encodes it to sRGB for the file.
export function linearHex(rgb: readonly number[]): string {
  return `#${new Color().setRGB(rgb[0], rgb[1], rgb[2], LinearSRGBColorSpace).getHexString()}`;
}

// The toon material darkens the linear colour, so the shaded band does too: sRGB -> linear, times `darkening`, back
// to sRGB. setRGB converts into THREE's working (linear) space and getHexString converts back out. Checked: this
// gives the same hex as the explicit convertSRGBToLinear / convertLinearToSRGB chain for every example colour.
export function shadedBand(base: number[], darkening: number): string {
  return `#${new Color().setRGB(base[0], base[1], base[2], SRGBColorSpace).multiplyScalar(darkening).getHexString()}`;
}
