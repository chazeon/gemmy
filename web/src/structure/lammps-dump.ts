// LAMMPS dump text, handled before fastatoms reads it: the frames a dump has (R4) and its element column under a map
// (R8). Each function gives text or a flag for the reader; none reads a file. Python's readers/lammps_dump.py holds the
// same rules.

const COUNT_HEADER = "ITEM: NUMBER OF ATOMS";
const ATOMS_HEADER = "ITEM: ATOMS";
const ELEMENT_COLUMN = "element";
const NEUTRAL_ELEMENT = "X";

// R4: a frame's atom rows are the lines after its `ITEM: ATOMS` block, one per atom its `ITEM: NUMBER OF ATOMS` block
// declares, and a row is full when it has a value for every column the `ITEM: ATOMS` line names. A dump still being
// written ends in a short frame, which is not read. Whether a dump has at least one complete frame (the last complete
// frame is the one read; with none, the read fails).
export function hasCompleteFrame(text: string): boolean {
  const lines = text.split(/\r\n|\r|\n/);
  let declared: number | undefined;
  for (let at = 0; at < lines.length; at++) {
    const line = lines[at].trim();
    if (line.startsWith(COUNT_HEADER)) {
      declared = Number(lines[at + 1]?.trim());
    } else if (line.startsWith(ATOMS_HEADER) && declared !== undefined) {
      const columns = line.slice(ATOMS_HEADER.length).trim().split(/\s+/).length;
      if (framedRowsAreFull(lines, at + 1, declared, columns)) return true;
    }
  }
  return false;
}

// The `declared` rows after `start` each have `columns` values (blank lines are skipped, as the parser skips them).
function framedRowsAreFull(lines: string[], start: number, declared: number, columns: number): boolean {
  const rows = lines.slice(start).filter((line) => line.trim() !== "");
  if (!(declared > 0) || rows.length < declared) return false;
  return rows.slice(0, declared).every((row) => row.trim().split(/\s+/).length >= columns);
}

// R8: a dump's element column is replaced with the dummy X when a map applies: the map decides the element, so a symbol
// the reader does not know must not fail the read.
export function neutralisedElementColumn(text: string): string {
  let column = -1;
  return text
    .split("\n")
    .map((line) => {
      if (line.startsWith("ITEM:")) {
        const names = line.startsWith(ATOMS_HEADER) ? line.trim().split(/\s+/).slice(2) : [];
        column = names.indexOf(ELEMENT_COLUMN);
        return line;
      }
      if (column < 0 || line.trim() === "") return line;
      const words = line.trim().split(/\s+/);
      if (words.length <= column) return line;
      words[column] = NEUTRAL_ELEMENT;
      return words.join(" ");
    })
    .join("\n");
}
