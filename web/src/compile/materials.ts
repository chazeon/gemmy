// Material resolution and element style lookup (compile/materials.py).
import {
  type Color,
  type ElementStyle,
  type MaterialStyle,
  type SceneConfig,
  defaultElementStyle,
  defaultMaterialStyle,
} from "./config";
import { DEFAULT_ELEMENT_KEY } from "./colour-schemes";
import type { Site } from "./sites";

// Two alphas closer than this are the same alpha: a base material keeps its id when only rounding differs.
const ALPHA_MATCH_TOLERANCE = 1e-8;

// style_for: the style of the site's species label, else "default", else the built-in default.
export function styleFor(config: SceneConfig, site: Site): ElementStyle {
  for (const key of [site.label, DEFAULT_ELEMENT_KEY]) {
    if (Object.hasOwn(config.elements, key)) return config.elements[key];
  }
  return defaultElementStyle();
}

export function isHidden(style: ElementStyle): boolean {
  return !style.visible || style.representation === "hidden";
}

// Python's % on floats: the result takes the sign of the divisor, and a tiny negative stays m - tiny (as CPython).
function pyMod(x: number, m: number): number {
  let r = x % m;
  if (r !== 0 && r < 0 !== m < 0) r += m;
  return r;
}

// colorsys.rgb_to_hsv, the same operations in the same order.
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const maxc = Math.max(r, g, b);
  const minc = Math.min(r, g, b);
  const rangec = maxc - minc;
  const v = maxc;
  if (minc === maxc) return [0, 0, v];
  const s = rangec / maxc;
  const rc = (maxc - r) / rangec;
  const gc = (maxc - g) / rangec;
  const bc = (maxc - b) / rangec;
  let h: number;
  if (r === maxc) h = bc - gc;
  else if (g === maxc) h = 2.0 + rc - bc;
  else h = 4.0 + gc - rc;
  h = pyMod(h / 6.0, 1.0);
  return [h, s, v];
}

// colorsys.hsv_to_rgb, the same operations in the same order.
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  if (s === 0.0) return [v, v, v];
  const scaled = h * 6.0;
  const i = Math.trunc(scaled) % 6;
  const f = scaled - Math.trunc(scaled);
  const p = v * (1.0 - s);
  const q = v * (1.0 - s * f);
  const t = v * (1.0 - s * (1.0 - f));
  switch (i) {
    case 0:
      return [v, t, p];
    case 1:
      return [q, v, p];
    case 2:
      return [p, v, t];
    case 3:
      return [p, q, v];
    case 4:
      return [t, p, v];
    default:
      return [v, p, q];
  }
}

// ghost_color: tinted glass, the same hue, saturation scaled, brightness `value`, alpha `opacity`.
export function ghostColor(color: Color, opacity: number, saturation: number, value: number): Color {
  const [h, s] = rgbToHsv(color[0], color[1], color[2]);
  const [r, g, b] = hsvToRgb(h, s * saturation, value);
  return [r, g, b, opacity];
}

// Python's f"{x:.4f}": exact decimal rounding with ties to even, and "-" kept for -0.0 and tiny negatives.
export function formatFixed4(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x < 0 ? "-inf" : "inf";
  const sign = x < 0 || Object.is(x, -0) ? "-" : "";
  const a = Math.abs(x);
  if (a >= 1e21) return `${sign}${BigInt(a).toString()}.0000`;
  // toFixed(100) is the exact expansion for every value that can sit on a 4-decimal tie.
  const digits = a.toFixed(100);
  const cut = digits.indexOf(".") + 5;
  const tail = digits.slice(cut);
  if (/^50*$/.test(tail)) {
    const kept = digits.slice(0, cut);
    if (Number(kept[kept.length - 1]) % 2 === 0) return `${sign}${kept}`;
  }
  // toFixed rounds an exact tie up, so the odd-digit tie and every non-tie come out as Python rounds them.
  return `${sign}${a.toFixed(4)}`;
}

// materials._variant_id. -0 is written as 0 (JSON's -0 reads as the integer 0 in Python), so both sides give one id.
function variantId(baseMaterial: string, color: Color): string {
  const parts = color.map((c) => formatFixed4(c === 0 ? 0 : c)).join("_");
  return `${baseMaterial}_${parts}`.replaceAll("-", "m").replaceAll(".", "p");
}

// Config materials plus colour variants created on demand. `materials` keeps insertion order, as Python's dict does.
export class MaterialTable {
  readonly materials: Map<string, MaterialStyle>;
  private readonly variants = new Map<string, string>();

  constructor(base: Readonly<Record<string, MaterialStyle>>) {
    this.materials = new Map(Object.entries(base));
  }

  resolve(baseMaterial: string, color: Color): string {
    const key = JSON.stringify([baseMaterial, color]);
    const known = this.variants.get(key);
    if (known !== undefined) return known;
    let base = this.materials.get(baseMaterial);
    if (base === undefined) {
      base = defaultMaterialStyle();
      this.materials.set(baseMaterial, base);
    }
    let materialId: string;
    if (
      base.base_color.every((c, index) => c === color[index]) &&
      Math.abs(base.alpha - color[3]) <= ALPHA_MATCH_TOLERANCE
    ) {
      materialId = baseMaterial;
    } else {
      let candidate = variantId(baseMaterial, color);
      let suffix = 1;
      while (this.materials.has(candidate)) {
        candidate = `${variantId(baseMaterial, color)}_${suffix}`;
        suffix += 1;
      }
      this.materials.set(candidate, {
        type: base.type,
        base_color: color,
        roughness: base.roughness,
        metallic: base.metallic,
        alpha: color[3],
      });
      materialId = candidate;
    }
    this.variants.set(key, materialId);
    return materialId;
  }
}

// visible_sites: the sites that may get a sphere or an arrow.
export function visibleSites(config: SceneConfig, sites: Site[]): Site[] {
  return sites.filter((site) => !isHidden(styleFor(config, site)));
}
