/**
 * Shapes of the embind module built from bindings/wasm/bindings.cpp.
 * Internal: the public API lives in index.ts and atoms.ts.
 */
export type NeighborKey = "i" | "j" | "S" | "d" | "D";
export interface RawArrayInfo {
    readonly name: string;
    readonly kind: "float" | "int" | "string";
    readonly ncols: number;
}
export interface RawAtoms {
    readonly length: number;
    getNumbers(): Int32Array;
    getPositions(): Float64Array;
    setPositions(positions: ArrayLike<number>): void;
    getCell(): Float64Array;
    setCell(cell: ArrayLike<number>, scaleAtoms: boolean): void;
    getPbc(): boolean[];
    setPbc(pbc: ArrayLike<boolean>): void;
    getScaledPositions(wrap: boolean): Float64Array;
    getSymbols(): string[];
    getLabels(): string[];
    getArray(name: string): Float64Array | string[];
    arrayNames(): RawArrayInfo[];
    getInfoJSON(): string;
    repeat(nx: number, ny: number, nz: number): RawAtoms;
    subset(indices: ArrayLike<number>): RawAtoms;
    wrap(): void;
    copy(): RawAtoms;
    volume(): number;
    delete(): void;
    isDeleted(): boolean;
}
export interface RawModule {
    readAll(text: string, format: string, optionsJSON: string): RawAtoms[];
    read(text: string, format: string, optionsJSON: string): RawAtoms;
    write(atoms: RawAtoms, format: string, optionsJSON: string): string;
    guessFormat(filename: string, head: string): string;
    availableFormats(): string[];
    canWrite(format: string): boolean;
    /** Whether `format` holds more than one frame (xyz, extxyz, cif). */
    canWriteFrames(format: string): boolean;
    /** Several frames as one text (multi-frame formats only). */
    writeAll(frames: RawAtoms[], format: string, optionsJSON: string): string;
    /** The message of the last failed native call, "" when none. Clears it. */
    takeError(): string;
    fromArrays(numbersOrSymbols: ArrayLike<number> | ArrayLike<string>, positions: ArrayLike<number>, cell: ArrayLike<number> | null, pbc: ArrayLike<boolean> | null): RawAtoms;
    /** Only present when the neighbour feature is compiled in. */
    neighborList?: (atoms: RawAtoms, cutoff: number, full: boolean, quantities: string) => Partial<Record<NeighborKey, ArrayLike<number>>>;
    /** Always bound; true only when built with FASTATOMS_WITH_SYMMETRY. */
    hasSymmetry(): boolean;
    /** Only present when the symmetry feature is compiled in. */
    getSymmetryDataset?: (atoms: RawAtoms, symprec: number, angleTolerance: number, useLabels: boolean) => RawSymmetryDataset;
    standardizeCell?: (atoms: RawAtoms, toPrimitive: boolean, noIdealize: boolean, symprec: number, angleTolerance: number, useLabels: boolean) => RawAtoms;
    findPrimitive?: (atoms: RawAtoms, symprec: number, angleTolerance: number, useLabels: boolean) => RawAtoms;
    niggliReduce?: (atoms: RawAtoms, symprec: number) => RawAtoms;
}
/** Raw symmetry dataset as embind returns it (camelCase fields). */
export interface RawSymmetryDataset {
    number: number;
    international: string;
    hall: string;
    hallNumber: number;
    choice: string;
    pointgroup: string;
    rotations: Int32Array;
    translations: Float64Array;
    wyckoffs: string[];
    siteSymmetrySymbols: string[];
    equivalentAtoms: Int32Array;
    crystallographicOrbits: Int32Array;
    stdLattice: Float64Array;
    stdTypes: Int32Array;
    stdPositions: Float64Array;
    transformationMatrix: Float64Array;
    originShift: Float64Array;
    primitiveLattice: Float64Array;
    mappingToPrimitive: Int32Array;
    stdMappingToPrimitive: Int32Array;
}
/** Default export of the emscripten ES6 glue (`-sMODULARIZE=1`). */
export type EmscriptenFactory = () => Promise<RawModule>;
