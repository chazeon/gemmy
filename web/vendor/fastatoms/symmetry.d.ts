/**
 * Space-group analysis and cell standardisation, via spglib.
 *
 *   import { symmetry } from "fastatoms";
 *   const ds = symmetry.getSymmetryDataset(atoms, { symprec: 1e-3 });
 *   ds.number;          // 225 for fcc Cu
 *
 * Available only when the module was built with FASTATOMS_WITH_SYMMETRY
 * (the default for `--full`; `--minimal` and `--gemmy` leave it out). Check
 * with `hasSymmetry()`. Every other function throws when it is missing.
 *
 * Tolerances: `symprec` in angstrom (default 1e-5), `angleTolerance` in
 * degrees (default -1: spglib's own rule). `useLabels` types atoms by their
 * label (Fe1, Fe2 are different sites) instead of by element.
 */
import { Atoms } from "./atoms.js";
/** Tolerances shared by every symmetry function. */
export interface SymmetryTolerances {
    /** Distance tolerance in angstrom. Default 1e-5. */
    symprec?: number;
    /** Angle tolerance in degrees. Default -1 (spglib's default). */
    angleTolerance?: number;
    /** Type atoms by label, not by element. Default false. */
    useLabels?: boolean;
}
export interface StandardizeOptions extends SymmetryTolerances {
    /** Return the primitive cell instead of the conventional one. Default false. */
    toPrimitive?: boolean;
    /** Keep the input positions and change only the basis. Default false. */
    noIdealize?: boolean;
}
/**
 * spglib's dataset for one structure. Per-atom arrays have one entry per
 * input atom. Lattices are row-major 3x3 with rows as lattice vectors.
 * Rotations are integer 3x3 matrices acting on fractional coordinates,
 * `x' = R x + t`.
 */
export interface SymmetryDataset {
    /** International Tables number, 1..230. */
    number: number;
    /** Short Hermann-Mauguin symbol, e.g. "Fm-3m". */
    international: string;
    /** Hall symbol, e.g. "-F 4 2 3". */
    hall: string;
    /** spglib's serial number of the setting, 1..530. */
    hallNumber: number;
    /** Origin or axis choice, e.g. "1" or "2". Empty when none applies. */
    choice: string;
    /** Point group in spglib's notation, e.g. "m-3m". */
    pointgroup: string;
    /** Flat, 9 integers per operation (row-major R), n operations. */
    rotations: Int32Array;
    /** Flat, 3 doubles per operation. */
    translations: Float64Array;
    /** One Wyckoff letter per atom ("a", "f", ...). */
    wyckoffs: string[];
    /** One site-symmetry symbol per atom ("-4m2", "mm2", ...). */
    siteSymmetrySymbols: string[];
    /** Per atom: index of the representative of its symmetry orbit. */
    equivalentAtoms: Int32Array;
    /** Per atom: orbit number, consecutive from 0. */
    crystallographicOrbits: Int32Array;
    /** Standardised conventional lattice, row-major, rows as vectors. */
    stdLattice: Float64Array;
    /** Per standard atom: type (atomic number, or label index with useLabels). */
    stdTypes: Int32Array;
    /** Flat fractional positions of the standard atoms, in stdLattice. */
    stdPositions: Float64Array;
    /** P, with x_std = P x + p. Row-major. */
    transformationMatrix: Float64Array;
    /** p, with x_std = P x + p. */
    originShift: Float64Array;
    /** Primitive lattice, row-major, in the input frame. */
    primitiveLattice: Float64Array;
    /** Per input atom: index of its atom in the primitive cell. */
    mappingToPrimitive: Int32Array;
    /** Per standard atom: index of its atom in the primitive cell. */
    stdMappingToPrimitive: Int32Array;
}
/** Whether this build has symmetry (spglib). False for `--minimal` and `--gemmy`. */
export declare function hasSymmetry(): boolean;
/** The spglib dataset of `atoms`. @throws if the cell is not periodic or has no symmetry. */
export declare function getSymmetryDataset(atoms: Atoms, options?: SymmetryTolerances): SymmetryDataset;
/** spglib's standardised cell (conventional by default, primitive with `toPrimitive`). */
export declare function standardizeCell(atoms: Atoms, options?: StandardizeOptions): Atoms;
/** The primitive cell, idealised. */
export declare function findPrimitive(atoms: Atoms, options?: SymmetryTolerances): Atoms;
/** The Niggli-reduced cell of the same lattice. Positions stay Cartesian. */
export declare function niggliReduce(atoms: Atoms, options?: {
    symprec?: number;
}): Atoms;
