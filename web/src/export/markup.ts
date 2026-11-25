// SVG markup: the one place the export writes attributes, text, numbers and colours. Scene strings reach the file only
// through these helpers, so they are escaped here and nowhere else.
import { Color, LinearSRGBColorSpace, SRGBColorSpace, Vector2 } from "three";

// Numbers are written to 2 decimals: sub-pixel accuracy, shorter files.
const SVG_PRECISION = 100;

export type Attrs = Record<string, string | number | false | undefined>;

// Text content: & < > escaped. Quotes stay as they are, they are only special inside an attribute.
const escapeText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// An attribute value in double quotes: text escaping plus the double quote.
const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, "&quot;");

// A number in the SVG: rounded to SVG_PRECISION decimals, -0 written as 0, and non-finite numbers (NaN, Infinity)
// written as 0 rather than as text that is not a number.
export const fmt = (x: number): string => (Number.isFinite(x) ? String(Math.round(x * SVG_PRECISION) / SVG_PRECISION || 0) : "0");

// Point lists: "x,y" pairs for polygons.
export const pointList = (list: Vector2[]): string => list.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join(" ");

function attrText(attrs: Attrs): string {
  return Object.entries(attrs)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined && entry[1] !== false)
    .map(([name, value]) => ` ${name}="${typeof value === "number" ? fmt(value) : escapeAttr(value)}"`)
    .join("");
}

// An element. `body` is trusted markup: children already built by el() or textEl(). Use textEl() for text.
// Attributes whose value is undefined or false are left out.
export function el(tag: string, attrs: Attrs, body?: string): string {
  const list = attrText(attrs);
  return body === undefined ? `<${tag}${list}/>` : `<${tag}${list}>${body}</${tag}>`;
}

// An element whose content is text: the text is escaped.
export function textEl(tag: string, attrs: Attrs, text: string): string {
  return `<${tag}${attrText(attrs)}>${escapeText(text)}</${tag}>`;
}

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
