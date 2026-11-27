// Which Tweakpane changes are user commits. Tweakpane reports every change of a binding's value, and a write from the
// adapter (a sync) is one too, with `last` true, as a user's end of a drag would be. So the adapter makes its writes inside
// `run`, and a change that comes while it writes is not a commit. A commit that would set a node's own value is not one
// either. No Tweakpane import here, so the node test reads this file (tests/test_view_style_pane.py).

export class WriteGate {
  private writing = false;

  // Runs a programmatic write (the bindings' values, the refresh) with the changes it causes left out of the commits.
  run(write: () => void): void {
    this.writing = true;
    try {
      write();
    } finally {
      this.writing = false;
    }
  }

  // Whether a change Tweakpane reports is a user's.
  accepts(): boolean {
    return !this.writing;
  }
}

// Whether two values are the same: primitives by identity, arrays and plain objects by their entries.
export function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = Object.keys(left);
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.hasOwn(right, key) && sameValue(left[key], right[key]))
  );
}
