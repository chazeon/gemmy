// Renders the two web-viewer pictures of the README, docs/images/viewer-desktop.png and viewer-phone.png, in headless Chrome
// over the DevTools protocol (tests/browser/cdp.mjs, as scripts/render_thumbnails.mjs does). The viewer is the hosted site of
// the committed examples, built into a temporary folder (scripts/build_site.sh) and served on a free port. The three README
// examples (nacl, ice-ih, stishovite) are dropped on the page as files: each one's structure file, named <example>.vasp, and
// its config.toml, both read from the served site (a gallery card would name the tab POSCAR). ice Ih is the file shown, and one
// of its oxygen atoms is selected, so the details card shows. The theme is light (the system's light scheme, nothing stored)
// and the camera is the default one.
//   desktop  1600 x 1000 at 1x, the dock open: its View section and the Atoms folder in view.
//   phone    a real iPhone's screen, 393 x 852 (an iPhone 15 Pro), with the details card over the page. The page's viewport is the
//            screen less the status bar and the Safari bar: 393 x 706. It is drawn in a plain CSS frame made in Chrome (a black
//            bezel, a status bar with the Dynamic Island, a Safari-style address bar under the page) and shot at 3x.
// Both pictures are quantised to 256 colours with ImageMagick when it is installed (as scripts/render_examples.sh does).
// Chrome comes from GEMMY_CHROME or the usual place. Needs Node 22 or later.
//
// Usage: node scripts/render_readme_shots.mjs
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../tests/browser/cdp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "images");
const CHROME = process.env.GEMMY_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FLAGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
const EXAMPLES = ["nacl", "ice-ih", "stishovite"];
const SHOWN_FILE = "ice-ih";
const DESKTOP = { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false };
// The phone's screen, in css px, as a real iPhone 15 Pro has it. The page is the screen less the status bar above it and
// the Safari bar below it, so the viewport is shorter than the screen.
const SCREEN = { width: 393, height: 852 };
const STATUS_BAR = 54;
const SAFARI_BAR = 92;
const VIEWPORT = { width: SCREEN.width, height: SCREEN.height - STATUS_BAR - SAFARI_BAR };
const PHONE = { ...VIEWPORT, deviceScaleFactor: 3, mobile: true };
// The phone frame, in css px: the bezel around the screen.
const BEZEL = 12;
const SCREEN_RADIUS = 43; // inside a 55 px outer corner
const PAGE_BACKGROUND = "#f6f7fa";
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const log = (...parts) => console.error(...parts);

const work = mkdtempSync(join(tmpdir(), "readme-shots-"));
const site = join(work, "site");

// The hosted site of the committed examples, built the way scripts/build_site.sh builds it.
execFileSync("bash", [join(ROOT, "scripts", "build_site.sh")], {
  cwd: ROOT,
  env: { ...process.env, OUT: site, GEMMY: process.env.GEMMY ?? join(ROOT, ".venv", "bin", "gemmy") },
  stdio: "inherit",
});

