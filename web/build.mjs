// Builds the viewer from web/ into src/gemmy/viewer (or into the directory given as the argument, which the
// freshness check in scripts/check.sh uses). Dev only: the wheel ships the three built files, nothing from web/.
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
  external: ["three", "three/*"], // the importmap in page.html points them at the pinned CDN build
  minify: false,
  legalComments: "none",
  banner: { js: `/* ${GENERATED} */` },
  logLevel: "warning",
});

// The page keeps its markers (/*__STYLE__*/ and //__SCRIPT__) for gemmy.view to fill; the comment goes after the doctype.
const page = await readFile(path.join(here, "page.html"), "utf8");
const cut = page.indexOf("\n") + 1;
await writeFile(path.join(out, "page.html"), `${page.slice(0, cut)}<!-- ${GENERATED} -->\n${page.slice(cut)}`);
const css = await readFile(path.join(here, "style.css"), "utf8");
await writeFile(path.join(out, "style.css"), `/* ${GENERATED} */\n${css}`);
