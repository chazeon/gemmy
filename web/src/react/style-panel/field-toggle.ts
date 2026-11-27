// The toggle on a number field: a checkbox in Tweakpane's own checkbox markup, drawn first in the row's value cell, before the
// number box. A number node with `toggle` (pane-model.ts) gets one, and the Outlines row is the first user; no
// section draws its own. While the toggle is off, the number beside it is dimmed and disabled, keeping its
// value (`showFieldToggle`). The row is marked `gemmy-toggled` so style.css lays its value cell out in one line.
export interface FieldToggle {
  root: HTMLElement;
  input: HTMLInputElement;
}

// A checkbox in Tweakpane's own checkbox markup (its boolean view), so it is drawn, hovered and focused by the stock checkbox
// styles. Used by the toggle (below) and by the checks row (field-checks.ts). `onChange` gets the new state on a change.
export function mountCheckbox(onChange: (on: boolean) => void): FieldToggle {
  const root = document.createElement("div");
  root.className = "tp-ckbv";
  const label = document.createElement("label");
  label.className = "tp-ckbv_l";
  const input = document.createElement("input");
  input.className = "tp-ckbv_i";
  input.type = "checkbox";
  const box = document.createElement("div");
  box.className = "tp-ckbv_w";
  box.innerHTML = '<svg viewBox="0 0 16 16"><path d="M2 8l4 4l8 -8"/></svg>'; // Tweakpane's check icon
  label.append(input, box);
  root.append(label);
  input.addEventListener("change", () => onChange(input.checked));
  return { root, input };
}

// Mounts the toggle at the start of the row's value cell. `onChange` gets the new state when the user changes it.
export function mountFieldToggle(row: HTMLElement, onChange: (on: boolean) => void): FieldToggle {
  row.classList.add("gemmy-toggled");
  const toggle = mountCheckbox(onChange);
  row.querySelector(".tp-lblv_v")?.prepend(toggle.root);
  return toggle;
}

// Dims and disables the number boxes of a point row, one per axis (the Supercell row): the same look the Outlines number
// has while its toggle is off. `disabled[index]` is the box at that index.
export function showPointDisabled(row: HTMLElement, disabled: readonly boolean[]): void {
  Array.from(row.querySelectorAll("input")).forEach((input, index) => {
    const off = disabled[index] === true;
    input.disabled = off;
    input.closest(".tp-txtv")?.classList.toggle("tp-v-disabled", off);
  });
}

// Writes the state: the checkbox, and the other controls of the value cell dimmed and disabled while it is off.
export function showFieldToggle(toggle: FieldToggle, row: HTMLElement, on: boolean): void {
  toggle.input.checked = on;
  const cell = row.querySelector(".tp-lblv_v");
  for (const child of Array.from(cell?.children ?? [])) {
    if (child === toggle.root) continue;
    child.classList.toggle("tp-v-disabled", !on);
    for (const input of child.querySelectorAll("input")) input.disabled = !on;
  }
}
