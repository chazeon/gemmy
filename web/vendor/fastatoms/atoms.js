// SPDX-License-Identifier: MIT
import { native, requireModule } from "./module.js";
/**
 * Registry that frees the embind handle of an Atoms object that was garbage
 * collected without `dispose()`. Held values are raw handles, never the
 * wrapper itself, so registration does not keep the wrapper alive.
 */
const registry = new FinalizationRegistry((raw) => {
    if (!raw.isDeleted()) {
        raw.delete();
    }
});
/** Releases a handle that a failed call returned, so it is not left to the GC. */
export function discardRaw(raw) {
    raw.delete();
}
function flattenCell(cell) {
    const out = [];
    const entries = cell;
    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        if (typeof entry === "number") {
            out.push(entry);
        }
        else if (entry !== undefined) {
            for (let k = 0; k < entry.length; k++) {
                out.push(entry[k] ?? NaN);
            }
        }
    }
    return out;
}
function pbcFlags(pbc) {
    if (pbc === undefined) {
        return [false, false, false];
    }
    if (typeof pbc === "boolean") {
        return [pbc, pbc, pbc];
    }
    return [pbc[0], pbc[1], pbc[2]];
}
/**
 * A structure: species, positions, optional periodic cell and per-atom
 * arrays. ASE-flavoured. Typed arrays returned by getters are copies, so
 * they stay valid after further calls and after memory growth.
 *
 * Call `dispose()` when done to free the wasm-side memory right away. If you
 * do not, a FinalizationRegistry frees it when the object is collected.
 */
export class Atoms {
    #raw;
    #token = {};
    /**
     * Wrap an embind handle. Internal: use `read`, `readAll`, `Atoms.fromArrays`.
     * @internal
     */
    constructor(raw) {
        this.#raw = raw;
        registry.register(this, raw, this.#token);
    }
    /** @internal The embind handle, for functions that take raw atoms. */
    rawHandle() {
        if (this.#raw === null) {
            throw new Error("Atoms has been disposed");
        }
        return this.#raw;
    }
    /** True once `dispose()` has been called. */
    get disposed() {
        return this.#raw === null;
    }
    /** Free the wasm-side memory now. Calling it again does nothing. */
    dispose() {
        const raw = this.#raw;
        if (raw === null) {
            return;
        }
        this.#raw = null;
        registry.unregister(this.#token);
        if (!raw.isDeleted()) {
            raw.delete();
        }
    }
    /** Number of atoms. */
    get length() {
        return this.rawHandle().length;
    }
    /** Lattice vectors as a row-major 3x3 matrix (rows are lattice vectors). */
    get cell() {
        return this.rawHandle().getCell();
    }
    /** Periodicity along a, b, c. */
    get pbc() {
        const flags = this.rawHandle().getPbc();
        return [flags[0] ?? false, flags[1] ?? false, flags[2] ?? false];
    }
    /** Names of the per-atom arrays, including "labels" when present. */
    get arrays() {
        return this.arrayInfo().map((info) => info.name);
    }
    /**
     * Frame information, parsed from JSON. Each access parses a fresh copy, so
     * mutating the result does not change the atoms.
     */
    get info() {
        const parsed = JSON.parse(this.rawHandle().getInfoJSON());
        return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    }
    /** Cartesian positions, flat 3N copy. */
    getPositions() {
        return this.rawHandle().getPositions();
    }
    /**
     * Replace all positions (flat 3N).
     *
     * Caller-controlled array-likes are copied before the handle is taken: a
     * getter on the input may run arbitrary code, `dispose()` included.
     */
    setPositions(positions) {
        const data = Float64Array.from(positions);
        const raw = this.rawHandle();
        native(() => raw.setPositions(data));
    }
    /** Set the lattice; with `scaleAtoms` the fractional coordinates are kept. */
    setCell(cell, scaleAtoms = false) {
        const data = Float64Array.from(flattenCell(cell));
        const keep = Boolean(scaleAtoms);
        const raw = this.rawHandle();
        native(() => raw.setCell(data, keep));
    }
    /** Set periodicity: one flag for all axes, or one per axis. */
    setPbc(pbc) {
        const flags = pbcFlags(pbc);
        const raw = this.rawHandle();
        native(() => raw.setPbc(flags));
    }
    /** Fractional coordinates, flat 3N copy. `wrap` folds them into [0, 1). */
    getScaledPositions(options = {}) {
        const wrap = Boolean(options.wrap);
        const raw = this.rawHandle();
        return native(() => raw.getScaledPositions(wrap));
    }
    /** Element symbol of every atom ("H" for the label "H1"). */
    getChemicalSymbols() {
        return this.rawHandle().getSymbols();
    }
    /** Atomic number of every atom. */
    getAtomicNumbers() {
        return this.rawHandle().getNumbers();
    }
    /**
     * Species label per atom as the file wrote it ("Fe1", "Fe_pv", "O2-").
     * Falls back to the symbols when the structure has no labels.
     */
    getLabels() {
        return this.rawHandle().getLabels();
    }
    /**
     * A named per-atom array. Double and integer arrays come back as Float64Array
     * (flat, `ncols` values per atom); string arrays as string[].
     * @throws if there is no array with that name.
     */
    getArray(name) {
        const raw = this.rawHandle();
        return native(() => raw.getArray(name));
    }
    /** Name, kind and column count of every per-atom array. */
    arrayInfo() {
        return this.rawHandle()
            .arrayNames()
            .map((info) => ({
            name: info.name,
            kind: info.kind,
            ncols: info.ncols,
        }));
    }
    /**
     * Supercell with `n` repeats per axis (or `[nx, ny, nz]`). Atoms are ordered
     * as ASE orders them: the atom index varies fastest, so the label of
     * repeated atom k is the label of atom `k % N`.
     */
    repeat(n) {
        const [nx, ny, nz] = typeof n === "number" ? [n, n, n] : n;
        const raw = this.rawHandle();
        return new Atoms(native(() => raw.repeat(nx, ny, nz), discardRaw));
    }
    /** New atoms holding only `indices`, in the given order. */
    subset(indices) {
        const data = Float64Array.from(indices);
        const raw = this.rawHandle();
        return new Atoms(native(() => raw.subset(data), discardRaw));
    }
    /** Fold every atom into the cell along the periodic axes (in place). */
    wrap() {
        const raw = this.rawHandle();
        native(() => raw.wrap());
    }
    /** An independent copy. */
    copy() {
        const raw = this.rawHandle();
        return new Atoms(native(() => raw.copy(), discardRaw));
    }
    /** Cell volume in cubic angstrom (0 for a zero cell). */
    getVolume() {
        return this.rawHandle().volume();
    }
    /**
     * Build atoms from plain arrays. Give `symbols` or `numbers`; the labels
     * default to the symbols.
     */
    static fromArrays(spec) {
        const hasSymbols = spec.symbols !== undefined;
        const hasNumbers = spec.numbers !== undefined;
        if (hasSymbols === hasNumbers) {
            throw new Error("Atoms.fromArrays: give exactly one of `symbols` or `numbers`");
        }
        // Copy every input before the native call (see setPositions).
        const species = spec.symbols !== undefined ? Array.from(spec.symbols) : Array.from(spec.numbers);
        const positions = Float64Array.from(spec.positions);
        const cell = spec.cell === undefined || spec.cell === null ? null : Float64Array.from(flattenCell(spec.cell));
        const pbc = pbcFlags(spec.pbc);
        const mod = requireModule();
        return new Atoms(native(() => mod.fromArrays(species, positions, cell, pbc), discardRaw));
    }
}
