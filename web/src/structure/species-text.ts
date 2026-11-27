// The species of a structure file's atoms, read from its text: a POSCAR's species (a VASP 5 species line, or a VASP 4
// comment line, R10) and an extended XYZ's species column (R11, over a Z column). fastatoms.ts hands these to the reader,
// and readers.ts keys a VASP file's atoms by them. Python's readers/species_text.py holds the same rules.
import type { StyleKeys } from "./readers";

// Python's int() for one token: an optional sign, digits, and single underscores between digits (`-3`, `1_000`).
const INT_WORD = /^[+-]?\d+(?:_\d+)*$/;

// The whitespace-separated words of a line (Python's str.split() with no argument), without a `!` comment.
function words(line: string): string[] {
  const trimmed = line.split("!", 1)[0].trim();
  return trimmed === "" ? [] : trimmed.split(/\s+/);
}

function allIntegers(tokens: readonly string[]): boolean {
  return tokens.length > 0 && tokens.every((token) => INT_WORD.test(token));
}

// structure._parse_vasp5_species_counts: the species labels on line 6 and their counts on line 7, when those two lines
// are a VASP 5 species line. Undefined for a VASP 4 file, whose line 6 holds the counts.
function vasp5Species(text: string): string[] | undefined {
  const lines = text.split(/\r\n|\r|\n/);
  if (lines.length < 7) return undefined;
  const species = words(lines[5]);
  const counts = words(lines[6]);
  if (species.length === 0 || !allIntegers(counts) || allIntegers(species)) return undefined;
  return counts.length === species.length ? species : undefined;
}

// The POSCAR rule: a VASP 5 species line keys each atom by its label (Fe_pv, Fe1); a VASP 4 file keys by symbol.
export function vaspStyleKeys(text: string): StyleKeys {
  return vasp5Species(text) === undefined ? "symbols" : "labels";
}

// R10: a VASP 4 file has no species line, so its species are the words of its comment line (the first line). The
// words are the labels, each of which must name an element (checked by the caller). Undefined for a VASP 5 file.
export function vasp4CommentSpecies(text: string): string[] | undefined {
  if (vasp5Species(text) !== undefined) return undefined;
  return words(text.split(/\r\n|\r|\n/)[0] ?? "");
}

// The label of each atom of a VASP 4 file: its comment line's species, each repeated by its count (line 6). Undefined
// for a VASP 5 file, or when the counts do not match the species.
export function vasp4AtomLabels(text: string): string[] | undefined {
  const species = vasp4CommentSpecies(text);
  if (species === undefined) return undefined;
  const counts = words(text.split(/\r\n|\r|\n/)[5] ?? "");
  if (!allIntegers(counts) || counts.length !== species.length) return undefined;
  return species.flatMap((label, k) => Array.from({ length: Number(counts[k]) }, () => label));
}

// R11: the species column of an extended XYZ file. The header's Properties names the columns, in order (name:type:count
// triples); the species is the word at its column in each atom row.
// The species of each atom, in row order, or undefined when the header names no species column.
export function extxyzSpecies(text: string): string[] | undefined {
  const lines = text.split(/\r\n|\r|\n/);
  const properties = /Properties=(\S+)/.exec(lines[1] ?? "")?.[1];
  if (properties === undefined) return undefined;
  const fields = properties.split(":");
  let column = 0;
  let speciesColumn = -1;
  for (let at = 0; at + 2 < fields.length; at += 3) {
    if (fields[at] === "species") {
      speciesColumn = column;
      break;
    }
    column += Number(fields[at + 2]);
  }
  if (speciesColumn < 0) return undefined;
  const atomCount = Number(lines[0]);
  const species: string[] = [];
  for (let row = 0; row < atomCount; row++) {
    const word = lines[2 + row]?.trim().split(/\s+/)[speciesColumn];
    if (word === undefined) return undefined;
    species.push(word);
  }
  return species;
}
