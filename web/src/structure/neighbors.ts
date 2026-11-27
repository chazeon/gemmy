// The supercell the compile stages read: its atoms and cell, and the neighbour pairs within a cutoff. The wasm is reached
// only through fastatoms.ts (withSupercell, readSupercell, neighborPairsOf), so this file imports no vendored package.
import type { NeighborPairs, NeighborSource, Structure } from "./structure";
import { neighborPairsOf, readSupercell, type SupercellBase, withSupercell } from "./fastatoms";
import type { Vec3 } from "../types";

// The supercell's atoms and cell for the compile stages, plus the neighbour pairs within a cutoff (pair indices i and j,
// cell offsets S and distances d). The structure, supercell and periodic flags are copied here, so every call refers to
// the same supercell as the positions and symbols. Each neighbors() call builds its own wasm atoms and frees them.
export function neighborSource(
  structure: Structure,
  supercell: readonly [number, number, number],
  periodic: readonly [boolean, boolean, boolean],
): NeighborSource {
  const own = copyStructure(structure);
  const cells: [number, number, number] = [supercell[0], supercell[1], supercell[2]];
  const flags: [boolean, boolean, boolean] = [periodic[0], periodic[1], periodic[2]];
  const supercellAtoms = withSupercell(supercellBase(own), cells, flags, readSupercell);
  return {
    ...supercellAtoms,
    labels: supercellLabels(own, supercellAtoms.symbols.length),
    neighbors(cutoff: number): NeighborPairs {
      // A cutoff that reaches nothing has no pairs, so no search runs.
      if (cutoff <= 0) {
        return { i: new Int32Array(0), j: new Int32Array(0), S: new Int32Array(0), d: new Float64Array(0) };
      }
      return withSupercell(supercellBase(own), cells, flags, (atoms) => neighborPairsOf(atoms, cutoff));
    },
  };
}

// The base cell of a structure for the wasm builder: its lattice, its symbols and its Cartesian positions (flat).
function supercellBase(structure: CellAtoms): SupercellBase {
  return {
    lattice: structure.lattice,
    symbols: structure.atoms.map((atom) => atom.element),
    positions: structure.atoms.flatMap((atom) => cartesian(atom.fractional, structure.lattice)),
  };
}

// The labels of a supercell's atoms: the structure's labels cycled over the repeats, in the order sites.ts gives the atoms
// (atom i of the supercell is base atom i % count).
function supercellLabels(structure: CellAtoms, count: number): string[] {
  const keys = structure.atoms.map((atom) => atom.styleKey || atom.element);
  return Array.from({ length: count }, (_, i) => keys[i % keys.length]);
}

// A fractional point in a cell with these rows, in Cartesian coordinates (the row-vector product, as ASE does it).
function cartesian(fractional: Vec3, lattice: readonly Vec3[]): Vec3 {
  const at = (c: number) =>
    fractional[0] * lattice[0][c] + fractional[1] * lattice[1][c] + fractional[2] * lattice[2][c];
  return [at(0), at(1), at(2)];
}

// The part of a structure the supercell is built from: its cell and its atoms.
type CellAtoms = Pick<Structure, "lattice" | "atoms">;

// A deep copy, so the source never reads the caller's objects again.
function copyStructure(structure: Structure): CellAtoms {
  const copyVec = (v: Vec3): Vec3 => [v[0], v[1], v[2]];
  return {
    lattice: [copyVec(structure.lattice[0]), copyVec(structure.lattice[1]), copyVec(structure.lattice[2])],
    atoms: structure.atoms.map((atom) => ({
      element: atom.element,
      fractional: copyVec(atom.fractional),
      styleKey: atom.styleKey,
    })),
  };
}
