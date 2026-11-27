// LAMMPS data text, handled before fastatoms reads it, for the rules fastatoms does not meet (the contract's R1 and
// R13). Each function gives text or a table for the reader; none reads a file. Python's readers/lammps_data.py and
// readers/typemap.py hold the same rules.
import { elementOfLabel } from "./elements";

// The three tilt labels of a restricted box, in the order fastatoms reads them.
const TILT_ORDER = ["xy", "xz", "yz"];
// A header line's tilt values and labels, in any order: `-1.0 0.5 0.25 xz xy yz`.
const TILT_LINE = /^(\s*)(\S+)\s+(\S+)\s+(\S+)\s+(xy|xz|yz)\s+(xy|xz|yz)\s+(xy|xz|yz)\s*$/;
// The section headers a data file names (a header may carry a `# style` comment).
const SECTION_HEADERS = new Set([
  "Atoms",
  "Velocities",
  "Masses",
  "Atom Type Labels",
  "Bonds",
  "Angles",
  "Dihedrals",
  "Impropers",
]);

// The words of a line and its `#` comment (trimmed; undefined when there is none).
function splitComment(line: string): { words: string[]; comment: string | undefined } {
  const [code, ...rest] = line.split("#");
  const comment = rest.length > 0 ? rest.join("#").trim() : undefined;
  return { words: code.trim() === "" ? [] : code.trim().split(/\s+/), comment: comment || undefined };
}

// R1: the tilt values of a data file's header, written in xy xz yz order with their labels, so that fastatoms (which
// reads them by position) reads each one by its label.
export function tiltsInLabelOrder(text: string): string {
  return text
    .split("\n")
    .map((line) => {
      const match = TILT_LINE.exec(line.replace(/\r$/, ""));
      if (match === null) return line;
      const values = [match[2], match[3], match[4]];
      const labels = [match[5], match[6], match[7]];
      if (new Set(labels).size !== TILT_ORDER.length) return line;
      const ordered = TILT_ORDER.map((label) => values[labels.indexOf(label)]);
      return `${match[1]}${ordered.join(" ")} ${TILT_ORDER.join(" ")}`;
    })
    .join("\n");
}

// What a data file says about its types, for the types with no label: the Masses comment of each (R13's step 2).
export interface DataTypeNames {
  labelled: Set<number>;
  comments: Map<number, string>;
}

// The type names of a data file: the types with an `Atom Type Labels` entry, and each Masses comment (by type number;
// a Masses row may name its type by label, which is resolved through the labels).
export function dataTypeNames(text: string): DataTypeNames {
  const lines = text.split(/\r\n|\r|\n/).slice(1);
  const labelNumbers = new Map<string, number>();
  let section = "";
  const masses: { key: string; comment: string | undefined }[] = [];
  const labelRows: [number, string][] = [];
  for (const line of lines) {
    const { words, comment } = splitComment(line);
    if (words.length === 0) continue;
    const header = words.join(" ");
    if (SECTION_HEADERS.has(header) || header === "Atom Type Labels") {
      section = header;
      continue;
    }
    if (section === "Atom Type Labels" && words.length >= 2 && /^\d+$/.test(words[0])) {
      labelRows.push([Number(words[0]), words[1]]);
    } else if (section === "Masses" && words.length >= 2) {
      masses.push({ key: words[0], comment });
    }
  }
  for (const [number, label] of labelRows) labelNumbers.set(label, number);
  const numberOf = (key: string) => (/^\d+$/.test(key) ? Number(key) : labelNumbers.get(key));
  const labelled = new Set(labelRows.map(([number]) => number));
  const comments = new Map<number, string>();
  for (const row of masses) {
    const number = numberOf(row.key);
    if (number !== undefined && row.comment !== undefined) comments.set(number, row.comment);
  }
  return { labelled, comments };
}

// R13 for a file with no map: a type with an element-naming Masses comment is that element, keyed by the comment; a type
// with no label and no such comment is keyed by its type number (its element is the one its mass names, fastatoms').
export function noMapIdentity(names: DataTypeNames, type: number): { element?: string; key?: string } {
  if (names.labelled.has(type)) return {};
  const comment = names.comments.get(type);
  if (comment !== undefined) {
    const element = elementOfLabel(comment);
    if (element !== undefined) return { element, key: comment };
  }
  return { key: String(type) };
}
