// The checks row: one row with a checkbox per item, each followed by its label (the Periodic row: a, b, c). A `checks` node
// (pane-model.ts) is drawn by these two functions only. Tweakpane has no multi-checkbox, so the row is Tweakpane's own row
// markup, filled into the blade the adapter makes for it, with the checkboxes of field-toggle.ts. Each item keeps its own
// commit: the adapter passes the change of item `index` on.
import { mountCheckbox } from "./field-toggle";

export interface FieldChecks {
  inputs: HTMLInputElement[];
}

// Fills `blade` (a blade's element) with the row. `onChange` gets the index of the item that changed and its new state.
export function mountFieldChecks(
  blade: HTMLElement,
  label: string,
  items: readonly { label: string }[],
  onChange: (index: number, on: boolean) => void,
): FieldChecks {
  blade.classList.remove("tp-sprv");
  blade.replaceChildren();
  const row = document.createElement("div");
  row.className = "tp-lblv";
  const title = document.createElement("div");
  title.className = "tp-lblv_l";
  title.textContent = label;
  const cell = document.createElement("div");
  cell.className = "tp-lblv_v gemmy-checks";
  // One column per item: its letter, then its checkbox (`a [✓]`), at the column's right edge. The columns sit on the point
  // control's grid (style.css, .gemmy-checks), so each one is under the matching box of a Supercell row.
  cell.style.setProperty("--gemmy-checks", String(items.length));
  const inputs = items.map((item, index) => {
    const column = document.createElement("label");
    column.className = "gemmy-check";
    const box = mountCheckbox((on) => onChange(index, on));
    const text = document.createElement("span");
    text.className = "gemmy-check-label";
    text.textContent = item.label;
    column.append(text, box.root);
    cell.append(column);
    return box.input;
  });
  row.append(title, cell);
  blade.append(row);
  return { inputs };
}

// Writes the items' values into their checkboxes.
export function showFieldChecks(checks: FieldChecks, items: readonly { value: boolean }[]): void {
  items.forEach((item, index) => {
    checks.inputs[index].checked = item.value;
  });
}
