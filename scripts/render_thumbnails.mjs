// Captures the gallery thumbnails: each example's page, opened in headless Chrome at 480 x 320 (captured at 2x),
// light theme, the stage alone at the default view, with the cell box hidden (its item in the ☰ menu, as a reader would turn it
// off) and the axis triad hidden (a style for this capture only). Writes <out>/<name>.png at 2x; scripts/render_thumbnails.sh
// trims the picture to the structure and fits it to the frame. Uses tests/browser/cdp.mjs and Node 22 or later.
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
const QUIET_MS = 2000; // the stage's first frame and its settling (the default view draws at once; no glide)
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

// The cell box is off in the picture: its toggle in the ☰ panel, switched off as a reader would. The trigger is pressed
// with the mouse, the toggle is clicked once the panel is open, and the trigger shuts it.
async function hideCellBox(send, evaluate) {
  const press = async (selector) => {
    const { x, y } =
      await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(300);
  };
  const box = `[...document.querySelectorAll('#main-panel [aria-pressed]')].find((el) => el.textContent.trim() === "Cell box")`;
  await press('[aria-label="Menu"]');
  if (await evaluate(`${box}?.getAttribute("aria-pressed") === "true"`)) {
    await evaluate(`(${box}).click(), true`);
    await sleep(200);
  }
  if ((await evaluate(`${box}?.getAttribute("aria-pressed")`)) !== "false")
    throw new Error("the cell box did not hide");
  await press('[aria-label="Menu"]');
}

// One example: its page, the stage alone, a PNG of the stage at the default view.
async function capture(browser, url) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  try {
    const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
    const send = (method, params = {}) => browser.send(method, params, sessionId);
    const evaluate = async (expression) =>
      (await send("Runtime.evaluate", { expression, returnByValue: true })).result.value;
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: SCALE,
      mobile: false,
    });
    await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
    // The capture's flags, before the page's own scripts run: no triad in the picture (web/src/render/triad3d.ts).
    await send("Page.addScriptToEvaluateOnNewDocument", { source: "window.__gemmyNoTriad = true;" });
    await send("Page.navigate", { url });
    for (let i = 0; i < 600; i++) {
      const ready = await evaluate(
        `!!document.querySelector("#stage canvas") && document.getElementById("zoom-level")?.textContent !== "" &&
          !document.body.classList.contains("booting")`,
      );
      if (ready) break;
      await sleep(100);
    }
    await sleep(QUIET_MS);
    await hideCellBox(send, evaluate);
    // Only the stage: the viewer's controls, panels and popovers are hidden for the picture, and so are the triad.
    await evaluate(`(() => { const style = document.createElement("style");
      style.textContent = "body > :not(main) { display: none !important; } #triad { display: none !important; }";
      document.head.append(style); return true; })()`);
    await sleep(200);
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
    const png = await capture(browser, new URL(`${name}/index.html`, base).href);
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
