/**
 * ASE-style structure IO: `io.read` and `io.write`.
 *
 *   import { io } from "fastatoms";
 *   const atoms = io.read(text, { format: "vasp" });        // Atoms
 *   const frames = io.read(text, { filename: "traj.xyz", index: ":" });
 *   const file = await io.read(new File([bytes], "POSCAR.gz")); // Promise<Atoms>
 *   const out = io.write(atoms, { filename: "CONTCAR" });       // string
 *
 * Input types for `read`: a string, an ArrayBuffer or Uint8Array (decoded as
 * UTF-8, BOM stripped), or a Blob/File. A Blob is read asynchronously, so for
 * a Blob or File `read` returns a Promise; every other input gives the result
 * at once. Gzipped bytes (magic 1f 8b) are inflated with DecompressionStream,
 * which needs the async path, so they are an error for the synchronous inputs.
 */
import { Atoms } from "./atoms.js";
/** What `read` accepts as text-bearing input. */
export type TextInput = string | ArrayBuffer | Uint8Array;
/** Every input `read` accepts. A Blob (or File) makes the call async. */
export type IOInput = TextInput | Blob;
/**
 * Options of `read` and `write`. `format` and `filename` steer the format
 * guess; `index` selects frames (read only); anything else goes to the
 * format-specific reader or writer, as in `read(text, { format: "vasp",
 * species: ["Fe", "O"] })`.
 */
export interface IOOptions {
    /** Format name ("vasp", "xyz", "extxyz", "cif", "lammps-data", "lammps-dump"). */
    format?: string;
    /**
     * File name. Used to guess the format and named in error messages. A File
     * supplies its own `name` when this is omitted.
     */
    filename?: string;
    /**
     * Frames to read, as in ASE. `undefined` or `null` (default): the last frame.
     * An integer or an integer string: that one frame, negatives count from the
     * end. A slice string (":", "::2", "-3:", "1:5"): an array of frames.
     */
    index?: number | string | null;
    [option: string]: unknown;
}
/** Options for a read that returns one frame: no slice index. */
export type SingleFrameOptions = IOOptions & {
    index?: number | null;
};
/** The type `read` returns for the `index` option `I`. */
export type IndexResult<I> = [I] extends [undefined | null] ? Atoms : [I] extends [number] ? Atoms : string extends I ? Atoms | Atoms[] : I extends `${string}:${string}` ? Atoms[] : Atoms;
/** The `index` type of an options object `O`; `undefined` when not given. */
type IndexOf<O> = "index" extends keyof O ? O["index"] : undefined;
/**
 * Read structures from text or bytes. Returns one `Atoms` when `index` is
 * left out, `null`, or an integer (or integer string); an `Atoms[]` for a
 * slice string. A Blob or File gives a Promise of the same.
 *
 * @example
 *   io.read(text, { format: "extxyz" });               // last frame
 *   io.read(text, { format: "extxyz", index: ":" });   // all frames
 *   await io.read(file, { index: -2 });                // from a File, gzip ok
 */
export declare function read(input: TextInput, options?: SingleFrameOptions): Atoms;
export declare function read(input: Blob, options?: SingleFrameOptions): Promise<Atoms>;
export declare function read<const O extends IOOptions>(input: TextInput, options: O): IndexResult<IndexOf<O>>;
export declare function read<const O extends IOOptions>(input: Blob, options: O): Promise<IndexResult<IndexOf<O>>>;
export interface WriteOptions {
    /** Output format. Guessed from `filename` when omitted. */
    format?: string;
    /** Used only to guess the format. A ".gz" name is refused: write returns text. */
    filename?: string;
    /** Format-specific options, e.g. `{ labels: false }` for POSCAR. */
    [option: string]: unknown;
}
/**
 * Serialise one structure, or a list of them, and return the text. A list
 * needs a format that holds several frames (xyz, extxyz, cif). The format
 * comes from `format`, else from `filename`.
 *
 * @throws if no format can be found, if a list is given for a single-frame
 *   format (as ASE does), or if the list is empty.
 */
export declare function write(atoms: Atoms | readonly Atoms[], options?: WriteOptions): string;
export {};
