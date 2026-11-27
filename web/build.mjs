// Builds the viewer from web/ into src/gemmy/viewer (or into the directory given as the argument, which the freshness
// check in scripts/check.sh uses). Dev only: the wheel ships the built files, nothing from web/. Two bundles, one loop:
// viewer.js (the page's script; three.js is external, the importmap points it at the pinned CDN build) and compile.js
// (the structure compiler, a separate script that only pages with a gemmy-compiler meta load). Neither is inlined into
// a page. The page itself is copied with a generated-file comment.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, "..", "src", "gemmy", "viewer"));
const GENERATED = "generated from web/ by npm run build; do not edit";

const shared = {
  bundle: true,
  format: "esm",
  target: "es2022",
  // A worktree may symlink web/node_modules to the main checkout's (scripts/worktree-setup.sh). Without this the
  // module comments name the real path, and the freshness check in scripts/check.sh fails.
  preserveSymlinks: true,
  minify: true,
  // React picks its production build by this flag; without it the bundle carries React's development build.
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  banner: { js: `/* ${GENERATED} */` },
  logLevel: "warning",
};
// fastatoms's glue imports node:module only in its Node branch (a process with versions.node), which a browser never
// takes. The compiler has no externals, so that import resolves to this stub: calling it would throw.
const nodeModuleStub = {
  name: "node-module-stub",
  setup(build) {
    build.onResolve({ filter: /^node:module$/ }, () => ({ path: "node:module", namespace: "stub" }));
    build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents: "export function createRequire() { throw new Error('node:module is not available in the browser'); }",
      loader: "js",
    }));
  },
};
const bundles = [
  {
    entryPoints: [path.join(here, "src", "main.ts")],
    outfile: path.join(out, "viewer.js"),
    jsx: "automatic", // React's JSX runtime is imported by the compiler; no React import in each file
    external: ["three", "three/*"], // the importmap in page.html points them at the pinned CDN build
  },
  // The compiler: React and three.js are not in it, and nothing is external, so it runs on its own.
  {
    entryPoints: [path.join(here, "src", "compiler", "entry.ts")],
    outfile: path.join(out, "compile.js"),
    plugins: [nodeModuleStub],
    // fastatoms's wasm glue carries a binary string; esbuild's default (ascii) escapes it, about 190 KB more raw.
    charset: "utf8",
  },
];

await mkdir(out, { recursive: true });
for (const bundle of bundles) await build({ ...shared, ...bundle });

// The stylesheet: the Tailwind utilities for the React overlay (tailwind.css, compiled by the Tailwind CLI), then the
// page's own style.css. The layers are declared first, so the page's rules (the `legacy` layer) sit under the utilities.
const utilities = execFileSync(
  path.join(here, "node_modules", ".bin", "tailwindcss"),
  ["-i", path.join(here, "tailwind.css")],
  {
    cwd: here,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  },
);
const css = await readFile(path.join(here, "style.css"), "utf8");
const layers = "@layer theme, base, legacy, components, utilities;";
await writeFile(
  path.join(out, "style.css"),
  `/* ${GENERATED} */\n${layers}\n${utilities}\n@layer legacy {\n${css}\n}\n`,
);

// The page keeps its markers (/*__STYLE__*/ and //__SCRIPT__) for gemmy.view to fill; the comment goes after the doctype.
// The favicon (assets/favicon.svg, its colours following the system's light or dark) goes into the page as a data URL, so
// a single-file page carries it too.
const favicon = await readFile(path.join(here, "assets", "favicon.svg"));
const page = (await readFile(path.join(here, "page.html"), "utf8")).replace(
  "__FAVICON__",
  `data:image/svg+xml;base64,${favicon.toString("base64")}`,
);
const cut = page.indexOf("\n") + 1;
await writeFile(path.join(out, "page.html"), `${page.slice(0, cut)}<!-- ${GENERATED} -->\n${page.slice(cut)}`);
