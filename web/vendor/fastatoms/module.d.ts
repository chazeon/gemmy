import type { EmscriptenFactory, RawModule } from "./raw.js";
/**
 * Load the WebAssembly module. Idempotent: the module is fetched and
 * instantiated once, and later calls reuse it (a `glue` passed to a later call
 * is ignored). Every other function in this package needs `init()` to have
 * resolved first.
 *
 * @param glue The emscripten glue factory, the default export of
 *   `fastatoms/wasm/fastatoms.mjs`. Pass it when bundling, where the
 *   dynamic import of the glue next to this file would not resolve.
 *   Without it, the glue is loaded from `dist/wasm/` at run time.
 */
export declare function init(glue?: EmscriptenFactory): Promise<void>;
/** The loaded module. Throws if `init()` has not resolved yet. */
export declare function requireModule(): RawModule;
/**
 * Run one native call and raise the C++ error it recorded, if any. The wasm
 * side never throws into JS (a throw from a C++ catch block corrupts the
 * module), so the error is taken here, after the call has returned. On error
 * `discard` releases the placeholder handle the call returned, and the call
 * throws the message as an Error.
 */
export declare function native<T>(call: () => T, discard?: (value: T) => void): T;
