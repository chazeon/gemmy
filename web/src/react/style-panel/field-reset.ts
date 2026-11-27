// The reset dot of a changed value: a small accent dot hanging in the left gutter of its row, vertically centred on it. It
// takes no layout space (absolutely positioned, style.css .gemmy-reset), so the label never moves; its hit area is larger
// than the dot. One piece for every row with `default` (pane-model.ts); the adapter attaches it from the node's default, and
// no section draws its own. Its click is the node's own commit with the default, so it is one undoable edit. It is hidden
// (display) while the value equals the default.
export function mountFieldReset(row: HTMLElement, reset: () => void): HTMLButtonElement {
  row.classList.add("gemmy-has-reset");
  const button = document.createElement("button");
  button.type = "button";
  button.className = "gemmy-reset";
  button.setAttribute("aria-label", "Reset to default");
  button.title = "Reset to default";
  // A press on the dot is not a press on the row: no drag of a number's scrub, no focus on its text.
  button.addEventListener("pointerdown", (event) => event.stopPropagation());
  button.addEventListener("mousedown", (event) => event.preventDefault());
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    reset();
  });
  row.append(button);
  return button;
}

// Shows the dot while the value differs from the default.
export function showFieldReset(button: HTMLButtonElement, changed: boolean): void {
  button.toggleAttribute("data-off", !changed);
}
