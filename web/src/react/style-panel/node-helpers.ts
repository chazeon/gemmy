// Helpers the section node builders share: colour and number conversions, slider ranges, choices, folder summaries, and the
// two ownership steps every automatic set follows (an edit ends the automatic status, a re-detect replaces the set).
import type { Color, SceneConfig } from "../../compile/config";
import { type Histogram, distanceHistogram } from "../../compile/pair-distances";
import { ConfigError } from "../../compile/config-errors";
import { type Apply, DISTANCE_STEP, distanceDomain, type Span } from "../../ui/style-panel-model";
import type { Choice, Rgba } from "./pane-model";

// The bars of a window's histogram: enough to show the shells of the distances, few enough to read on the strip.
const WINDOW_HISTOGRAM_BINS = 40;

const HIDDEN = " · hidden";

export function fixed(value: number): string {
  return String(Number(value.toFixed(2)));
}

export function hiddenMark(visible: boolean): string {
  return visible ? "" : HIDDEN;
}

export function windowSummary(min: number, max: number, visible: boolean): string {
  return `${fixed(min)}–${fixed(max)} Å${hiddenMark(visible)}`;
}

// A folder's summary while it is automatic: "auto" before the text, so the user sees the detection made it.
export function autoSummary(isAutomatic: boolean, text: string): string {
  return isAutomatic ? `auto · ${text}` : text;
}

// The control's commit for an item the detection may own: the edit runs through apply, then the item (its key in `owned`)
// is no longer automatic, because the user changed it.
export function endingAutomatic(apply: Apply, owned: Set<string>, key: string): (edit: () => SceneConfig) => void {
  return (edit) =>
    apply(() => {
      const next = edit();
      owned.delete(key);
      return next;
    });
}

// The owned set becomes these keys: what the detection owns after a re-detect, or nothing after a clear.
export function replaceOwnership(owned: Set<string>, keys: Iterable<string>): void {
  owned.clear();
  for (const key of keys) owned.add(key);
}

export function rgbaOf(color: Color): Rgba {
  const [r, g, b, a] = color;
  return { r, g, b, a };
}

export function colorOf(rgba: Rgba): Color {
  return [rgba.r, rgba.g, rgba.b, rgba.a];
}

export function numberRange(span: Span, step: number): { min: number; max: number; step: number } {
  return { min: span[0], max: span[1], step };
}

// The window's slider: from zero to past the pair's farthest distance, in the step the distances are shown in, with the
// histogram of the distances the window is picked from.
export function distanceRange(distances: readonly number[]): {
  min: number;
  max: number;
  step: number;
  histogram: Histogram;
} {
  const [min, max] = distanceDomain(distances);
  return { min, max, step: DISTANCE_STEP, histogram: distanceHistogram(distances, WINDOW_HISTOGRAM_BINS) };
}

export function namesChoices(names: readonly string[]): Choice<string>[] {
  return names.map((name) => ({ text: name, value: name }));
}

// The option a list's value names; a value the list does not offer is refused (the list only offers its own options).
export function choiceValue<T extends string>(choices: readonly Choice<T>[], value: string): T {
  const found = choices.find((choice) => choice.value === value);
  if (found === undefined) throw new ConfigError(`"${value}" is not one of the choices.`);
  return found.value;
}
