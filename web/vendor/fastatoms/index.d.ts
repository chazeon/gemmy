/**
 * fastatoms: structure IO, symmetry and neighbour lists, compiled to WebAssembly.
 *
 *   import { init, read, neighborList, io, symmetry } from "fastatoms";
 *   await init();
 *   const atoms = read(poscarText, { filename: "POSCAR" });
 *   const nl = neighborList("ijd", atoms, 3.0);
 *   const frames = io.read(trajectory, { filename: "traj.xyz", index: ":" });
 *
 * `init()` must resolve before any other call. Everything else is synchronous,
 * except `io.read` on a Blob or File, which returns a Promise.
 */
import { Atoms } from "./atoms.js";
import * as io from "./io.js";
import { init } from "./module.js";
import type { EmscriptenFactory, NeighborKey } from "./raw.js";
export { init, Atoms, io };
export type { EmscriptenFactory };
export * as symmetry from "./symmetry.js";
export type { ArrayInfo, ArrayKind, FromArraysOptions, Vec3 } from "./atoms.js";
export type { IndexResult, IOInput, IOOptions, TextInput, WriteOptions as IOWriteOptions } from "./io.js";
/** Options that are not forwarded to the format reader. */
export interface ReadOptions {
    /** Format name ("vasp", "xyz", "extxyz", "cif", "lammps-data", "lammps-dump"). */
    format?: string;
    /** File name, used to guess the format when `format` is omitted. */
    filename?: string;
    /** Frame to return (`read` only). Default -1: the last frame, like ASE. */
    index?: number;
    /** Format-specific options, e.g. `{ species: ["Fe", "O"] }` for VASP 4. */
    [option: string]: unknown;
}
export interface WriteOptions {
    /** Output format. Required. */
    format: string;
    /** Format-specific options, e.g. `{ labels: false }` for POSCAR. */
    [option: string]: unknown;
}
export interface NeighborOptions {
    /** Both (i, j, S) and (j, i, -S). Default true, as in ASE's full lists. */
    full?: boolean;
}
export interface NeighborArrays {
    /** Central atom index. */
    i: Int32Array;
    /** Neighbour atom index. */
    j: Int32Array;
    /** Cell offsets, 3 per pair. */
    S: Int32Array;
    /** Distances. */
    d: Float64Array;
    /** Vectors r[j] - r[i] + S @ cell, 3 per pair. */
    D: Float64Array;
}
type CharsOf<Q extends string> = Q extends `${infer C}${infer R}` ? C | CharsOf<R> : never;
/** The arrays named in a quantities string: `NeighborResult<"ijd">` has i, j and d. */
export type NeighborResult<Q extends string> = {
    [K in NeighborKey as K extends CharsOf<Q> ? K : never]: NeighborArrays[K];
};
/** Formats compiled into the loaded module, e.g. ["vasp", "xyz", "extxyz"]. */
export declare function formats(): string[];
/** Whether `format` can be written. */
export declare function canWrite(format: string): boolean;
/** Whether the neighbour-list function is compiled into the module. */
export declare function hasNeighbors(): boolean;
/** Options of `readAll`: `read` without the frame index. */
export interface ReadAllOptions {
    format?: string;
    filename?: string;
    [option: string]: unknown;
}
/**
 * The frame at `index` (default -1, the last frame, as in ASE). The format is
 * taken from `format`, else guessed from `filename`, else from the text.
 * Same as `io.read` for text input.
 */
export declare function read(text: string, options?: ReadOptions): Atoms;
/** Every frame in `text`, in file order. Same format rules as `read`. */
export declare function readAll(text: string, options?: ReadAllOptions): Atoms[];
/** Serialise `atoms` in `options.format`. Returns the file contents. Same as `io.write`. */
export declare function write(atoms: Atoms, options: WriteOptions): string;
/**
 * Neighbour pairs with ASE semantics (see the C++ header): sorted by (i, j, S),
 * no self pair at S = 0, periodic images included.
 *
 * `quantities` picks the arrays to return, letters from "ijSdD"; the result
 * holds only those keys.
 *
 * @example
 *   const { i, j, d } = neighborList("ijd", atoms, 3.0);
 */
export declare function neighborList<Q extends string>(quantities: Q, atoms: Atoms, cutoff: number, options?: NeighborOptions): NeighborResult<Q>;
