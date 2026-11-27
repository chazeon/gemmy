// SPDX-License-Identifier: MIT
/**
 * Types of the emscripten glue (wasm/fastatoms.mjs, built with MODULARIZE).
 * Copied next to the glue by scripts/build-wasm.sh; not compiled by tsc.
 */
import type { RawModule } from "../raw.js";

/** Create the module. Pass it to `init()` when bundling. */
export default function createFastAtoms(moduleArg?: Record<string, unknown>): Promise<RawModule>;
