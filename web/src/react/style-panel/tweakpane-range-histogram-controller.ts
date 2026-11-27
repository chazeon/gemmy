// The behaviour of a range histogram. A pointer drag on the strip moves the nearer handle: the value follows the pointer
// while it moves (no commit) and is committed when the drag ends (Tweakpane's `last` flag). A focused handle moves by the
// arrow keys, Shift moving it ten steps; each key is a commit. A number field commits the value typed into it.
import type { Value, ValueController, ViewProps } from "@tweakpane/core";
import { type Handle, type RangeValue, fractionOf, movedWindow, snapToStep, valueAt } from "./range-histogram-layout";
import { HANDLES, RangeHistogramView, type RangeHistogramViewConfig } from "./tweakpane-range-histogram-view";

// The arrow keys that move a handle, and the direction each moves it in.
const KEY_DIRECTIONS: Partial<Record<string, number>> = {
  ArrowLeft: -1,
  ArrowDown: -1,
  ArrowRight: 1,
  ArrowUp: 1,
};
// Shift moves a handle this many steps at once.
const SHIFT_STEPS = 10;

export interface RangeHistogramControllerConfig extends RangeHistogramViewConfig {
  value: Value<RangeValue>;
  viewProps: ViewProps;
}

export class RangeHistogramController implements ValueController<RangeValue, RangeHistogramView> {
  readonly value: Value<RangeValue>;
  readonly view: RangeHistogramView;
  readonly viewProps: ViewProps;
  private readonly domain: RangeValue;
  private readonly step: number;
  // The handle the pointer is dragging, from the press until the release (null while no drag runs).
  private dragging: Handle | null = null;

  constructor(doc: Document, config: RangeHistogramControllerConfig) {
    this.value = config.value;
    this.viewProps = config.viewProps;
    this.domain = config.domain;
    this.step = config.step;
    this.view = new RangeHistogramView(doc, config);
    this.viewProps.bindClassModifiers(this.view.element);
    this.value.emitter.on("change", () => this.view.render(this.value.rawValue));
    this.view.render(this.value.rawValue);
    this.bindStrip();
    this.bindHandles();
    this.bindInputs();
  }

  private bindStrip(): void {
    const { strip } = this.view;
    strip.addEventListener("pointerdown", (event) => {
      this.dragging = this.nearestHandle(event.clientX);
      strip.setPointerCapture(event.pointerId);
      this.drag(event.clientX, false);
    });
    strip.addEventListener("pointermove", (event) => this.drag(event.clientX, false));
    const release = (event: PointerEvent) => this.drag(event.clientX, true);
    strip.addEventListener("pointerup", release);
    strip.addEventListener("pointercancel", release);
  }

  // Moves the dragged handle to the pointer. The release ends the drag and commits the value, even when it did not move.
  private drag(clientX: number, release: boolean): void {
    if (this.dragging === null) return;
    const next = movedWindow(this.value.rawValue, this.dragging, this.valueAtPointer(clientX));
    this.value.setRawValue(next, { forceEmit: release, last: release });
    if (release) this.dragging = null;
  }

  // The handle a press takes: a press outside the window takes the handle on its side, a press inside takes the nearer.
  private nearestHandle(clientX: number): Handle {
    const pointer = this.fractionAtPointer(clientX);
    const low = fractionOf(this.value.rawValue.min, this.domain);
    const high = fractionOf(this.value.rawValue.max, this.domain);
    if (pointer <= low) return "min";
    if (pointer >= high) return "max";
    return pointer - low <= high - pointer ? "min" : "max";
  }

  private fractionAtPointer(clientX: number): number {
    const rect = this.view.strip.getBoundingClientRect();
    return rect.width > 0 ? (clientX - rect.left) / rect.width : 0;
  }

  private valueAtPointer(clientX: number): number {
    return snapToStep(valueAt(this.fractionAtPointer(clientX), this.domain), this.domain, this.step);
  }

  private bindHandles(): void {
    for (const handle of HANDLES) {
      this.view.handles[handle].addEventListener("keydown", (event) => this.onKey(handle, event));
    }
  }

  private onKey(handle: Handle, event: KeyboardEvent): void {
    const direction = KEY_DIRECTIONS[event.key];
    if (direction === undefined) return;
    event.preventDefault();
    const steps = event.shiftKey ? SHIFT_STEPS : 1;
    const target = this.value.rawValue[handle] + direction * steps * this.step;
    this.commit(movedWindow(this.value.rawValue, handle, snapToStep(target, this.domain, this.step)));
  }

  private bindInputs(): void {
    for (const handle of HANDLES) {
      const field = this.view.inputs[handle];
      this.viewProps.bindDisabled(field);
      field.addEventListener("change", () => this.onTyped(handle, field.valueAsNumber));
    }
  }

  // A typed value is kept when it is a number inside the domain; the fields then show the value the window holds.
  private onTyped(handle: Handle, typed: number): void {
    if (Number.isFinite(typed)) {
      this.commit(movedWindow(this.value.rawValue, handle, snapToStep(typed, this.domain, this.step)));
    }
    this.view.render(this.value.rawValue);
  }

  private commit(next: RangeValue): void {
    this.value.setRawValue(next, { forceEmit: false, last: true });
  }
}
