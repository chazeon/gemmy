// A crystal structure: the cell, and the atoms in fractional coordinates. The reader (fastatoms.ts) fills it; nothing
// here touches the wasm, so the compile stages can take a Structure without it.
import type { Vec3 } from "../types";

// One atom: its element (the chemical symbol), its fractional coordinates, and its style key (the species label a
// POSCAR gives it, or the symbol; the LAMMPS type label for a LAMMPS file).
export interface AtomRecord {
  element: string;
  fractional: Vec3;
  styleKey: string;
}

// A kept site whose occupants are not one species at occupancy 1 (R12): the index of its atom, and each occupant's
// symbol with its occupancy, the largest share first. The same shape as readers/record.py's PartialSite.
export interface PartialSite {
  index: number;
  occupants: Record<string, number>;
}

export interface Structure {
  // The file's name.
  comment: string;
  // The lattice vectors as rows.
  lattice: [Vec3, Vec3, Vec3];
  // The axes the file says are periodic (a POSCAR or CIF: all three; an extxyz or LAMMPS file: its pbc).
  pbc: [boolean, boolean, boolean];
  atoms: AtomRecord[];
  // The kept sites that are partly occupied (R12); empty unless the file has an occupancy table.
  partial: PartialSite[];
}

// The neighbour pairs of a supercell, as fastatoms gives them: i and j are atom indices into the supercell, S holds
// the cell offset of each pair (3 integers per pair, flat) and d the distance.
export interface NeighborPairs {
  readonly i: Int32Array;
  readonly j: Int32Array;
  readonly S: Int32Array;
  readonly d: Float64Array;
}

// The supercell the compile stages read, with its neighbour search. The types live here, not in fastatoms.ts, so
// compile/ can take a NeighborSource without importing the wasm (structure/neighbors.ts makes one, over fastatoms.ts).
export interface NeighborSource {
  // The supercell's lattice vectors as rows.
  cell: [Vec3, Vec3, Vec3];
  // Cartesian and fractional coordinates of every supercell atom, in the order its neighbour pairs refer to.
  readonly positions: readonly Vec3[];
  readonly scaled: readonly Vec3[];
  // Each atom's element (its chemical symbol), and its label (the species label it is written with, or its element).
  readonly symbols: readonly string[];
  readonly labels: readonly string[];
  neighbors(cutoff: number): NeighborPairs;
}
