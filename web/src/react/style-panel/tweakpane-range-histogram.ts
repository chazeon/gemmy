// A Tweakpane input plugin for a {min, max} window drawn with a mini histogram of the distances it can take (the bond and
// shape windows). It accepts a value only when its params carry a histogram; any other {min, max} stays with Tweakpane's
// own interval. The adapter registers this bundle, and Tweakpane asks the newest registration first. The strip is in
// tweakpane-range-histogram-view.ts and its behaviour in tweakpane-range-histogram-controller.ts.
import type { BaseInputParams, InputBindingPlugin } from "@tweakpane/core";
import { Semver } from "tweakpane";
import type { Histogram } from "../../compile/pair-distances";
import { type RangeValue, isHistogram, isRangeValue } from "./range-histogram-layout";
import { RangeHistogramController } from "./tweakpane-range-histogram-controller";
import { RANGE_HISTOGRAM_CSS } from "./tweakpane-range-histogram-view";

// What a binding of this plugin takes beside its label: the handles' domain (min, max), their step and the histogram.
export interface RangeHistogramParams extends BaseInputParams {
  min: number;
  max: number;
  step: number;
  histogram: Histogram;
}

// Tweakpane 4.0.5 bundles @tweakpane/core 2.0.5, and a plugin names the core it was written for: Tweakpane refuses one
// of another major version.
const CORE_VERSION = new Semver("2.0.5");

function isRangeHistogramParams(params: Record<string, unknown>): params is RangeHistogramParams {
  return (
    typeof params.min === "number" &&
    typeof params.max === "number" &&
    typeof params.step === "number" &&
    isHistogram(params.histogram)
  );
}

export const rangeHistogramPlugin: InputBindingPlugin<RangeValue, RangeValue, RangeHistogramParams> = {
  id: "input-range-histogram",
  type: "input",
  core: CORE_VERSION,
  accept(exValue, params) {
    if (!isRangeValue(exValue) || !isRangeHistogramParams(params)) return null;
    return { initialValue: { min: exValue.min, max: exValue.max }, params };
  },
  binding: {
    reader: () => readRange,
    equals: (first, second) => first.min === second.min && first.max === second.max,
    writer: () => writeRange,
  },
  controller(args) {
    return new RangeHistogramController(args.document, {
      value: args.value,
      viewProps: args.viewProps,
      histogram: args.params.histogram,
      domain: { min: args.params.min, max: args.params.max },
      step: args.params.step,
    });
  },
};

// The plugin's bundle, for Pane.registerPlugin: its stylesheet and the plugin.
export const rangeHistogramBundle = {
  id: "gemmy-range-histogram",
  css: RANGE_HISTOGRAM_CSS,
  plugins: [rangeHistogramPlugin],
};

function readRange(exValue: unknown): RangeValue {
  return isRangeValue(exValue) ? { min: exValue.min, max: exValue.max } : { min: 0, max: 0 };
}

function writeRange(target: { writeProperty(name: string, value: unknown): void }, value: RangeValue): void {
  target.writeProperty("min", value.min);
  target.writeProperty("max", value.max);
}
