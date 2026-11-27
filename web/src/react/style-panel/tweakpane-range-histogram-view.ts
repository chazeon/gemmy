// The DOM of a range histogram: a short strip with the bars, the window's band and two handles, and under its ends the
// two number fields. The colours are Tweakpane's own CSS variables (--in-fg, --mo-fg, --in-bg and the like, set on the
// pane), so the strip follows the pane's theme. The controller (tweakpane-range-histogram-controller.ts) owns the events.
import type { View } from "@tweakpane/core";
import type { Histogram } from "../../compile/pair-distances";
import { type Handle, type RangeValue, barBoxes, bandBox, decimalsOf, fractionOf } from "./range-histogram-layout";

export const HANDLES: readonly Handle[] = ["min", "max"];

export interface RangeHistogramViewConfig {
  histogram: Histogram;
  domain: RangeValue;
  step: number;
}

export class RangeHistogramView implements View {
  readonly element: HTMLElement;
  readonly strip: HTMLElement;
  readonly handles: Record<Handle, HTMLElement>;
  readonly inputs: Record<Handle, HTMLInputElement>;
  private readonly bars: HTMLElement[];
  private readonly band: HTMLElement;
  private readonly histogram: Histogram;
  private readonly domain: RangeValue;
  private readonly decimals: number;

  constructor(doc: Document, config: RangeHistogramViewConfig) {
    this.histogram = config.histogram;
    this.domain = config.domain;
    this.decimals = decimalsOf(config.step);

    this.element = element(doc, "div", "gemmy-rh");
    this.strip = element(doc, "div", "gemmy-rh-strip", this.element);
    this.bars = config.histogram.counts.map(() => element(doc, "span", "gemmy-rh-bar", this.strip));
    this.band = element(doc, "div", "gemmy-rh-band", this.strip);
    this.handles = {
      min: element(doc, "div", "gemmy-rh-handle", this.strip),
      max: element(doc, "div", "gemmy-rh-handle", this.strip),
    };
    this.inputs = {
      min: numberField(doc, "gemmy-rh-input-min"),
      max: numberField(doc, "gemmy-rh-input-max"),
    };
    for (const handle of HANDLES) {
      const control = this.handles[handle];
      control.tabIndex = 0;
      control.setAttribute("role", "slider");
      control.setAttribute("aria-label", handle === "min" ? "Minimum" : "Maximum");
      control.setAttribute("aria-valuemin", String(this.domain.min));
      control.setAttribute("aria-valuemax", String(this.domain.max));
    }

    const ends = element(doc, "div", "gemmy-rh-ends", this.element);
    ends.append(this.inputs.min, this.inputs.max);
  }

  // Draws the window: the bars inside it bright, the band and the handles at its ends, the fields with its values.
  render(selected: RangeValue): void {
    const boxes = barBoxes(this.histogram, this.domain, selected);
    boxes.forEach((box, index) => {
      const bar = this.bars[index];
      bar.style.left = percent(box.left);
      bar.style.width = percent(box.width);
      bar.style.height = percent(box.height);
      bar.classList.toggle("is-out", !box.inWindow);
    });
    const band = bandBox(selected, this.domain);
    this.band.style.left = percent(band.left);
    this.band.style.width = percent(band.width);
    for (const handle of HANDLES) {
      const value = selected[handle];
      this.handles[handle].style.left = percent(fractionOf(value, this.domain));
      this.handles[handle].setAttribute("aria-valuenow", String(value));
      this.inputs[handle].value = value.toFixed(this.decimals);
    }
  }
}

function element(doc: Document, tag: string, className: string, parent?: HTMLElement): HTMLElement {
  const created = doc.createElement(tag);
  created.className = className;
  parent?.append(created);
  return created;
}

function numberField(doc: Document, className: string): HTMLInputElement {
  const field = doc.createElement("input");
  field.type = "number";
  field.className = `gemmy-rh-input ${className}`;
  return field;
}

function percent(fraction: number): string {
  return `${fraction * 100}%`;
}

// The strip's look, in the stylesheet of the pane (Tweakpane embeds it once, with the plugin's bundle).
export const RANGE_HISTOGRAM_CSS = `
.gemmy-rh { display: grid; gap: 2px; min-width: 0; width: 100%; }
.gemmy-rh.tp-v-disabled { opacity: 0.5; }
.gemmy-rh-strip { position: relative; height: 28px; border-radius: var(--bld-br, 2px); background: var(--mo-bg); }
.gemmy-rh-bar { position: absolute; bottom: 0; background: var(--mo-fg); border-radius: 1px 1px 0 0; }
.gemmy-rh-bar.is-out { opacity: 0.25; }
.gemmy-rh-band { position: absolute; top: 0; bottom: 0; background: var(--in-fg); opacity: 0.12; pointer-events: none; }
.gemmy-rh-handle { position: absolute; top: 0; bottom: 0; width: 8px; margin-left: -4px; cursor: ew-resize; outline: none; }
.gemmy-rh-handle::after { content: ""; position: absolute; top: 0; bottom: 0; left: 3px; width: 2px; border-radius: 1px; background: var(--in-fg); }
.gemmy-rh-handle:focus-visible::after { left: 2.5px; width: 3px; }
.gemmy-rh-ends { display: flex; justify-content: space-between; gap: 4px; }
.gemmy-rh-input { width: 50%; min-width: 0; height: var(--cnt-usz, 20px); box-sizing: border-box; border: 0; border-radius: var(--bld-br, 2px); padding: 0 var(--bld-hp, 4px); background: var(--in-bg); color: var(--in-fg); font: inherit; outline: none; }
.gemmy-rh-input:hover { background: var(--in-bg-h); }
.gemmy-rh-input:focus { background: var(--in-bg-f); }
.gemmy-rh-input-max { text-align: right; }
`;
