// The two placeholders gemmy.view fills in (one pass over the built page) before the page runs. Their text is
// replaced with JSON, so the code that reads them is typed as if they were the values.
declare const __CONSTANTS_JSON__: import("./types").Constants;
declare const __AXIS_FONTS_JSON__: Record<string, string>; // CSS weight -> base64 TTF

// The compiler bundle (compiler/entry.ts) registers itself under this global once its script runs; scene/compiler.ts
// reads it. The type is declared here only, so the two sides cannot disagree.
declare var __gemmyCompiler: import("./compiler/entry").CompilerApi | undefined;
