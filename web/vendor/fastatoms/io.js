// SPDX-License-Identifier: MIT
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
import { Atoms, discardRaw } from "./atoms.js";
import { native, requireModule } from "./module.js";
const SLICE_FIELD = /^[+-]?\d+$/;
// ---------------------------------------------------------------------------
// Input decoding
// ---------------------------------------------------------------------------
/**
 * Duck typing, not `instanceof Blob`: a Blob or File made in another window,
 * worker or realm fails `instanceof` but has the same methods.
 */
function isBlob(input) {
    if (typeof input !== "object" || input === null) {
        return false;
    }
    const candidate = input;
    return typeof candidate.arrayBuffer === "function" && typeof candidate.size === "number";
}
function isGzip(bytes) {
    return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}
function stripBom(text) {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}
/** UTF-8 decode. TextDecoder drops a leading BOM by default. */
function decodeUtf8(bytes) {
    return new TextDecoder("utf-8").decode(bytes);
}
function toBytes(input) {
    return input instanceof Uint8Array ? input : new Uint8Array(input);
}
async function gunzip(bytes) {
    if (typeof DecompressionStream === "undefined") {
        throw new Error("gzip input needs DecompressionStream (Node 18+ or a current browser)");
    }
    const compressed = new Blob([bytes]).stream();
    const inflated = compressed.pipeThrough(new DecompressionStream("gzip"));
    return new Uint8Array(await new Response(inflated).arrayBuffer());
}
// ---------------------------------------------------------------------------
// Format guessing
// ---------------------------------------------------------------------------
/** The filename without a trailing ".gz", for the format guess. */
function baseName(filename) {
    return filename?.replace(/\.gz$/i, "");
}
/**
 * The core picks the format from the name and the content head together, and
 * a strong content signature (a LAMMPS dump magic line in traj.xyz) wins over
 * the extension. This layer only passes both on.
 */
