// Draws the inspector's section nodes (pane-model.ts) with Tweakpane, the only module that imports it. One pane holds the
// nodes. A change of structure (a rule added or removed, a name changed) rebuilds the pane; a change of values only writes
// the new values into the bindings, so an open folder and a focused control stay as they are. Tweakpane reports a change
// with `last` false while a drag runs; only the change that ends (last true) is committed.
import * as EssentialsPlugin from "@tweakpane/plugin-essentials";
import { Pane, type TpPluginBundle } from "tweakpane";
import { type PaneNode, type ValueNode, flattenPane, isValueNode, structureKey } from "./pane-model";
import { CHANNEL_MAX, fromHex, toHex } from "./colour-hex";
import { EYE, EYE_OFF } from "./eye-icons";
import { ORIGIN_ICONS } from "./origin-icons";
import { WriteGate, sameValue } from "./tweakpane-commit";
import { rangeHistogramBundle } from "./tweakpane-range-histogram";

// The part of Tweakpane's API this file uses. A pane and a folder both take controls.
interface Container {
  addBinding(target: object, key: string, params: Record<string, unknown>): Bound;
  addButton(params: { title: string }): { on(event: "click", handler: () => void): unknown };
  addFolder(params: { title: string; expanded: boolean }): Folder;
  addBlade(params: Record<string, unknown>): {
    on(event: "click", handler: (ev: { index: number[] }) => void): unknown;
  };
}
interface Bound {
  on(event: "change", handler: (ev: { value: unknown; last: boolean }) => void): unknown;
}
interface Folder extends Container {
  title: string;
  expanded: boolean;
  element: HTMLElement;
  on(event: "fold", handler: (ev: { expanded: boolean }) => void): unknown;
}
// Tweakpane's typings reach a pane's methods through @tweakpane/core, which is not in web/node_modules, so the part of a
// pane this file uses is declared here.
interface PaneApi extends Container {
  refresh(): void;
  dispose(): void;
  registerPlugin(bundle: TpPluginBundle): void;
}

// One Tweakpane control, with the node it shows. The node is replaced on every sync, so a handler always calls the latest
// commit. `holder` is the object the binding reads and writes (its `value`).
interface Slot {
  node: PaneNode;
  holder?: { value: unknown };
  folder?: Folder;
}

// How long a folder flashes after a reveal (style.css, .dock-flash).
const FLASH_MS = 1000;

// Whether each folder is open, by its title (a rule's name, which is its key). Kept here, not in the pane, so a rebuild (a
// rule added or removed) keeps the folders the user opened, and a section that is shut and opened again keeps them too.
const folds = new Map<string, boolean>();

export class PaneAdapter {
  private pane: PaneApi | null = null;
  private slots: Slot[] = [];
  private key = "";
  private readonly gate = new WriteGate();

  constructor(private readonly host: HTMLElement) {}

  sync(nodes: readonly PaneNode[]): void {
    const key = structureKey(nodes);
    // The writes and the refresh are not user edits: Tweakpane reports the values they set as changes (tweakpane-commit.ts).
    this.gate.run(() => {
      if (this.pane === null || key !== this.key) this.rebuild(nodes, key);
      else this.writeValues(nodes);
      this.pane?.refresh();
    });
  }

  // Shows the folder with this key: it opens (the user's fold is kept by the key too), comes into view, and flashes for a
  // second (style.css, .dock-flash): a static tint when the reader asks for no motion.
  reveal(key: string): void {
    const folder = this.slots.find((slot) => slot.node.kind === "folder" && slot.node.title === key)?.folder;
    if (folder === undefined) return;
    folds.set(key, true);
    folder.expanded = true;
    const element = folder.element;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    element.scrollIntoView({ block: "nearest", behavior: reduced ? "auto" : "smooth" });
    element.classList.add("dock-flash");
    window.setTimeout(() => element.classList.remove("dock-flash"), FLASH_MS);
  }

  dispose(): void {
    this.pane?.dispose();
    this.pane = null;
    this.slots = [];
    this.key = "";
  }

  private rebuild(nodes: readonly PaneNode[], key: string): void {
    this.dispose();
    const pane = new Pane({ container: this.host }) as unknown as PaneApi;
    pane.registerPlugin(EssentialsPlugin);
    // Registered after the essentials, so Tweakpane asks it first: it takes only the intervals that carry a histogram.
    pane.registerPlugin(rangeHistogramBundle);
    this.pane = pane;
    this.key = key;
    this.slots = mountNodes(pane, nodes, this.gate);
  }

