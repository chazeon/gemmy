// Site labels (compile/labels.py): a sidecar file (JSON or TOML) read by its text, and applying the labels to sites.
// The labeler hook (`path.py:func`) is Python only; a config that names one gets labelerUnsupported.
import { DataFileError, readData } from "./datafile";
import type { Site } from "./sites";

// A label file or the labeler is missing or invalid; the message names the source.
export class LabelError extends Error {}

// Source-structure index -> label. Keys are the indices as numbers (JSON object keys are strings).
export type LabelMap = Readonly<Record<number, string>>;

// Python's repr, for the values a label file can hold (in the error messages only).
function pyRepr(value: unknown): string {
  if (value === null || value === undefined) return "None";
  if (typeof value === "boolean") return value ? "True" : "False";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") {
    const quote = value.includes("'") && !value.includes('"') ? '"' : "'";
    const escaped = value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
    return quote + escaped.split(quote).join(`\\${quote}`) + quote;
  }
  if (Array.isArray(value)) return `[${value.map(pyRepr).join(", ")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value).map(([k, v]) => `${pyRepr(k)}: ${pyRepr(v)}`);
    return `{${entries.join(", ")}}`;
  }
  return String(value);
}

// Python's int() on a string: surrounding whitespace, an optional sign, digits with single underscores between them.
const PY_INT = /^[+-]?\d+(?:_\d+)*$/;

// The indices of one entry: an int, or a 'lo-hi' range (both ends inclusive, an empty range when lo > hi).
function expand(spec: unknown, source: string): number[] {
  if (typeof spec === "number" && Number.isInteger(spec)) return [spec];
  // Python's bool is an int: true is index 1.
  if (typeof spec === "boolean") return [spec ? 1 : 0];
  if (typeof spec === "string" && spec.includes("-")) {
    const dash = spec.indexOf("-");
    const lo = spec.slice(0, dash).trim();
    const hi = spec.slice(dash + 1).trim();
    if (PY_INT.test(lo) && PY_INT.test(hi)) {
      const range: number[] = [];
      for (let n = Number(lo.replace(/_/g, "")); n <= Number(hi.replace(/_/g, "")); n++) range.push(n);
      return range;
    }
  }
  throw new LabelError(`${source}: cannot read index ${pyRepr(spec)}; use an int or a 'lo-hi' range`);
}

// labels.load_label_file: `{"3": "H1"}` (index -> label) and/or `{"H1": [3, "5-7"]}` (label -> indices), optionally
// under a "labels" key. `name` is the file's name, used in the messages; `text` is its content.
export function loadLabelFile(name: string, text: string): LabelMap {
  let data: unknown;
  try {
    data = readData(name, text);
  } catch (error) {
    if (error instanceof DataFileError) throw new LabelError(`label file: ${error.message}`);
    throw error;
  }
  const table = isRecord(data) ? (Object.hasOwn(data, "labels") ? data.labels : data) : undefined;
  if (!isRecord(table)) throw new LabelError(`label file ${name} must contain an object (optionally under 'labels')`);
  // The labels each atom is given. JS object keys are not in file order (integer-like keys come first); singleLabels
  // sorts the atoms and the labels itself, so the message is the same as the Python one, which reads the file in order.
  const labelsGiven = new Map<number, Set<string>>();
  const addLabel = (idx: number, label: string) => {
    const labels = labelsGiven.get(idx) ?? new Set<string>();
    labels.add(label);
    labelsGiven.set(idx, labels);
  };
  for (const [key, value] of Object.entries(table)) {
    if (typeof value === "string") {
      if (!/^\d+$/.test(key)) {
        throw new LabelError(`label file ${name}: key ${pyRepr(key)} must be an atom index when its value is a label`);
      }
      addLabel(Number(key), value);
    } else if (Array.isArray(value)) {
      for (const item of value) {
        for (const idx of expand(item, name)) addLabel(idx, key);
      }
    } else {
      throw new LabelError(`label file ${name}: entry ${pyRepr(key)} must be a label or a list of indices`);
    }
  }
  return singleLabels(name, labelsGiven);
}

// One label per atom. An atom given two different labels is an error; the message names the lowest such atom and its
// two labels in sorted order.
function singleLabels(name: string, labelsGiven: Map<number, Set<string>>): LabelMap {
  const out: Record<number, string> = {};
  for (const idx of [...labelsGiven.keys()].sort((a, b) => a - b)) {
    const names = [...(labelsGiven.get(idx) ?? [])].sort();
    const [first, second] = names;
    if (names.length > 1) {
      throw new LabelError(
        `label file ${name}: atom ${idx} is given two labels, ${pyRepr(first)} and ${pyRepr(second)}`,
      );
    }
    out[idx] = first;
  }
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// labels.apply_labels: override the label of every site whose base index (index % baseCount) has one.
export function applyLabels(sites: Site[], labels: LabelMap, baseCount: number): Site[] {
  if (Object.keys(labels).length === 0 || baseCount <= 0) return sites;
  return sites.map((site) => {
    const label = labels[site.index % baseCount];
    return label === undefined ? site : { ...site, label };
  });
}

// labels.run_labeler, which cannot run in a browser: the error says so and points at the sidecar file.
export function labelerUnsupported(spec: string): never {
  throw new LabelError(
    `labeler ${spec}: the Python labeler hook is not available in the browser; use labels.file (a JSON or TOML sidecar) instead`,
  );
}
