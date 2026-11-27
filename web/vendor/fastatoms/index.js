// SPDX-License-Identifier: MIT
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
import { init, native, requireModule } from "./module.js";
export { init, Atoms, io };
export * as symmetry from "./symmetry.js";
const KNOWN_QUANTITIES = new Set(["i", "j", "S", "d", "D"]);
/** Formats compiled into the loaded module, e.g. ["vasp", "xyz", "extxyz"]. */
export function formats() {
    return requireModule().availableFormats();
}
/** Whether `format` can be written. */
export function canWrite(format) {
    return requireModule().canWrite(format);
}
/** Whether the neighbour-list function is compiled into the module. */
export function hasNeighbors() {
    return typeof requireModule().neighborList === "function";
}
/**
 * The frame at `index` (default -1, the last frame, as in ASE). The format is
 * taken from `format`, else guessed from `filename`, else from the text.
 * Same as `io.read` for text input.
 */
export function read(text, options = {}) {
    return io.read(text, options);
}
/** Every frame in `text`, in file order. Same format rules as `read`. */
export function readAll(text, options = {}) {
    return io.read(text, { ...options, index: ":" });
}
/** Serialise `atoms` in `options.format`. Returns the file contents. Same as `io.write`. */
export function write(atoms, options) {
    return io.write(atoms, options);
}
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
export function neighborList(quantities, atoms, cutoff, options = {}) {
    const module = requireModule();
    if (typeof module.neighborList !== "function") {
        throw new Error("neighborList is not compiled into this build (FASTATOMS_WITH_NEIGHBORS=OFF)");
    }
    if (quantities.length === 0) {
        throw new Error("neighborList: give at least one quantity from i, j, S, d, D");
    }
    for (const letter of quantities) {
        if (!KNOWN_QUANTITIES.has(letter)) {
            throw new Error(`neighborList: unknown quantity '${letter}' (use letters from i, j, S, d, D)`);
        }
    }
    const handle = atoms.rawHandle();
    const full = options.full ?? true;
    return native(() => module.neighborList?.(handle, cutoff, full, quantities));
}