  private writeValues(nodes: readonly PaneNode[]): void {
    const flat = flattenPane(nodes);
    this.slots.forEach((slot, index) => {
      const node = flat[index];
      slot.node = node;
      if (slot.folder !== undefined && node.kind === "folder") showSummary(slot.folder, node);
      if (slot.holder !== undefined && isValueNode(node)) slot.holder.value = tweakValue(node);
    });
  }
}

// The nodes of a container, in order. A run of buttons (the detect actions) is one row of the essentials' button grid, so
// the buttons sit side by side; each button keeps its own slot, so its node is still refreshed by writeValues.
function mountNodes(container: Container, nodes: readonly PaneNode[], gate: WriteGate): Slot[] {
  const slots: Slot[] = [];
  for (let start = 0; start < nodes.length; ) {
    const node = nodes[start];
    if (node.kind !== "button") {
      slots.push(...mountNode(container, node, gate));
      start++;
      continue;
    }
    let end = start;
    while (end < nodes.length && nodes[end].kind === "button") end++;
    const run: Slot[] = nodes.slice(start, end).map((button) => ({ node: button }));
    const grid = container.addBlade({
      view: "buttongrid",
      size: [run.length, 1],
      cells: (x: number) => ({ title: run[x].node.kind === "button" ? run[x].node.title : "" }),
    });
    grid.on("click", (ev) => {
      const target = run[ev.index[0]].node;
      if (target.kind === "button") target.commit();
    });
    slots.push(...run);
    start = end;
  }
  return slots;
}

function mountNode(container: Container, node: PaneNode, gate: WriteGate): Slot[] {
  const slot: Slot = { node };
  if (node.kind === "folder") {
    const folder = container.addFolder({ title: node.title, expanded: folds.get(node.title) ?? node.expanded });
    folder.on("fold", (ev) => folds.set(node.title, ev.expanded));
    showSummary(folder, node);
    slot.folder = folder;
    return [slot, ...mountNodes(slot.folder, node.children, gate)];
  }
  if (node.kind === "button") {
    container.addButton({ title: node.title }).on("click", () => {
      if (slot.node.kind === "button") slot.node.commit();
    });
    return [slot];
  }
  slot.holder = { value: tweakValue(node) };
  container.addBinding(slot.holder, "value", bindingParams(node)).on("change", (ev) => {
    if (ev.last && gate.accepts() && isValueNode(slot.node)) commitValue(slot.node, ev.value);
  });
  return [slot];
}

// The eye at the right end of an item's title row: a 14 px button that shows or hides the item without folding it. It is
// injected here, once per folder, and its commit is read on each click, so it always writes the latest node. Its icons
// are in eye-icons.ts.
const eyeNodes = new WeakMap<
  HTMLElement,
  { title: string; visible: { value: boolean; commit(next: boolean): void } }
>();

function showEye(button: HTMLElement, node: PaneNode & { kind: "folder" }): void {
  let eye = button.querySelector<HTMLButtonElement>(":scope > .dock-eye");
  if (node.visible === undefined) {
    eye?.remove();
    eyeNodes.delete(button);
    delete button.dataset.hidden;
    return;
  }
  if (eye === null) {
    eye = document.createElement("button");
    eye.type = "button";
    eye.className = "dock-eye";
    eye.addEventListener("click", (event) => {
      event.stopPropagation(); // the eye shows or hides the item; the folder keeps its fold
      event.preventDefault();
      const current = eyeNodes.get(button);
      current?.visible.commit(!current.visible.value);
    });
    button.append(eye);
  }
  eyeNodes.set(button, { title: node.title, visible: node.visible });
  const shown = node.visible.value;
  eye.setAttribute("aria-pressed", String(shown));
  eye.setAttribute("aria-label", `${shown ? "Hide" : "Show"} ${node.title}`);
  eye.title = `${shown ? "Hide" : "Show"} ${node.title}`;
  eye.innerHTML = shown ? EYE : EYE_OFF;
  if (shown) delete button.dataset.hidden;
  else button.dataset.hidden = "";
}

// A folder's summary (the state it shows while shut) goes on its title button as data-summary: the page draws it at the
// right, muted (style.css). Set on every refresh, so a change of state does not rebuild the pane.
function showSummary(folder: Folder, node: PaneNode & { kind: "folder" }): void {
  const button = folder.element.querySelector<HTMLElement>(":scope > .tp-fldv_b");
  if (button === null) return;
  showEye(button, node);
  button.dataset.summary = node.summary ?? "";
  button.title = node.title; // the full title, where the row truncates it (style.css)
  showOrigin(button, node);
  showDraftMark(button, node);
  showSwatch(button, node);
}

