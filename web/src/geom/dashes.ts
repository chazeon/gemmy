// Dashed and dotted lines: where the pieces of a line from a to b go. Pure: no THREE, no DOM.
import { EPS } from "../config";
import { lerp, span, type Vec } from "./vector";

// Dashes of length `dash` with `gap` between them, as [start, end] pairs along the line. The dashes are spread so
// the first starts at a and the last ends at b: `count` dashes and `count - 1` gaps fill the line exactly.
export function dashSegments(a: Vec, b: Vec, dash: number, gap: number): [number[], number[]][] {
  const len = span(a, b);
  if (len <= EPS) return [];
  const count = Math.max(1, Math.round((len + gap) / (dash + gap)));
  const stretch = len / (count * dash + (count - 1) * gap);
  const dashFraction = (dash * stretch) / len; // a dash, as a fraction of the line
  const periodFraction = ((dash + gap) * stretch) / len; // one dash and one gap, likewise
  return Array.from({ length: count }, (_, i) => [
    lerp(a, b, i * periodFraction),
    lerp(a, b, i * periodFraction + dashFraction),
  ]);
}

// Dot centres about `spacing` apart: the line is cut into equal slots, one dot in the middle of each.
export function dotCentres(a: Vec, b: Vec, spacing: number): number[][] {
  const len = span(a, b);
  if (len <= EPS) return [];
  const count = Math.max(1, Math.round(len / spacing));
  return Array.from({ length: count }, (_, i) => lerp(a, b, (i + 0.5) / count));
}
