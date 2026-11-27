// SPDX-License-Identifier: MIT
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
import { Atoms, discardRaw } from "./atoms.js";
import { native, requireModule } from "./module.js";
/** The module, narrowed to the symmetry functions. Throws when they are not built in. */
function requireSymmetry() {
    const mod = requireModule();
    if (typeof mod.getSymmetryDataset !== "function" ||
        typeof mod.standardizeCell !== "function" ||
        typeof mod.findPrimitive !== "function" ||
        typeof mod.niggliReduce !== "function") {
        throw new Error("symmetry is not compiled into this build (FASTATOMS_WITH_SYMMETRY=OFF): rebuild with --full");
    }
    return mod;
}
/** Whether this build has symmetry (spglib). False for `--minimal` and `--gemmy`. */
export function hasSymmetry() {
    return requireModule().hasSymmetry();
}
/** The spglib dataset of `atoms`. @throws if the cell is not periodic or has no symmetry. */
export function getSymmetryDataset(atoms, options = {}) {
    const mod = requireSymmetry();
    const handle = atoms.rawHandle();
    const raw = native(() => mod.getSymmetryDataset(handle, options.symprec ?? 1e-5, options.angleTolerance ?? -1, options.useLabels ?? false));
    return raw;
}
/** spglib's standardised cell (conventional by default, primitive with `toPrimitive`). */
export function standardizeCell(atoms, options = {}) {
    const mod = requireSymmetry();
    const handle = atoms.rawHandle();
    return new Atoms(native(() => mod.standardizeCell(handle, options.toPrimitive ?? false, options.noIdealize ?? false, options.symprec ?? 1e-5, options.angleTolerance ?? -1, options.useLabels ?? false), discardRaw));
}
/** The primitive cell, idealised. */
export function findPrimitive(atoms, options = {}) {
    const mod = requireSymmetry();
    const handle = atoms.rawHandle();
    return new Atoms(native(() => mod.findPrimitive(handle, options.symprec ?? 1e-5, options.angleTolerance ?? -1, options.useLabels ?? false), discardRaw));
}
/** The Niggli-reduced cell of the same lattice. Positions stay Cartesian. */
export function niggliReduce(atoms, options = {}) {
    const mod = requireSymmetry();
    const handle = atoms.rawHandle();
    return new Atoms(native(() => mod.niggliReduce(handle, options.symprec ?? 1e-5), discardRaw));
}
