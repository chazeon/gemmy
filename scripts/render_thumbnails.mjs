// Captures the gallery thumbnails: each example's page, opened in headless Chrome at 480 x 320 (captured at 2x),
// light theme, the stage alone at the default view (capture mode, ?capture=1: no controls, no triad), with the cell box hidden
// through window.gemmy. The picture is transparent: Chrome's default background is alpha 0 for the capture, and the API
// makes the page's backgrounds transparent, so the WebGL canvas (cleared to alpha 0) shows nothing behind the structure. Writes <out>/<name>.png at 2x;
// scripts/render_thumbnails.sh trims the picture to the structure (on alpha) and fits it to the frame. Uses tests/browser/cdp.mjs and Node 22 or later.
//
// Usage: node render_thumbnails.mjs <base-url> <out-dir> <example-name>...
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "../tests/browser/cdp.mjs";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const WIDTH = 480;
const HEIGHT = 320;
const SCALE = 2; // the capture is supersampled; the script resizes it to WIDTH x HEIGHT
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

const [base, outDir, ...names] = process.argv.slice(2);
if (!base || !outDir || names.length === 0) {
  console.error("usage: node render_thumbnails.mjs <base-url> <out-dir> <example-name>...");
  process.exit(2);
}
mkdirSync(outDir, { recursive: true });

// The DevTools port Chrome writes once it listens, in the fresh profile.
async function devtoolsPort(profile, chrome) {
  const marker = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 300; i++) {
    if (chrome.exitCode !== null) throw new Error("Chrome exited before it listened");
    if (existsSync(marker) && readFileSync(marker, "utf8").trim())
      return Number(readFileSync(marker, "utf8").split("\n")[0]);
    await sleep(100);
  }
  throw new Error("Chrome did not open its DevTools port");
}

// One example: the site's page in capture mode, the stage alone, a PNG of the stage at the default view.
async function capture(browser, url, name) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  try {
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params = {}) => browser.send(method, params, sessionId);
    const evaluate = async (expression) => {
      const { result, exceptionDetails } = await send("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    };
    const waitFor = async (expression) => {
      for (let i = 0; i < 600 && !(await evaluate(expression)); i++) await sleep(100);
    };
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: SCALE,
      mobile: false,
    });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    // The picture's background is transparent (alpha 0), not the page's own colour.
    await send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    await send("Page.navigate", { url });
    await waitFor("!!window.gemmy");
    // The capture API (web/src/ui/capture-api.ts): the example opens as its card opens it, then the box off, light, no page background.
    await evaluate(`gemmy.ready().then(() => gemmy.openExample(${JSON.stringify(name)}))`);
    await evaluate(`(gemmy.set({ box: false, theme: "light", transparent: true }), gemmy.rendered())`);
    const shot = await send("Page.captureScreenshot", {
      format: "png",
      clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 },
    });
    return Buffer.from(shot.data, "base64");
  } finally {
    await browser.send("Target.closeTarget", { targetId });
  }
}

const profile = mkdtempSync(join(tmpdir(), "gemmy-thumbnails-"));
const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--mute-audio",
    "--use-angle=metal",
    "about:blank",
  ],
  { stdio: "ignore" },
);
let browser;
try {
  browser = await connect(await devtoolsPort(profile, chrome));
  await browser.send("Browser.setDownloadBehavior", { behavior: "deny" });
  for (const name of names) {
    const png = await capture(browser, new URL("?capture=1", base).href, name);
    writeFileSync(join(outDir, `${name}.png`), png);
    console.log(`${name}: ${png.length} bytes`);
  }
} finally {
  browser?.close();
  // This Chrome, by its own pid: it must have exited before its profile is removed.
  const exited = new Promise((ok) => chrome.once("exit", ok));
  chrome.kill("SIGTERM");
  await exited;
  // Chrome's helpers may still be writing its profile for a moment after it exits: retry the removal.
  rmSync(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