// A rule's origin: an icon at the start of its summary, automatic (detected) or manual (the user's own). It is a real element,
// labelled, so it is not icon-only for a screen reader. A row with no origin has none.
function showOrigin(button: HTMLElement, node: PaneNode & { kind: "folder" }): void {
  let mark = button.querySelector<HTMLElement>(":scope > .dock-origin");
  if (node.origin === undefined) {
    mark?.remove();
    return;
  }
  if (mark === null) {
    mark = document.createElement("span");
    mark.className = "dock-origin";
    mark.setAttribute("role", "img");
    button.append(mark);
  }
  const icon = ORIGIN_ICONS[node.origin];
  mark.setAttribute("aria-label", icon.label);
  mark.title = icon.label;
  mark.innerHTML = icon.svg;
}

// An add row (New bond, New shape) draws a "+" in the muted colour (style.css).
function showDraftMark(button: HTMLElement, node: PaneNode & { kind: "folder" }): void {
  if (node.draft === true) button.dataset.draft = "";
  else delete button.dataset.draft;
}

// The colour dot before the name: its colour as a CSS variable, and a dim flag for a hidden item (style.css).
function showSwatch(button: HTMLElement, node: PaneNode & { kind: "folder" }): void {
  if (node.swatch === undefined) {
    button.style.removeProperty("--swatch");
    delete button.dataset.swatch;
    delete button.dataset.dim;
    return;
  }
  const { r, g, b, a } = node.swatch.rgba;
  button.style.setProperty("--swatch", `rgb(${r * CHANNEL_MAX} ${g * CHANNEL_MAX} ${b * CHANNEL_MAX} / ${a})`);
  button.dataset.swatch = "";
  if (node.swatch.dim) button.dataset.dim = "";
  else delete button.dataset.dim;
}

// What a binding holds: an interval is Tweakpane's {min, max} object, the other controls hold their value as it is.
function tweakValue(node: ValueNode): unknown {
  switch (node.kind) {
    case "interval":
      return { min: node.value[0], max: node.value[1] };
    case "point3d":
      return { x: node.value[0], y: node.value[1], z: node.value[2] };
    case "color":
      return toHex(node.value, node.alpha);
    default:
      return node.value;
  }
}

// The options of a binding. A colour is hex text, with the alpha slider when the colour takes transparency (the text then
// has eight digits); collapsed until opened. An absent min or max is left out.
function bindingParams(node: ValueNode): Record<string, unknown> {
  const { label } = node;
  switch (node.kind) {
    case "checkbox":
    case "text":
      return { label };
    case "readonly":
      return { label, readonly: true };
    case "color":
      return { label, color: { type: "int", alpha: node.alpha }, expanded: false };
    case "point3d": {
      const axis = {
        step: node.step,
        ...(node.min === undefined ? {} : { min: node.min }),
        ...(node.max === undefined ? {} : { max: node.max }),
      };
      return { label, x: axis, y: axis, z: axis };
    }
    // A number is a plain field: a range would make Tweakpane draw a slider beside it, so the range is applied when the
    // value is committed (commitValue) instead.
    case "number":
      return { label, step: node.step };
    case "interval":
      return { label, min: node.min, max: node.max, step: node.step, histogram: node.histogram };
    case "list":
      return { label, options: node.options };
  }
}

// Hands one committed value to its node. Tweakpane's value has the shape of the control: a {min, max} object for an
// interval, a {r, g, b, a} object for a colour, and the plain value otherwise.
function commitValue(node: ValueNode, raw: unknown): void {
  switch (node.kind) {
    // A read-only row never commits: its value is the readout's, written by the refresh.
    case "readonly":
      return;
    case "interval": {
      const { min, max } = raw as { min: number; max: number };
      commitIfChanged(node, [min, max]);
      return;
    }
    case "color": {
      // The text is compared as text, so a text that shows the colour already is not an edit.
      const text = raw as string;
      const next = fromHex(text, node.value);
      if (next !== null && !sameValue(text, toHex(node.value, node.alpha))) node.commit(next);
      return;
    }
    case "point3d": {
      const { x, y, z } = raw as { x: number; y: number; z: number };
      commitIfChanged(node, [clampTo(node, x), clampTo(node, y), clampTo(node, z)]);
      return;
    }
    case "checkbox":
      commitIfChanged(node, raw as boolean);
      return;
    case "number":
      commitIfChanged(node, clampTo(node, raw as number));
      return;
    case "text":
    case "list":
      commitIfChanged(node, raw as string);
      return;
  }
}

// Commits a value only when it differs from the node's: a change that sets the same value is not an edit.
function commitIfChanged<T>(node: { value: T; commit(next: T): void }, next: T): void {
  if (!sameValue(next, node.value)) node.commit(next);
}

// A number held within the node's own bounds (an absent bound does not limit it).
function clampTo(node: { min?: number; max?: number }, value: number): number {
  return Math.min(node.max ?? Infinity, Math.max(node.min ?? -Infinity, value));
}
