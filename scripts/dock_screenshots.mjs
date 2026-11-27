// Screenshots of the inspector dock for the look review. Builds the hosted site of the committed examples into a temporary
// folder (scripts/build_site.sh, with the repo's .venv gemmy), serves it, opens the front page, opens the stishovite
// example's card and drops its POSCAR and config.toml, so the dock has the structure sections. Then it opens the dock,
// expands the Atoms section, one bond folder, one shape folder and the Cell section, and captures, for each theme (the
// system's colour scheme set through CDP, as tests/browser/driver.mjs does), the dock at 2x device scale and the whole
// viewport. Chrome is the one tests/test_browser.py uses (GEMMY_CHROME overrides it).
//
// Run `npm --prefix web run build` first: the site is built from src/gemmy/viewer.
//
// Usage: node scripts/dock_screenshots.mjs <round>
// Writes <scratchpad>/dock-shots/round-<round>/{light,dark}.png (the dock) and {light,dark}-full.png (the viewport).
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { connect } from "../tests/browser/cdp.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH = "/private/tmp/claude-501/-Volumes-Matee-Users-chazeon-Projects-blender-ssp/d4f58e5d-2d38-46ac-a147-d9fc36b9e78b/scratchpad";
const CHROME = process.env.GEMMY_CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const FLAGS = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"];
// The window's width: 1280 by default; DOCK_WIDTH sets another (the round's shots at each width).
const VIEWPORT = { width: Number(process.env.DOCK_WIDTH ?? 1280), height: 900 };
const THEMES = ["light", "dark"];

const round = process.argv[2];
if (round === undefined) throw new Error("usage: node scripts/dock_screenshots.mjs <round>");
const outDir = join(SCRATCH, "dock-shots", `round-${round}`);
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

async function waitFor(evaluate, expression, what, limitMs = 60000) {
  for (let waited = 0; waited < limitMs; waited += 100) {
    if (await evaluate(`!!(${expression})`)) return;
    await sleep(100);
  }
  throw new Error(`timeout waiting for ${what}`);
}

// Build the site into a temporary folder, the way the browser test does.
const work = mkdtempSync(join(tmpdir(), "dock-shots-"));
const site = join(work, "site");
execFileSync("bash", [join(ROOT, "scripts", "build_site.sh")], {
  cwd: ROOT,
  env: { ...process.env, OUT: site, GEMMY: join(ROOT, ".venv", "bin", "gemmy") },
  stdio: "inherit",
});

// Serve it on a free port.
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

// The example's POSCAR, dropped alone: the default config then applies, with its automatic O-Si bond rule.
const dropped = [
  ["POSCAR", readFileSync(join(ROOT, "examples", process.env.DOCK_EXAMPLE ?? "stishovite", "POSCAR"), "utf8")],
];

// Chrome with a remote-debugging port.
const profile = mkdtempSync(join(work, "chrome-"));
const chrome = spawn(
  CHROME,
  ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--no-first-run", "--no-default-browser-check", "--mute-audio", ...FLAGS, "about:blank"],
  { stdio: "ignore" },
);
const marker = join(profile, "DevToolsActivePort");
let port = null;
for (let i = 0; i < 300 && port === null; i++) {
  try {
    port = Number(readFileSync(marker, "utf8").split("\n")[0]);
  } catch {
    await sleep(100);
  }
}
if (port === null) throw new Error("Chrome did not open its DevTools port");

