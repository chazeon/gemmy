let loading;
let loaded;
async function load(glue) {
    if (glue !== undefined) {
        return glue();
    }
    // The glue sits next to this file in dist/wasm/ (see scripts/build-wasm.sh).
    // A computed specifier keeps tsc from looking for it at build time.
    const glueUrl = new URL("./wasm/fastatoms.mjs", import.meta.url).href;
    const imported = (await import(glueUrl));
    return imported.default();
}
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
export function init(glue) {
    if (loaded !== undefined) {
        return Promise.resolve();
    }
    loading ??= load(glue).then((mod) => {
        loaded = mod;
        return mod;
    }, (error) => {
        loading = undefined; // allow a retry after a failed load
        throw error;
    });
    return loading.then(() => undefined);
}
/** The loaded module. Throws if `init()` has not resolved yet. */
export function requireModule() {
    if (loaded === undefined) {
        throw new Error("fastatoms is not initialised: await init() before using it");
    }
    return loaded;
}
/**
 * Run one native call and raise the C++ error it recorded, if any. The wasm
 * side never throws into JS (a throw from a C++ catch block corrupts the
 * module), so the error is taken here, after the call has returned. On error
 * `discard` releases the placeholder handle the call returned, and the call
 * throws the message as an Error.
 */
export function native(call, discard) {
    const result = call();
    const message = requireModule().takeError();
    if (message !== "") {
        discard?.(result);
        throw new Error(message);
    }
    return result;
}
