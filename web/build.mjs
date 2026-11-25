// Builds the viewer from web/ into src/gemmy/viewer (or into the directory given as the argument, which the
// freshness check in scripts/check.sh uses). Dev only: the wheel ships the three built files, nothing from web/.
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(process.argv[2] ?? path.join(here, "..", "src", "gemmy", "viewer"));
const GENERATED = "generated from web/ by npm run build; do not edit";

await mkdir(out, { recursive: true });
await build({
  entryPoints: [path.join(here, "src", "main.ts")],
  bundle: true,
  format: "esm",
  target: "es2022",
  outfile: path.join(out, "viewer.js"),
  // A worktree may symlink web/node_modules to the main checkout's (scripts/worktree-setup.sh). Without this the
  // module comments name the real path, and the freshness check in scripts/check.sh fails.
  preserveSymlinks: true,
  jsx: "automatic", // React's JSX runtime is imported by the compiler; no React import in each file
  external: ["three", "three/*"], // the importmap in page.html points them at the pinned CDN build
  minify: true, // React is bundled into this one script: minified, it is the page's size
  // React picks its production build by this flag; without it the bundle carries React's development build.
  define: { "process.env.NODE_ENV": '"production"' },
  legalComments: "none",
  banner: { js: `/* ${GENERATED} */` },
  logLevel: "warning",
});

// The page keeps its markers (/*__STYLE__*/ and //__SCRIPT__) for gemmy.view to fill; the comment goes after the doctype.
const page = await readFile(path.join(here, "page.html"), "utf8");
const cut = page.indexOf("\n") + 1;
await writeFile(path.join(out, "page.html"), `${page.slice(0, cut)}<!-- ${GENERATED} -->\n${page.slice(cut)}`);
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
