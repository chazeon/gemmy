// The geometry of a range slider over a histogram: where each bar, the window's band and the two handles sit on the
// strip, as fractions of its width, and the step a value is snapped to. The view (tweakpane-range-histogram-view.ts)
// draws these numbers; the controller uses the snapping and the moves. Nothing here touches the DOM or Tweakpane, so
// the node tests run it.
import type { Histogram } from "../../compile/pair-distances";

export interface RangeValue {
  min: number;
  max: number;
}

export type Handle = "min" | "max";

// The tallest bar takes this share of the strip's height, so its top stays clear of the strip's edge.
const TALLEST_BAR_SHARE = 0.9;

// A bar as the strip shows it: where it starts and how wide it is (fractions of the strip), how tall (the same), and
// whether it lies inside the window (outside bars are dimmed).
export interface BarBox {
  left: number;
  width: number;
  height: number;
  inWindow: boolean;
}

export function isRangeValue(value: unknown): value is RangeValue {
  return typeof value === "object" && value !== null && "min" in value && "max" in value;
}

export function isHistogram(value: unknown): value is Histogram {
  return typeof value === "object" && value !== null && "edges" in value && "counts" in value;
}

// The fraction of the strip a value sits at, from the domain's low end (0) to its high end (1).
export function fractionOf(value: number, domain: RangeValue): number {
  const width = domain.max - domain.min;
  return width > 0 ? clamp((value - domain.min) / width, 0, 1) : 0;
}

// The value at a fraction of the strip: the inverse of fractionOf.
export function valueAt(fraction: number, domain: RangeValue): number {
  return domain.min + clamp(fraction, 0, 1) * (domain.max - domain.min);
}

// The value rounded to the step and kept inside the domain. The rounding is to the step's own decimals, so 0.30 does
// not come out as 0.30000000000000004.
export function snapToStep(value: number, domain: RangeValue, step: number): number {
  const steps = Math.round((value - domain.min) / step);
  const snapped = domain.min + steps * step;
  return clamp(Number(snapped.toFixed(decimalsOf(step))), domain.min, domain.max);
}

// The decimals a step is written with: 0.01 has two, 1 has none.
export function decimalsOf(step: number): number {
  return Math.max(0, Math.ceil(-Math.log10(step)));
}

// The window with one handle moved to a value. A handle cannot pass the other one, so the window stays ordered.
export function movedWindow(window: RangeValue, handle: Handle, value: number): RangeValue {
  if (handle === "min") return { min: Math.min(value, window.max), max: window.max };
  return { min: window.min, max: Math.max(value, window.min) };
}

// The band the window covers on the strip: where it starts and how wide it is.
export function bandBox(window: RangeValue, domain: RangeValue): { left: number; width: number } {
  const left = fractionOf(window.min, domain);
  return { left, width: fractionOf(window.max, domain) - left };
}

// One box per bin. A bin is in the window when it overlaps it, so a bin that only touches an edge of the window is in.
export function barBoxes(histogram: Histogram, domain: RangeValue, window: RangeValue): BarBox[] {
  const tallest = histogram.counts.reduce((top, count) => Math.max(top, count), 1);
  return histogram.counts.map((count, bin) => {
    const low = histogram.edges[bin];
    const high = histogram.edges[bin + 1];
    const left = fractionOf(low, domain);
    return {
      left,
      width: fractionOf(high, domain) - left,
      height: (count / tallest) * TALLEST_BAR_SHARE,
      inWindow: high >= window.min && low <= window.max,
    };
  });
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}