const browser = await connect(port);
try {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params = {}) => browser.send(method, params, sessionId);
  const evaluate = async (expression) => {
    const reply = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) throw new Error(reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text);
    return reply.result.value;
  };
  const click = (expression) => evaluate(`(() => { const el = ${expression}; if (!el) throw new Error("no element: ${expression.replace(/"/g, "'")}"); el.click(); return true; })()`);
  // Clicks the element with the given text among the matches of the selector, when it is shut (aria-expanded false).
  const expandByText = (selector, text) =>
    evaluate(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.textContent.trim().startsWith(${JSON.stringify(text)}));
      if (!el) throw new Error("no " + ${JSON.stringify(text)});
      if (el.getAttribute("aria-expanded") !== "true") el.click();
      return true; })()`);

  await s("Page.enable");
  await s("Runtime.enable");
  // DOCK_MOBILE=1: a phone (mobile emulation, touch) at DOCK_WIDTH.
  const mobile = process.env.DOCK_MOBILE === "1";
  await s("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 2, mobile });
  if (mobile) await s("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });

  for (const theme of THEMES) {
    await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: theme }] });
    await s("Storage.clearDataForOrigin", { origin: new URL(base).origin, storageTypes: "local_storage,session_storage" });
    await s("Page.navigate", { url: new URL("index.html", base).href });
    await waitFor(evaluate, `document.querySelectorAll("#examples-grid .example").length > 0`, "the start screen", 180000).catch(async (error) => {
      console.error(await evaluate(`JSON.stringify({ url: location.href, title: document.title, grid: document.querySelectorAll("#examples-grid").length, examples: document.querySelectorAll("[data-example]").length, body: document.body.innerHTML.slice(0, 400) })`));
      throw error;
    });
    await click(`document.querySelector('[data-example="stishovite"]')`);
    await waitFor(evaluate, `document.querySelector('[data-testid="page-title"]')?.textContent === "stishovite"`, "the example's scene", 120000);
    await sleep(1500);

    // The closed dock (DOCK_CLOSED=1): one toggle, the tab on the right edge, and no overlaps among the islands.
    if (process.env.DOCK_CLOSED === "1") {
      await sleep(600);
      if (await evaluate(`!!document.getElementById("inspector")`)) {
        await click(`document.querySelector('#inspector-tab')`);
        await waitFor(evaluate, `!document.getElementById("inspector")`, "the dock to shut");
      }
      const closed = await evaluate(`(() => {
        const toggles = [...document.querySelectorAll('#inspector-tab')];
        const box = toggles[0]?.getBoundingClientRect();
        const ids = ["menu-island", "tools", "export-area", "corner-buttons"];
        const boxes = ids.map((id) => [id, document.getElementById(id)?.getBoundingClientRect()]).filter(([, r]) => r);
        const overlaps = [];
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const [na, a] = boxes[i]; const [nb, b] = boxes[j];
          if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push(na + " x " + nb);
        }
        return { toggles: toggles.length, toggleTop: box?.top ?? null, toggleRightFromViewport: box ? innerWidth - box.right : null, inspectorShown: !!document.getElementById("inspector"), overlaps, helpCorner: document.querySelector('#corner-buttons')?.getBoundingClientRect().right ?? null };
      })()`);
      console.error(`${theme} closed:`, JSON.stringify(closed));
      continue;
    }
    // The scene tab (DOCK_SCENE=1): no structure, so the dock shows the Selection's hint and the no-structure note.
    if (process.env.DOCK_SCENE === "1") {
      // The dock opens by itself on a scene tab (its Selection); a press would shut it, so it is pressed only when shut.
      if (!(await evaluate(`!!document.getElementById("inspector")`))) await click(`document.querySelector('#inspector-tab')`);
      await waitFor(evaluate, `!!document.getElementById("inspector")`, "the inspector dock");
      // A press on the stage's corner (empty canvas) deselects, so the Selection shows its hint.
      const corner = await evaluate(`(() => { const r = document.getElementById("stage").getBoundingClientRect(); return { x: r.left + 12, y: r.top + 12 }; })()`);
      await s("Input.dispatchMouseEvent", { type: "mousePressed", x: corner.x, y: corner.y, button: "left", buttons: 1, clickCount: 1 });
      await s("Input.dispatchMouseEvent", { type: "mouseReleased", x: corner.x, y: corner.y, button: "left", buttons: 0, clickCount: 1 });
      await waitFor(evaluate, `document.querySelector("#info-body")?.textContent.includes("Click an atom")`, "the Selection's hint");
      await sleep(600);
      const sceneNotes = await evaluate(`(() => {
        const dock = document.getElementById("inspector").getBoundingClientRect();
        const styleOf = (el) => { if (!el) return null; const c = getComputedStyle(el); const r = document.createRange(); r.selectNodeContents(el); return { text: el.textContent.trim(), x: r.getBoundingClientRect().left - dock.left, fontSize: c.fontSize, color: c.color, lineHeight: c.lineHeight, top: el.getBoundingClientRect().top - dock.top }; };
        const hint = [...document.querySelectorAll("#inspector p")].find((p) => p.textContent.includes("Click an atom"));
        const note = [...document.querySelectorAll("#inspector p")].find((p) => p.textContent.includes("Open a structure file"));
        return { hint: styleOf(hint), note: styleOf(note) };
      })()`);
      console.error("scene notes:", JSON.stringify(sceneNotes));
      const sceneRect = await evaluate(`(() => { const r = document.getElementById("inspector").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
      const sceneShot = await s("Page.captureScreenshot", { format: "png", clip: { ...sceneRect, scale: 1 } });
      writeFileSync(join(outDir, `scene-${theme}.png`), Buffer.from(sceneShot.data, "base64"));
      continue;
    }
    // Drop the POSCAR and config.toml on the window (a structure tab).
    await evaluate(`(async () => {
      const transfer = new DataTransfer();
      for (const [name, text] of ${JSON.stringify(dropped)}) transfer.items.add(new File([text], name, { type: "text/plain" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
      return true;
    })()`);
    // A phone shows the selection card alone (no sections): the structure is loaded when the toggle is there.
    await waitFor(evaluate, mobile ? `!!document.querySelector('#inspector-tab')` : `[...document.querySelectorAll("#inspector button")].some((b) => b.textContent.includes("Atoms"))`, "the structure tab's sections", 120000);
    await sleep(1500);
    await sleep(1500);

    // Open the dock (the Style button), then expand the sections and folders the review needs.
    const open = await evaluate(`!!document.getElementById("inspector")`);
    if (!open) await click(`document.querySelector('#inspector-tab')`);
    await waitFor(evaluate, `!!document.getElementById("inspector")`, "the inspector dock");
    if (!mobile) await expandByText('#inspector button[aria-expanded]', "Atoms");
    if (!mobile) await expandByText('#inspector button[aria-expanded]', "Cell");
    if (!mobile) await expandByText('#inspector button[aria-expanded]', "Bonds");
    if (!mobile) await expandByText('#inspector button[aria-expanded]', "Shapes");
    // One folder in each of the Bonds and Shapes panes: the first folder title of each pane.
    // Folders start shut: open the first atom, the first bond (its name has a dash), the first shape (a polyhedron), and the
    // Cell's Supercell and Display box folds (React buttons, aria-expanded).
    await evaluate(`(() => {
      const titles = [...document.querySelectorAll("#inspector .tp-fldv_b")];
      const name = (el) => el.querySelector(".tp-fldv_t")?.textContent.trim() ?? "";
      const open = (match) => { const el = titles.find((e) => match(name(e))); if (el && !el.closest(".tp-fldv").classList.contains("tp-fldv-expanded")) el.click(); };
      open((n) => n === "O");
      // O is hidden through its eye (the folder keeps its fold), so the hidden state is in the shots.
      const hide = titles.find((e) => name(e) === "O")?.querySelector(".dock-eye");
      if (hide && hide.getAttribute("aria-pressed") === "true") hide.click();
      open((n) => n.includes("–"));
      open((n) => n.includes("polyhedron"));
      open((n) => n === "Supercell");
      open((n) => n === "Display box");
      return true;
    })()`);
    await sleep(400);
    const folders = await evaluate(`[...document.querySelectorAll("#inspector .tp-fldv_b")].map((el) => ({ text: el.textContent.trim(), summary: el.dataset.summary ?? null, expanded: el.closest(".tp-fldv")?.classList.contains("tp-fldv-expanded") ?? null }))`);
    console.error(`${theme} folders:`, JSON.stringify(folders));
    await sleep(800);

    // An atom selected on the structure tab, so the Selection section shows its rows: the first press that selects one (the
    // stage's centre, then a few points around it) ends the search.
    const stageBox = await evaluate(`(() => { const r = document.getElementById("stage").getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    for (const [dx, dy] of [[0, 0], [40, 0], [-40, 0], [0, 40], [0, -40], [80, 0], [-80, 0], [0, 80], [0, -80]]) {
      const x = stageBox.x + dx;
      const y = stageBox.y + dy;
      await s("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
      await s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
      await sleep(300);
      const picked = await evaluate(`!(document.querySelector("#info-body")?.textContent ?? "").includes("Click an atom")`);
      if (picked) break;
    }
    // The toggle, pressed with the mouse (CDP Input events, at its centre), not with element.click(): one press shuts the dock
    // and leaves the selection as it is; a second press opens it again. A press that reaches the canvas would deselect.
    const toggleCentre = () => evaluate(`(() => { const r = document.querySelector('#inspector-tab').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    const pressToggle = async () => {
      const at = await toggleCentre();
      await s("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
      await s("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
      await s("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
      await sleep(400);
    };
    const selectionText = () => evaluate(`document.querySelector("#info-body")?.textContent ?? ""`);
    const selectedBefore = await selectionText();
    const openBefore = await evaluate(`!!document.getElementById("inspector")`);
    await pressToggle();
    const closed = !(await evaluate(`!!document.getElementById("inspector")`));
    await pressToggle();
    const reopened = await evaluate(`!!document.getElementById("inspector")`);
    const selectionKept = reopened && (await selectionText()) === selectedBefore;
    const afterSecond = { open: reopened };
    const afterFirst = { open: !closed ? true : false, selectionKept };
    // The section headers' + buttons, pressed with the mouse (DOCK_PLUS=1 checks Add a bond, Add a shape). With DOCK_PLUS=2 the
    // section is folded first, with a real press on its header, so the + is pressed on a shut section.
    if (process.env.DOCK_PLUS === "1" || process.env.DOCK_PLUS === "2") {
      if (process.env.DOCK_PLUS === "2") {
        const head = await evaluate(`(() => { const t = [...document.querySelectorAll('#inspector [data-slot="collapsible-trigger"]')].find((e) => e.textContent.trim().startsWith("Bonds")); const r = t.getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
        for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) await s("Input.dispatchMouseEvent", { type, x: head.x, y: head.y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
        await sleep(400);
        console.error(`${theme} bonds folded by a real press:`, await evaluate(`[...document.querySelectorAll('#inspector [data-slot="collapsible-trigger"]')].find((e) => e.textContent.trim().startsWith("Bonds"))?.getAttribute("aria-expanded")`));
      }
      for (const label of ["Add a bond", "Add a shape"]) {
        const at = await evaluate(`(() => { const b = document.querySelector('[aria-label="${label}"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, hit: document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)?.getAttribute("aria-label") ?? null }; })()`);
        if (!at) { console.error(theme, label, "missing"); continue; }
        const trigger = await evaluate(`(() => { const b = document.querySelector('[aria-label="${label}"]'); const t = b.closest('[data-slot="collapsible"]')?.querySelector('[data-slot="collapsible-trigger"]'); return t?.getAttribute("aria-expanded") ?? null; })()`);
        const newRows = `[...document.querySelectorAll("#inspector .tp-fldv_t")].filter((e) => e.textContent.includes("New ")).length`;
        const newBefore = await evaluate(newRows);
        const press = async () => {
          await s("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
          await s("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", buttons: 1, clickCount: 1 });
          await s("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", buttons: 0, clickCount: 1 });
          await sleep(400);
        };
        await press();
        const newAfterFirst = await evaluate(newRows);
        await press();
        const newAfterSecond = await evaluate(newRows);
        const rowOpen = newAfterFirst > newBefore;
        const sectionAfter = await evaluate(`(() => { const b = document.querySelector('[aria-label="${label}"]'); return b?.closest('[data-slot="collapsible"]')?.querySelector('[data-slot="collapsible-trigger"]')?.getAttribute("aria-expanded") ?? null; })()`);
        console.error(`${theme} plus ${label}:`, JSON.stringify({ hit: at.hit, sectionBefore: trigger, sectionAfter, newRowsBefore: newBefore, afterFirstPress: newAfterFirst, afterSecondPress: newAfterSecond }));
      }
    }
    console.error(`${theme} toggle press:`, JSON.stringify({ openBefore, closedByFirstPress: closed, reopenedBySecondPress: reopened, selectionKept }));
    // The measures the look is checked by: the first section chevron's inset from the dock's left edge, the dock's right edge
    // against the viewport, and the dock's top against the bottom of the island row above it.
    if (mobile) {
      // A phone: the card (the dock's #inspector), the toggle tab on the right edge, no horizontal overflow, and the text clipped by the card.
      const phone = await evaluate(`(() => {
        const card = document.getElementById("inspector")?.getBoundingClientRect() ?? null;
        const toggle = document.querySelector('#inspector-tab')?.getBoundingClientRect() ?? null;
        let clipped = 0;
        if (card) {
          const walker = document.createTreeWalker(document.getElementById("inspector"), NodeFilter.SHOW_TEXT);
          for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            if (!node.textContent.trim()) continue;
            const range = document.createRange(); range.selectNodeContents(node);
            for (const r of range.getClientRects()) if (r.width > 0 && (r.left < card.left - 0.5 || r.right > card.right + 0.5)) clipped += 1;
          }
        }
        return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, card: card && { top: card.top, height: card.height, left: card.left, right: card.right, bottom: card.bottom }, toggle: toggle && { top: toggle.top, left: toggle.left, right: toggle.right, bottom: toggle.bottom }, clipped, viewportHeight: innerHeight };
      })()`);
      console.error(`${theme} phone:`, JSON.stringify(phone));
      // A tap on the toggle, with touch events (not a mouse), opens and shuts the card both ways.
      const tapToggle = async () => {
        const at = await evaluate(`(() => { const r = document.querySelector('#inspector-tab').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
        await s("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: at.x, y: at.y }] });
        await s("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await sleep(400);
      };
      const cardOpenBefore = await evaluate(`!!document.getElementById("inspector")`);
      await tapToggle();
      const shutByTap = !(await evaluate(`!!document.getElementById("inspector")`));
      await tapToggle();
      const reopenedByTap = await evaluate(`!!document.getElementById("inspector")`);
      console.error(`${theme} phone tap:`, JSON.stringify({ cardOpenBefore, shutByTap, reopenedByTap }));
      const phoneShot = await s("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(outDir, `phone-${theme}.png`), Buffer.from(phoneShot.data, "base64"));
      continue;
    }
    const measures = await evaluate(`(() => {
      const dock = document.getElementById("inspector").getBoundingClientRect();
      const chevron = document.querySelector('#inspector [data-slot="collapsible-trigger"] svg').getBoundingClientRect();
      const island = document.getElementById("tools")?.getBoundingClientRect();
      const style = getComputedStyle(document.getElementById("inspector"));
      // Overlaps: any two of the top islands and the dock whose boxes intersect (the page's own islands; empty means none).
      const ids = ["menu-island", "tools", "export-area", "corner-buttons", "inspector"];
      const boxes = Object.fromEntries(ids.map((id) => [id, document.getElementById(id)?.getBoundingClientRect()]).filter(([, r]) => r));
      const overlaps = [];
      for (const [i, a] of Object.entries(boxes)) for (const [j, b] of Object.entries(boxes)) {
        if (i >= j) continue;
        if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) overlaps.push(i + " x " + j);
      }
      const exportButton = document.getElementById("export-button")?.getBoundingClientRect();
      // Clipping: every text node in the dock must start at least 4 px inside its inner (border) edge. A line that fails is
      // named (its text), and the count must be 0.
      const innerLeft = dock.left + 1;
      const clipped = [];
      const walker = document.createTreeWalker(document.getElementById("inspector"), NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!node.textContent.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const rects = [...range.getClientRects()];
        for (const r of rects) if (r.width > 0 && r.left < innerLeft + 4 - 0.5) clipped.push(node.textContent.trim().slice(0, 40));
      }
      const selectionLabel = document.querySelector("#info-body .flex span.truncate");
      // The x of each line that must share one left line, from the dock's outer left edge: a section's chevron, its title's
      // text, the Selection hint (or any note in its place), and a Tweakpane folder's title.
      const xOf = (el) => (el ? el.getBoundingClientRect().left - dock.left : null);
      const titleText = document.querySelector('#inspector [data-slot="collapsible-trigger"] span.truncate');
      const hint = document.querySelector("#inspector #info-body p") ?? document.querySelector("#inspector p");
      const folderTitle = [...document.querySelectorAll("#inspector .tp-fldv_t")].find((e) => e.textContent.trim() === "Supercell");
      const lineX = { chevron: xOf(document.querySelector('#inspector [data-slot="collapsible-trigger"] svg')), sectionTitle: xOf(titleText), hint: xOf(hint), folderTitle: xOf(folderTitle) };
      const detectTitle = [...document.querySelectorAll("#inspector .tp-fldv_t")].find((e) => e.textContent.trim() === "Detect from radii");
      // The panes span the dock: their edges from the dock's inner edges (the left border and the right border, if any).
      const pane = document.querySelector("#inspector .style-pane")?.getBoundingClientRect();
      const borderRight = parseFloat(getComputedStyle(document.getElementById("inspector")).borderRightWidth) || 0;
      const borderLeft = parseFloat(getComputedStyle(document.getElementById("inspector")).borderLeftWidth) || 0;
      const paneEdges = pane ? { left: pane.left - (dock.left + borderLeft), right: (dock.right - borderRight) - pane.right } : null;
      const emptyNote = [...document.querySelectorAll("#inspector p")].find((e) => e.textContent.includes("No polyhedra"));
      const noteX = xOf(emptyNote);
      // The Tweakpane pane's own values (computed), for the Selection to copy: the container, a folder title, a labelled row.
      const cs = (el) => { if (!el) return null; const c = getComputedStyle(el); const r = el.getBoundingClientRect(); return { x: r.left - dock.left, right: r.right - dock.left, top: r.top, height: r.height, paddingTop: c.paddingTop, paddingRight: c.paddingRight, paddingBottom: c.paddingBottom, paddingLeft: c.paddingLeft, fontSize: c.fontSize, fontWeight: c.fontWeight, lineHeight: c.lineHeight, rowGap: c.rowGap, marginTop: c.marginTop }; };
      const tpRoot = document.querySelector("#inspector .style-pane .tp-rotv_c");
      const tpFolder = [...document.querySelectorAll("#inspector .tp-fldv_b")].find((e) => e.querySelector(".tp-fldv_t")?.textContent.trim() === "Detect from radii");
      const tpRow = [...document.querySelectorAll("#inspector .tp-lblv")].find((e) => e.querySelector(".tp-lblv_l")?.textContent.trim() === "Tolerance");
      const tpLabel = tpRow?.querySelector(".tp-lblv_l");
      const tpValue = tpRow?.querySelector(".tp-lblv_v");
      const tpField = tpRow?.querySelector("input, .tp-txtv_i, .tp-sldtxtv");
      const tpStyles = { folderTitleEl: tpFolder?.querySelector(".tp-fldv_t") ?? null, labelEl: tpLabel ?? null, root: cs(tpRoot), folderButton: cs(tpFolder), folderTitle: cs(tpFolder?.querySelector(".tp-fldv_t")), row: cs(tpRow), label: cs(tpLabel), value: cs(tpValue), field: cs(tpField), tolerance: xOf(tpLabel), valueRight: tpValue ? tpValue.getBoundingClientRect().right - dock.left : null, fieldRight: tpField ? tpField.getBoundingClientRect().right - dock.left : null };
      // The text x of an element (its first text node), from the dock's outer left edge; and the Selection against the Tweakpane pane.
      const textX = (el) => { if (!el) return null; const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); const n = w.nextNode(); if (!n) return null; const r = document.createRange(); r.selectNodeContents(n); return r.getBoundingClientRect().left - dock.left; };
      const heading = document.querySelector("#info-body > p");
      const selRow = document.querySelector("#info-body > div");
      const selLabel = selRow?.querySelector("span");
      const selValue = selRow?.children[1];
      const selField = selValue?.querySelector("span");
      const selectionPair = { headingText: textX(heading), folderTitleText: textX(tpStyles.folderTitleEl), refLabelText: textX(selLabel), tolerancePairText: textX(tpStyles.labelEl), valueRight: selValue ? selValue.getBoundingClientRect().right - dock.left : null, toleranceFieldRight: tpStyles.fieldRight, rowHeight: selRow ? selRow.getBoundingClientRect().height : null, toleranceRowHeight: tpStyles.row?.height ?? null };
      // The reveal of the picked atom: its folder (Si) is open and inside the dock's scrolling body.
      const revealFolder = [...document.querySelectorAll("#inspector .tp-fldv")].find((f) => f.querySelector(".tp-fldv_t")?.textContent.trim() === "Si");
      const scrollBody = document.querySelector('#inspector [class*="overflow-y-auto"]')?.getBoundingClientRect();
      const revealed = revealFolder && scrollBody ? { expanded: revealFolder.classList.contains("tp-fldv-expanded"), inView: revealFolder.getBoundingClientRect().top >= scrollBody.top && revealFolder.getBoundingClientRect().bottom <= scrollBody.bottom } : null;
      // The empty Shapes note (a structure with no polyhedra): its x, size and colour, to set beside the hint's.
      const emptyShapes = (() => { const p = [...document.querySelectorAll("#inspector p")].find((e) => e.textContent.includes("No polyhedra")); if (!p) return null; const c = getComputedStyle(p); const r = document.createRange(); r.selectNodeContents(p); return { x: r.getBoundingClientRect().left - dock.left, fontSize: c.fontSize, color: c.color }; })();
      // The toggle: how many there are, and where (its box from the viewport's right edge).
      const toggles = [...document.querySelectorAll('#inspector-tab')];
      const toggleBox = toggles[0]?.getBoundingClientRect();
      const toggleTab = toggleBox ? { top: toggleBox.top, rightFromViewport: innerWidth - toggleBox.right, width: toggleBox.width } : null;
      const lineX3 = { toggles: toggles.length, toggleTab, emptyShapes, revealed, selectionPair, tpStyles, paneEdges, noteX, detectFromRadii: xOf(detectTitle), rail: xOf(document.querySelector("#inspector .tp-fldv_i")), folderBody: xOf(document.querySelector("#inspector .tp-fldv_c")), label: xOf(document.querySelector("#inspector .tp-fldv_c .tp-lblv_l")) };
      const lineX2 = { ref: xOf(selectionLabel), tolerance: xOf([...document.querySelectorAll("#inspector .tp-lblv_l")].find((e) => e.textContent.trim() === "Tolerance")), bondFolder: xOf([...document.querySelectorAll("#inspector .tp-fldv_t")].find((e) => e.textContent.includes("–"))), sectionTitle2: xOf(titleText), atomTitle: xOf(document.querySelector("#info-body p.font-semibold")) };
      return { lineX, lineX2, lineX3, clippedCount: clipped.length, clipped: clipped.slice(0, 8), islandsTop: boxes["menu-island"]?.top ?? null, exportRightToDockLeft: exportButton && boxes.inspector ? boxes.inspector.left - exportButton.right : null, overlaps, chevronInset: chevron.left - dock.left, dockRightMinusViewport: dock.right - innerWidth, dockWidth: dock.width, dockTop: dock.top, islandsBottom: island ? island.bottom : null, dockBottomMinusViewport: dock.bottom - innerHeight, radiusTopLeft: style.borderTopLeftRadius, radiusTopRight: style.borderTopRightRadius, insetRight: getComputedStyle(document.getElementById("ui")).paddingRight };
    })()`);
    console.error(`${theme} measures:`, JSON.stringify(measures));
    // The Selection and the Bonds pane together, zoomed (the dock's own 2x): from the Selection's top to the Bonds section's end.
    const zoom = await evaluate(`(() => {
      const info = document.getElementById("info-body").getBoundingClientRect();
      const bonds = [...document.querySelectorAll('#inspector [data-slot="collapsible-trigger"]')].find((e) => e.textContent.trim().startsWith("Bonds"));
      const section = bonds?.closest('[data-slot="collapsible"]')?.getBoundingClientRect();
      const top = info.top - 8;
      const bottom = section ? section.bottom : info.bottom;
      const dock = document.getElementById("inspector").getBoundingClientRect();
      return { x: dock.left, y: top, width: dock.width, height: bottom - top };
    })()`);
    const zoomShot = await s("Page.captureScreenshot", { format: "png", clip: { ...zoom, scale: 1 } });
    writeFileSync(join(outDir, `${theme}-selection-bonds.png`), Buffer.from(zoomShot.data, "base64"));
    const rect = await evaluate(`(() => { const r = document.getElementById("inspector").getBoundingClientRect(); return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`);
    const dock = await s("Page.captureScreenshot", { format: "png", clip: { ...rect, scale: 1 } });
    writeFileSync(join(outDir, `${theme}.png`), Buffer.from(dock.data, "base64"));
    const full = await s("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(outDir, `${theme}-full.png`), Buffer.from(full.data, "base64"));
    // The dock scrolled to its end: the last section and its bottom padding.
    await evaluate(`(() => { const el = document.querySelector('#inspector [class*="overflow-y-auto"]'); el.scrollTop = el.scrollHeight; return true; })()`);
    await sleep(400);
    const bottom = await s("Page.captureScreenshot", { format: "png", clip: { ...rect, scale: 1 } });
    writeFileSync(join(outDir, `${theme}-bottom.png`), Buffer.from(bottom.data, "base64"));
    console.error(`wrote ${theme} to ${outDir}`);
  }
} finally {
  browser.close();
  chrome.kill();
  server.close();
}
console.log(outDir);
