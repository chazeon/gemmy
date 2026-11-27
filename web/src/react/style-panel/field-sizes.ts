// The Size row of a cluster: two whole-number boxes, the lower then the upper (min_size, max_size), with an en dash between
// them: `Size  [ 5 ] – [ 6 ]`. The boxes are the Window row's own number fields (range-histogram-view.ts, `gemmy-rh-input`),
// and the row fills the value column as the Window's boxes do (style.css, .gemmy-sizes). A `sizes` node (pane-model.ts) is
// drawn by these functions only, as the checks row is drawn by field-checks.ts. An empty upper box is no limit (a molecule's);
// the adapter reads both boxes on a change and commits them as one edit.
export interface FieldSizes {
  row: HTMLElement;
  lower: HTMLInputElement;
  upper: HTMLInputElement;
}

// Shown in the upper box when it is no limit: it is empty, and the placeholder says what empty means.
const NO_LIMIT = "∞";

// Fills `blade` (a blade's element) with the row. `onChange` runs when either box is changed and committed by the user.
export function mountFieldSizes(blade: HTMLElement, label: string, onChange: () => void): FieldSizes {
  blade.classList.remove("tp-sprv");
  blade.replaceChildren();
  const row = document.createElement("div");
  row.className = "tp-lblv";
  const title = document.createElement("div");
  title.className = "tp-lblv_l";
  title.textContent = label;
  const cell = document.createElement("div");
  cell.className = "tp-lblv_v gemmy-sizes";
  const lower = mountBox("Minimum size", "gemmy-rh-input-min", onChange);
  const dash = document.createElement("span");
  dash.className = "gemmy-sizes-dash";
  dash.textContent = "–";
  dash.setAttribute("aria-hidden", "true");
  const upper = mountBox("Maximum size", "gemmy-rh-input-max", onChange);
  cell.append(lower, dash, upper);
  row.append(title, cell);
  blade.append(row);
  return { row, lower, upper };
}

function mountBox(name: string, side: string, onChange: () => void): HTMLInputElement {
  const input = document.createElement("input");
  input.type = "text";
  input.className = `gemmy-rh-input ${side}`;
  // The histogram CSS sets 50% on every field, and Tweakpane's styles are unlayered, so the page's layered CSS cannot
  // override it: the width is the box's own, so the boxes fill their grid cells (style.css, .gemmy-sizes).
  input.style.width = "100%";
  input.inputMode = "numeric";
  input.setAttribute("aria-label", name);
  input.title = name;
  input.addEventListener("change", onChange);
  return input;
}

// Writes the two sizes into their boxes; a null upper is an empty box with the no-limit mark.
export function showFieldSizes(sizes: FieldSizes, value: [number, number | null]): void {
  const [lower, upper] = value;
  sizes.lower.value = String(lower);
  sizes.upper.value = upper === null ? "" : String(upper);
  sizes.upper.placeholder = upper === null ? NO_LIMIT : "";
}

// The two sizes the boxes hold, as whole numbers from `min` up, or null when a box holds no number (the caller then writes the
// node's own sizes back). An empty upper box is null: no limit.
export function readFieldSizes(sizes: FieldSizes, min: number): [number, number | null] | null {
  const lower = wholeNumber(sizes.lower.value, min);
  if (lower === null) return null;
  if (sizes.upper.value.trim() === "") return [lower, null];
  const upper = wholeNumber(sizes.upper.value, min);
  return upper === null ? null : [lower, upper];
}

// A whole number from `min` up, or null for text that holds no number.
function wholeNumber(text: string, min: number): number | null {
  const trimmed = text.trim();
  const value = Number(trimmed);
  if (trimmed === "" || !Number.isFinite(value)) return null;
  return Math.max(min, Math.round(value));
}