function guessOrFail(filename, head, label) {
    const mod = requireModule();
    const name = baseName(filename) ?? "";
    const guessed = native(() => mod.guessFormat(name, head));
    if (guessed === "") {
        throw new Error(`cannot determine the structure format of ${label}: pass { format }, or a { filename } with a known extension`);
    }
    return guessed;
}
/** Head of the text the format guess sees: enough for every content signature. */
const GUESS_HEAD_CHARS = 4096;
function resolveFormat(format, filename, text, label) {
    if (format !== undefined && format !== "") {
        return format;
    }
    return guessOrFail(filename, text.slice(0, GUESS_HEAD_CHARS), label);
}
// ---------------------------------------------------------------------------
// Index handling
// ---------------------------------------------------------------------------
/** Python slice semantics over `n` frames: the frame positions it selects. */
function sliceIndices(n, start, stop, step) {
    let from;
    let to;
    if (step > 0) {
        from = start === undefined ? 0 : start < 0 ? Math.max(start + n, 0) : Math.min(start, n);
        to = stop === undefined ? n : stop < 0 ? Math.max(stop + n, 0) : Math.min(stop, n);
    }
    else {
        from = start === undefined ? n - 1 : start < 0 ? Math.max(start + n, -1) : Math.min(start, n - 1);
        to = stop === undefined ? -1 : stop < 0 ? Math.max(stop + n, -1) : Math.min(stop, n - 1);
    }
    const out = [];
    for (let i = from; step > 0 ? i < to : i > to; i += step) {
        out.push(i);
    }
    return out;
}
/** One slice field: empty (undefined), or an optional sign and digits. */
function parseSliceField(field, spec) {
    const trimmed = (field ?? "").trim();
    if (trimmed === "") {
        return undefined;
    }
    if (!SLICE_FIELD.test(trimmed)) {
        throw new Error(`invalid index slice "${spec}"`);
    }
    return Number.parseInt(trimmed, 10);
}
/** A slice string, validated in full before any frame is built. */
function parseSlice(spec) {
    const parts = spec.split(":");
    if (parts.length > 3) {
        throw new Error(`invalid index slice "${spec}"`);
    }
    const start = parseSliceField(parts[0], spec);
    const stop = parseSliceField(parts[1], spec);
    const step = parseSliceField(parts[2], spec) ?? 1;
    if (step === 0) {
        throw new Error(`index slice "${spec}": step cannot be zero`);
    }
    return { start, stop, step };
}
/** A frame number, or "slice". `null` and `undefined` both mean the last frame. */
function parseIndex(index) {
    if (index === undefined || index === null) {
        return -1;
    }
    if (typeof index === "number") {
        if (!Number.isInteger(index)) {
            throw new Error(`index must be an integer or a slice string, got ${index}`);
        }
        return index;
    }
    if (index.includes(":")) {
        return "slice";
    }
    if (!/^\s*[+-]?\d+\s*$/.test(index)) {
        throw new Error(`invalid index "${index}": use an integer or a slice such as ":", "::2", "-3:"`);
    }
    return Number.parseInt(index, 10);
}
// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------
function readText(text, filename, options) {
    const formatOptions = { ...options };
    delete formatOptions.format;
    delete formatOptions.filename;
    delete formatOptions.index;
    const label = filename === undefined ? "the input" : `"${filename}"`;
    const resolved = resolveFormat(options.format, baseName(filename), text, label);
    const mod = requireModule();
    const frameIndex = parseIndex(options.index);
    const json = (extra) => JSON.stringify({ ...formatOptions, ...extra });
    if (frameIndex !== "slice") {
        return new Atoms(native(() => mod.read(text, resolved, json({ index: frameIndex })), discardRaw));
    }
    // Validate the whole slice first, so a malformed one builds no frames.
    const { start, stop, step } = parseSlice(options.index);
    const raws = native(() => mod.readAll(text, resolved, json({})));
    const frames = raws.map((raw) => new Atoms(raw));
    const order = sliceIndices(frames.length, start, stop, step);
    const keep = new Set(order);
    const chosen = new Map();
    frames.forEach((frame, k) => {
        if (keep.has(k)) {
            chosen.set(k, frame);
        }
        else {
            frame.dispose();
        }
    });
    // Slice order, which may be reversed or strided; not file order.
    return order.map((k) => chosen.get(k));
}
async function readBlob(blob, options) {
    const filename = options.filename ?? blob.name;
    let bytes = new Uint8Array(await blob.arrayBuffer());
    if (isGzip(bytes)) {
        bytes = await gunzip(bytes);
    }
    return readText(decodeUtf8(bytes), filename, options);
}
export function read(input, options = {}) {
    if (isBlob(input)) {
        return readBlob(input, options);
    }
    if (typeof input === "string") {
        return readText(stripBom(input), options.filename, options);
    }
    const bytes = toBytes(input);
    if (isGzip(bytes)) {
        throw new Error("gzip data needs the async path: pass a Blob or File to io.read");
    }
    return readText(decodeUtf8(bytes), options.filename, options);
}
/**
 * Serialise one structure, or a list of them, and return the text. A list
 * needs a format that holds several frames (xyz, extxyz, cif). The format
 * comes from `format`, else from `filename`.
 *
 * @throws if no format can be found, if a list is given for a single-frame
 *   format (as ASE does), or if the list is empty.
 */
export function write(atoms, options = {}) {
    const { format: given, filename, ...formatOptions } = options;
    if (filename !== undefined && /\.gz$/i.test(filename)) {
        throw new Error(`write: "${filename}" is gzipped; write returns text, so compress the output yourself`);
    }
    let format = given ?? "";
    if (format === "") {
        if (filename === undefined || filename === "") {
            throw new Error("write: { format } is required (or a { filename } with a known extension)");
        }
        format = guessOrFail(filename, "", `"${filename}"`);
    }
    const mod = requireModule();
    const json = JSON.stringify(formatOptions);
    if (atoms instanceof Atoms) {
        const handle = atoms.rawHandle();
        return native(() => mod.write(handle, format, json));
    }
    if (!mod.canWriteFrames(format)) {
        throw new Error(`write: format "${format}" holds one structure; pass a single Atoms (multi-frame formats: xyz, extxyz, cif)`);
    }
    if (atoms.length === 0) {
        throw new Error("write: the list of structures is empty");
    }
    const handles = atoms.map((frame) => frame.rawHandle());
    return native(() => mod.writeAll(handles, format, json));
}