// The site on a free port.
const server = createServer((req, res) => {
  const path = join(site, decodeURIComponent(new URL(req.url, "http://x").pathname));
  try {
    const body = readFileSync(path.endsWith("/") ? join(path, "index.html") : path);
    const type = path.endsWith(".js") ? "text/javascript" : path.endsWith(".css") ? "text/css" : path.endsWith(".json") ? "application/json" : path.endsWith(".html") ? "text/html" : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(body);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const base = `http://127.0.0.1:${server.address().port}/`;

// Chrome with a remote-debugging port, in a fresh profile.
const profile = mkdtempSync(join(work, "chrome-"));
const chrome = spawn(
  CHROME,
  ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--mute-audio", ...FLAGS, "about:blank"],
  { stdio: "ignore" },
);
async function devtoolsPort() {
  const marker = join(profile, "DevToolsActivePort");
  for (let i = 0; i < 300; i++) {
    if (chrome.exitCode !== null) throw new Error("Chrome exited before it listened");
    if (existsSync(marker) && readFileSync(marker, "utf8").trim()) return Number(readFileSync(marker, "utf8").split("\n")[0]);
    await sleep(100);
  }
  throw new Error("Chrome did not open its DevTools port");
}

// One page: its session, a script evaluator, a wait and the presses.
function pageSession(browser, sessionId) {
  const send = (method, params = {}) => browser.send(method, params, sessionId);
  const evaluate = async (expression) => {
    const reply = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result.value;
  };
  const waitFor = async (expression, what, limitMs = 120000) => {
    for (let waited = 0; waited < limitMs; waited += 100) {
      if (await evaluate(`!!(${expression})`)) return;
      await sleep(100);
    }
    throw new Error(`timeout waiting for ${what}`);
  };
  // A press at a point: a tap on a touch page, a mouse press on a desktop one.
  const press = async (x, y, mobile) => {
    if (mobile) {
      await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
      await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    } else {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    }
  };
  const click = (expression) =>
    evaluate(`(() => { const el = ${expression}; if (!el) throw new Error("no element: ${expression.replace(/"/g, "'")}"); el.click(); return true; })()`);
  return { send, evaluate, waitFor, press, click };
}

// A new page at the metrics, in its own browser context (its own storage) when given one.
async function newPage(browser, metrics, browserContextId) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank", ...(browserContextId ? { browserContextId } : {}) });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const page = pageSession(browser, sessionId);
  await page.send("Page.enable");
  await page.send("Runtime.enable");
  await page.send("Emulation.setDeviceMetricsOverride", metrics);
  if (metrics.mobile) await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  return { ...page, targetId };
}

// The three examples open as files, each one dropped on the page: its structure file (named <example>.vasp) and its
// config.toml, both read from the served site.
async function openExamples(page, base) {
  await page.waitFor(`!!document.querySelector("#examples-grid .example")`, "the start screen");
  for (const name of EXAMPLES) {
    const [structure, config] = await Promise.all(
      ["POSCAR", "config.toml"].map(async (file) => (await fetch(new URL(`${name}/${file}`, base))).text()),
    );
    await page.evaluate(`(() => {
      const transfer = new DataTransfer();
      transfer.items.add(new File([${JSON.stringify(structure)}], ${JSON.stringify(`${name}.vasp`)}, { type: "text/plain" }));
      transfer.items.add(new File([${JSON.stringify(config)}], "config.toml", { type: "text/plain" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
      return true;
    })()`);
    await page.waitFor(`document.documentElement.dataset.scene === "shown" && !document.querySelector("#examples-grid")`, `the ${name} scene`);
    await sleep(3000);
  }
}

// The file chosen from the file island's menu (the trigger opens it on a pointer press, as the browser driver does).
async function chooseFile(page, name) {
  await page.evaluate(`document.querySelector('[data-testid="file-trigger"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })) || true`);
  await page.waitFor(`!!document.getElementById("file-panel")`, "the file menu");
  await page.click(`document.querySelector('[data-testid="file-item"][data-label="${name}.vasp"]')`);
  await page.waitFor(`!document.getElementById("file-panel")`, "the file menu to shut");
  await sleep(2000);
}

// Selects an oxygen atom: presses over the stage (a known one first) until the details card names an O atom.
async function selectOxygen(page, mobile) {
  const stage = await page.evaluate(`(() => { const r = document.getElementById("stage").getBoundingClientRect(); return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  const fractions = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74, 0.2, 0.8];
  const points = [[stage.left + stage.width * 0.37, 226]];
  for (const fy of fractions) for (const fx of fractions) points.push([stage.left + stage.width * fx, stage.top + stage.height * fy]);
  for (const [x, y] of points) {
    await page.press(x, y, mobile);
    await sleep(900);
    if ((await page.evaluate(`document.getElementById("info")?.textContent ?? ""`)).includes("O atom")) return;
  }
  throw new Error("no oxygen atom was picked");
}

// Opens the named sections of the dock (its sections are collapsible, with aria-expanded on their triggers).
async function openSections(page, names) {
  for (const name of names) {
    await page.evaluate(`(() => { const el = [...document.querySelectorAll('#inspector [data-slot="collapsible-trigger"]')].find((e) => e.textContent.trim().startsWith(${JSON.stringify(name)}));
      if (!el) throw new Error("no section ${name}");
      if (el.getAttribute("aria-expanded") !== "true") el.click();
      return true; })()`);
  }
  await sleep(600);
}

// 256 colours, as scripts/render_examples.sh does (ImageMagick). Without ImageMagick the Chrome picture is kept as it is.
function quantise(input, output) {
  if (spawnSync("magick", ["-version"]).status !== 0) {
    copyFileSync(input, output);
    return;
  }
  execFileSync("magick", [input, "-colors", "256", "-strip", "-define", "png:compression-level=9", `PNG8:${output}`]);
}

// The phone frame: a black bezel, a status bar (time, signal and battery) with the Dynamic Island, the viewport's picture,
// and a Safari-style address bar with the site's address, then the home indicator. Plain CSS, no image files.
function frameHtml() {
  return `<!doctype html>
<html><head><meta charset="utf-8"><style>
html, body { margin: 0; background: transparent; font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; }
#device { position: absolute; left: 0; top: 0; box-sizing: border-box; width: ${SCREEN.width + 2 * BEZEL}px; height: ${SCREEN.height + 2 * BEZEL}px;
  padding: ${BEZEL}px; background: #111113; border-radius: 55px; }
#screen { position: relative; width: ${SCREEN.width}px; height: ${SCREEN.height}px; border-radius: ${SCREEN_RADIUS}px; overflow: hidden; background: ${PAGE_BACKGROUND}; }
#status { position: absolute; left: 0; top: 0; width: 100%; height: ${STATUS_BAR}px; }
#time { position: absolute; left: 44px; top: 18px; font-size: 16px; font-weight: 600; color: #000; }
#signal { position: absolute; right: 74px; top: 22px; display: flex; gap: 2px; align-items: flex-end; height: 11px; }
#signal i { display: block; width: 3px; background: #000; border-radius: 1px; }
#battery { position: absolute; right: 40px; top: 22px; width: 22px; height: 11px; border: 1px solid #000; border-radius: 3px; padding: 1px; box-sizing: border-box; }
#battery::after { content: ""; display: block; height: 100%; width: 80%; background: #000; border-radius: 1.5px; }
#battery::before { content: ""; position: absolute; right: -3px; top: 3px; width: 2px; height: 4px; background: #000; border-radius: 0 1px 1px 0; }
#island { position: absolute; left: 50%; top: 11px; transform: translateX(-50%); width: 120px; height: 35px; border-radius: 18px; background: #000; }
#page { position: absolute; left: 0; top: ${STATUS_BAR}px; width: ${VIEWPORT.width}px; height: ${VIEWPORT.height}px; display: block; }
#safari { position: absolute; left: 0; bottom: 0; width: 100%; height: ${SAFARI_BAR}px; }
#address { position: absolute; left: 12px; right: 12px; top: 14px; height: 42px; border-radius: 21px; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, 0.14);
  display: flex; align-items: center; justify-content: center; font-size: 16px; color: #1c1c1e; }
#aa { position: absolute; left: 18px; font-size: 15px; color: #3c3c43; }
#home { position: absolute; left: 50%; bottom: 7px; transform: translateX(-50%); width: 134px; height: 5px; border-radius: 3px; background: #000; }
</style></head>
<body>
<div id="device">
  <div id="screen">
    <div id="status">
      <span id="time">9:41</span>
      <div id="signal"><i style="height:4px"></i><i style="height:6px"></i><i style="height:8px"></i><i style="height:11px"></i></div>
      <div id="battery"></div>
      <div id="island"></div>
    </div>
    <img id="page" src="phone-viewport.png" alt="">
    <div id="safari">
      <div id="address"><span id="aa">aA</span>chazeon.github.io/gemmy</div>
      <div id="home"></div>
    </div>
  </div>
</div>
</body></html>`;
}

const DESKTOP_FILE = join(work, "viewer-desktop.png");
const PHONE_FILE = join(work, "viewer-phone.png");
let browser;
try {
  browser = await connect(await devtoolsPort());
  await browser.send("Browser.setDownloadBehavior", { behavior: "deny" });

  // Desktop, in the default context: the dock is open on a wide screen when nothing is stored.
  const desktop = await newPage(browser, DESKTOP);
  await desktop.send("Page.navigate", { url: new URL("index.html?open=1", base).href });
  await openExamples(desktop, base);
  await chooseFile(desktop, SHOWN_FILE);
  await selectOxygen(desktop, false);
  await desktop.waitFor(`document.documentElement.dataset.dock === "open"`, "the dock to be open");
  await openSections(desktop, ["View", "Atoms"]);
  // The pointer rests on empty canvas, so no hover shows in the picture.
  await desktop.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 760, y: 990 });
  await sleep(1000);
  const desktopShot = await desktop.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: DESKTOP.width, height: DESKTOP.height, scale: 1 } });
  writeFileSync(DESKTOP_FILE, Buffer.from(desktopShot.data, "base64"));
  await browser.send("Target.closeTarget", { targetId: desktop.targetId });

  // Phone, in its own browser context so no stored state of the desktop reaches it.
  const { browserContextId } = await browser.send("Target.createBrowserContext");
  const phone = await newPage(browser, PHONE, browserContextId);
  await phone.send("Page.navigate", { url: new URL("index.html?open=1", base).href });
  await openExamples(phone, base);
  await chooseFile(phone, SHOWN_FILE);
  await selectOxygen(phone, true);
  await sleep(1000);
  const viewport = await phone.send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: VIEWPORT.width, height: VIEWPORT.height, scale: 1 } });
  writeFileSync(join(work, "phone-viewport.png"), Buffer.from(viewport.data, "base64"));
  await browser.send("Target.closeTarget", { targetId: phone.targetId });
  await browser.send("Target.disposeBrowserContext", { browserContextId });

  // The frame, drawn in Chrome around the viewport's picture, shot at 3x on a transparent background.
  writeFileSync(join(work, "frame.html"), frameHtml());
  const frame = await newPage(browser, { width: SCREEN.width + 2 * BEZEL + 40, height: SCREEN.height + 2 * BEZEL + 40, deviceScaleFactor: 3, mobile: false });
  await frame.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
  await frame.send("Page.navigate", { url: `file://${join(work, "frame.html")}` });
  await frame.waitFor(`document.getElementById("page").complete && document.getElementById("page").naturalWidth > 0`, "the viewport picture");
  const device = await frame.evaluate(`(() => { const r = document.getElementById("device").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
  const framed = await frame.send("Page.captureScreenshot", { format: "png", clip: { ...device, scale: 1 } });
  writeFileSync(PHONE_FILE, Buffer.from(framed.data, "base64"));
  await browser.send("Target.closeTarget", { targetId: frame.targetId });

  quantise(DESKTOP_FILE, join(OUT, "viewer-desktop.png"));
  quantise(PHONE_FILE, join(OUT, "viewer-phone.png"));
  log(`wrote ${join(OUT, "viewer-desktop.png")} and ${join(OUT, "viewer-phone.png")}`);
} finally {
  browser?.close();
  // This Chrome, by its own pid: it must have exited before its profile is removed.
  const exited = new Promise((ok) => chrome.once("exit", ok));
  chrome.kill("SIGTERM");
  await exited;
  server.close();
  rmSync(work, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
}
