import type { RawAtoms } from "./raw.js";
/** A Cartesian or fractional triple. */
export type Vec3 = readonly [number, number, number];
/** Kind of a named per-atom array. Integer arrays are returned as Float64Array. */
export type ArrayKind = "float" | "int" | "string";
export interface ArrayInfo {
    readonly name: string;
    readonly kind: ArrayKind;
    /** Components per atom (1 for scalars and for string arrays). */
    readonly ncols: number;
}
export interface FromArraysOptions {
    /** Chemical symbols or labels-free element names, e.g. ["Na", "Cl"]. */
    symbols?: readonly string[];
    /** Atomic numbers. Give exactly one of `symbols` or `numbers`. */
    numbers?: ArrayLike<number>;
    /** 3N Cartesian coordinates, flat (x0, y0, z0, x1, ...). */
    positions: ArrayLike<number>;
    /** Lattice vectors as 9 row-major numbers or as three rows. Omitted: zero cell. */
    cell?: ArrayLike<number> | readonly Vec3[] | null;
    /** Periodicity per axis, or one flag for all three. Default: false. */
    pbc?: boolean | readonly [boolean, boolean, boolean];
}
/** Releases a handle that a failed call returned, so it is not left to the GC. */
export declare function discardRaw(raw: RawAtoms): void;
/**
 * A structure: species, positions, optional periodic cell and per-atom
 * arrays. ASE-flavoured. Typed arrays returned by getters are copies, so
 * they stay valid after further calls and after memory growth.
 *
 * Call `dispose()` when done to free the wasm-side memory right away. If you
 * do not, a FinalizationRegistry frees it when the object is collected.
 */
export declare class Atoms {
    #private;
    /**
     * Wrap an embind handle. Internal: use `read`, `readAll`, `Atoms.fromArrays`.
     * @internal
     */
    constructor(raw: RawAtoms);
    /** @internal The embind handle, for functions that take raw atoms. */
    rawHandle(): RawAtoms;
    /** True once `dispose()` has been called. */
    get disposed(): boolean;
    /** Free the wasm-side memory now. Calling it again does nothing. */
    dispose(): void;
    /** Number of atoms. */
    get length(): number;
    /** Lattice vectors as a row-major 3x3 matrix (rows are lattice vectors). */
    get cell(): Float64Array;
    /** Periodicity along a, b, c. */
    get pbc(): [boolean, boolean, boolean];
    /** Names of the per-atom arrays, including "labels" when present. */
    get arrays(): string[];
    /**
     * Frame information, parsed from JSON. Each access parses a fresh copy, so
     * mutating the result does not change the atoms.
     */
    get info(): Record<string, unknown>;
    /** Cartesian positions, flat 3N copy. */
    getPositions(): Float64Array;
    /**
     * Replace all positions (flat 3N).
     *
     * Caller-controlled array-likes are copied before the handle is taken: a
     * getter on the input may run arbitrary code, `dispose()` included.
     */
    setPositions(positions: ArrayLike<number>): void;
    /** Set the lattice; with `scaleAtoms` the fractional coordinates are kept. */
    setCell(cell: ArrayLike<number> | readonly Vec3[], scaleAtoms?: boolean): void;
    /** Set periodicity: one flag for all axes, or one per axis. */
    setPbc(pbc: boolean | readonly [boolean, boolean, boolean]): void;
    /** Fractional coordinates, flat 3N copy. `wrap` folds them into [0, 1). */
    getScaledPositions(options?: {
        wrap?: boolean;
    }): Float64Array;
    /** Element symbol of every atom ("H" for the label "H1"). */
    getChemicalSymbols(): string[];
    /** Atomic number of every atom. */
    getAtomicNumbers(): Int32Array;
    /**
     * Species label per atom as the file wrote it ("Fe1", "Fe_pv", "O2-").
     * Falls back to the symbols when the structure has no labels.
     */
    getLabels(): string[];
    /**
     * A named per-atom array. Double and integer arrays come back as Float64Array
     * (flat, `ncols` values per atom); string arrays as string[].
     * @throws if there is no array with that name.
     */
    getArray(name: string): Float64Array | string[];
    /** Name, kind and column count of every per-atom array. */
    arrayInfo(): ArrayInfo[];
    /**
     * Supercell with `n` repeats per axis (or `[nx, ny, nz]`). Atoms are ordered
     * as ASE orders them: the atom index varies fastest, so the label of
     * repeated atom k is the label of atom `k % N`.
     */
    repeat(n: number | readonly [number, number, number]): Atoms;
    /** New atoms holding only `indices`, in the given order. */
    subset(indices: ArrayLike<number>): Atoms;
    /** Fold every atom into the cell along the periodic axes (in place). */
    wrap(): void;
    /** An independent copy. */
    copy(): Atoms;
    /** Cell volume in cubic angstrom (0 for a zero cell). */
    getVolume(): number;
    /**
     * Build atoms from plain arrays. Give `symbols` or `numbers`; the labels
     * default to the symbols.
     */
    static fromArrays(spec: FromArraysOptions): Atoms;
}
