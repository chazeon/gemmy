// The two placeholders gemmy.view fills in (one pass over the built page) before the page runs. Their text is
// replaced with JSON, so the code that reads them is typed as if they were the values.
declare const __CONSTANTS_JSON__: import("./types").Constants;
declare const __AXIS_FONTS_JSON__: Record<string, string>; // CSS weight -> base64 TTF
