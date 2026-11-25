// The viewer's behaviour script, run by tests/test_browser.py in headless Chrome. On each page it runs the same ten
// steps (default view, Atoms off, Bold outline, lens 24, fit, look along a, centre a polyhedron, drop a second scene as
// a tab, SVG export, PNG export). A page that opens on the start screen (the hosted front page) first records the
// start screen (home), then opens the example named by its card as the first step's scene. After each step it records
// the page's UI state and the WebGL draw calls the step made; the two exports also carry their file (the SVG text, the
// PNG's size). Then the layout at two widths (LAYOUT). Prints one JSON document on stdout.
// Exit code 3 means WebGL 2 did not start, so the caller can retry with software rendering.
//
// Usage: node driver.mjs <devtools-port> <base-url> <dropped-scene-path> name=page-path[#card]...
import { connect } from "./cdp.mjs";

const [portText, base, droppedPath, ...pageArgs] = process.argv.slice(2);
// name=path, or name=path#card: a page on the start screen, whose card (the example's name) is clicked first. The
// example is the one with polyhedra, so the selection step has them to pick.
const pages = pageArgs.map((arg) => {
  const [head, card] = arg.split("#");
  const at = head.indexOf("=");
  return { name: head.slice(0, at), path: head.slice(at + 1), card: card ?? null };
});

// Installed before each page loads. window.__gemmyTest is the test flag read by camera/view.ts (glides land at once).
// The WebGL counters count every clear and draw call. The export blobs are kept, so nothing is downloaded.
const HOOK = `(() => {
  window.__gemmyTest = true;
  window.__gl = { clear: 0, draw: 0 };
  const proto = WebGL2RenderingContext.prototype;
  const wrap = (name, counter) => {
    const original = proto[name];
    proto[name] = function (...args) { window.__gl[counter]++; return original.apply(this, args); };
  };
  wrap("clear", "clear");
  for (const name of ["drawElements", "drawArrays", "drawElementsInstanced", "drawArraysInstanced"]) wrap(name, "draw");
  window.__blobs = [];
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (blob) { window.__blobs.push(blob); return createObjectURL.call(URL, blob); };
})();`;

// The UI state the picture and the controls show, read from the page.
const SNAP = `(() => ({
  title: document.querySelector('[data-testid="page-title"]')?.textContent ?? null,
  tabs: [...document.querySelectorAll('[data-testid="tab-strip"] button, [data-testid="tab-strip"] a')].map((el) => ({
    label: el.textContent.trim(),
    current: el.closest("[aria-current]")?.getAttribute("aria-current") ?? el.getAttribute("aria-current"),
  })),
  zoom: document.getElementById("zoom-level").textContent,
  theme: document.documentElement.dataset.theme ?? null,
  dark: document.documentElement.classList.contains("dark"),
  lensAria: [...document.querySelectorAll("#lens-group [data-lens]")].map((b) => [b.dataset.lens, b.getAttribute("aria-pressed")]),
  info: document.getElementById("info-body")?.textContent.slice(0, 300) ?? null,
}))()`;

// The menu's state, while it is open: its checks, and the choices (outline width, theme) that are checked. Null when
// the menu is shut (its items are not in the page then).
const MENU = `(() => {
  const menu = document.getElementById("main-panel");
  if (!menu) return null;
  const checks = Object.fromEntries([...menu.querySelectorAll('[aria-label="Show"] [aria-pressed]')]
    .map((el) => [el.textContent.trim(), el.getAttribute("aria-pressed")]));
  const chosen = [...menu.querySelectorAll('[aria-label="Outline width"] [aria-pressed="true"]')]
    .map((el) => el.textContent.trim());
  return { checks, chosen };
})()`;

// The layout the test checks (tests/test_browser.py): the controls of the top bar (the menu island and the tool island)
// and their centre lines, the lens and zoom row's centre line, the page's sideways scroll, and
// the box round the menu's items (none when the menu is shut).
const LAYOUT = `(() => {
  const shown = (el) => el.getClientRects().length > 0;
  const centre = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
  const spread = (els) => { const ys = els.map(centre); return ys.length ? Math.max(...ys) - Math.min(...ys) : 0; };
  const shownAll = (selector) => [...document.querySelectorAll(selector)].filter(shown);
  const menuControls = shownAll("#menu-island button, #menu-island a");
  const toolControls = shownAll("#tools button");
  // The lens and zoom controls are one row from the aperture button: the lenses (scrolling), the zoom and fit.
  const rowControls = shownAll("#lens-column button, #lens-column output");
  const items = shownAll("#main-panel");
  const box = items.reduce((u, el) => {
    const r = el.getBoundingClientRect();
    return { left: Math.min(u.left, r.left), top: Math.min(u.top, r.top), right: Math.max(u.right, r.right), bottom: Math.max(u.bottom, r.bottom) };
  }, { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity });
  return {
    viewport: { width: innerWidth, height: innerHeight },
    scrollWidth: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth),
    controls: { menu: menuControls.length, tools: toolControls.length, row: rowControls.length },
    spread: {
      menu: spread(menuControls), tools: spread(toolControls), topBar: spread([...menuControls, ...toolControls]),
      row: spread(rowControls),
    },
    menuBox: items.length ? box : null,
  };
})()`;

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
// How long the draw counters must hold still before a step is read (the page's timers fire within this).
const QUIET_MS = 200;

// Runs the steps on one page and returns them. Each step is { name, draws: { clear, draw }, ...SNAP }.
async function runPage(browser, page) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params) => browser.send(method, params, sessionId);
  const evaluate = async (expression) => {
    const reply = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) {
      throw new Error(`page error: ${reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text}`);
    }
    return reply.result.value;
  };
  const waitFor = async (expression, what) => {
    for (let waited = 0; waited < 30000; waited += 100) {
      if (await evaluate(`!!(${expression})`)) return;
      await sleep(100);
    }
    throw new Error(`timeout waiting for ${what}`);
  };
  const clickJs = (selector, index = 0) =>
    evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!el) throw new Error(${JSON.stringify(`no element ${selector} ${index}`)}); el.click(); return true; })()`);
  const glCounts = () => evaluate("({ ...window.__gl })");
  const blobCount = () => evaluate("window.__blobs.length");
  // Waits until the page stops drawing: the counters hold still for QUIET_MS.
  const settle = async () => {
    let last = "";
    let quietSince = Date.now();
    for (let waited = 0; waited < 15000; waited += 100) {
      const now = JSON.stringify(await glCounts());
      if (now !== last) {
        last = now;
        quietSince = Date.now();
      } else if (Date.now() - quietSince >= QUIET_MS) return;
      await sleep(100);
    }
    throw new Error("the page kept drawing");
  };
  const steps = [];
  // Runs one step: the action, then the page settles, then the state is read.
  async function record(name, action = null, extra = null) {
    const started = Date.now();
    const before = await glCounts();
    if (action) await action();
    await settle();
    const after = await glCounts();
    const state = await evaluate(SNAP);
    // The menu, when it is open for this step: its state is kept, and the menu is shut for the next step.
    const menu = await evaluate(MENU);
    if (menu) {
      state.menu = menu;
      await closeMainMenu();
    }
    const step = { name, draws: { clear: after.clear - before.clear, draw: after.draw - before.draw }, ...state };
    if (extra) Object.assign(step, await extra());
    steps.push(step);
    console.error(`${page.name} ${name} ${JSON.stringify(step.draws)} ${Date.now() - started} ms`);
  }
  // A press at the centre of an element, as a user's mouse makes it (the menu opens on a press, not a click).
  const mouseClick = async (selector) => {
    const { x, y } =
      await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await s("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  };
  // The menu: opened and shut by its button, pressed with the mouse.
  const openMainMenu = async () => {
    if (await evaluate(MENU)) return;
    await mouseClick('[aria-label="Menu"]');
    await waitFor(`!!document.getElementById("main-panel")`, "the menu to open");
  };
  const closeMainMenu = async () => {
    await mouseClick('[aria-label="Menu"]');
    await waitFor(`!document.getElementById("main-panel")`, "the menu to shut");
  };
  // A check or a choice in the open menu, by its section and its text.
  const clickMenuItem = (section, text) =>
    evaluate(`(() => { const el = [...document.querySelectorAll('#main-panel [aria-label="${section}"] [aria-pressed]')]
      .find((item) => item.textContent.trim() === ${JSON.stringify(text)});
      if (!el) throw new Error(${JSON.stringify(`no menu item ${text}`)}); el.click(); return true; })()`);
  // The Export menu: a shadcn dropdown, opened by a press on its button (as the menu), and an item picked by its text
  // (an item's text is its label and its note, so the label is the start of it).
  const openExportMenu = async () => {
    await mouseClick("#export-button");
    await waitFor(`!!document.querySelector('[data-slot="dropdown-menu-content"]')`, "the export menu to open");
  };
  const pickExportItem = (label) =>
    evaluate(`(() => { const el = [...document.querySelectorAll('[data-slot="dropdown-menu-content"] [role="menuitem"]')]
      .find((item) => item.textContent.trim().startsWith(${JSON.stringify(label)}));
      if (!el) throw new Error(${JSON.stringify(`no export item ${label}`)}); el.click(); return true; })()`);
  await s("Page.enable");
  await s("Runtime.enable");
  await s("Page.addScriptToEvaluateOnNewDocument", { source: HOOK });
  await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  // The goldens are recorded in the light theme. The page's Auto theme follows the system's scheme, so the scheme is
  // set here, not taken from the machine (a Mac in Dark mode failed every step's "dark" field).
  await s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  // Every page starts from empty storage: the viewer keeps its menu choices in localStorage.
  await s("Storage.clearDataForOrigin", {
    origin: new URL(base).origin,
    storageTypes: "local_storage,session_storage",
  });
  await s("Page.navigate", { url: new URL(page.path, base).href });
  if (page.card === null) {
    await waitFor(
      `window.__gl.clear > 0 && document.getElementById("zoom-level").textContent !== ""`,
      "the first render",
    );
    await settle();
  } else {
    // The start screen draws its thumbnails one at a time, when idle: all of them are in before the start screen is read,
    // so no draw of a thumbnail lands in a later step.
    await waitFor(
      `document.querySelectorAll("#examples-grid .example").length > 0 && document.querySelectorAll("#examples-grid .thumb img").length === document.querySelectorAll("#examples-grid .example").length`,
      "the gallery's thumbnails",
      120000,
    );
    await record("home");
    await record("open-card", async () => {
      await clickJs(`[data-example="${page.card}"]`);
      await waitFor(
        `document.querySelector('[data-testid="page-title"]')?.textContent === ${JSON.stringify(page.card)} && window.__gl.clear > 0`,
        "the card's scene",
      );
    });
  }

  await record("default-view");
  await record("toggle-atoms", async () => {
    await openMainMenu();
    await clickMenuItem("Show", "Atoms");
  });
  await record("outline-bold", async () => {
    await openMainMenu();
    await clickMenuItem("Outline width", "Bold");
  });
  await record("lens-24", () => clickJs('#lens-group [data-lens="24"]'));
  await record("fit", () => clickJs('[aria-label="Fit to window"]'));
  await record("view-a", () => clickJs('[aria-label="Look along a"]'));

  // The selection: a click on the stage picks the object under it. The readout of a polyhedron names its centre, so the
  // click is repeated over a grid (nearest the middle first) until a polyhedron is picked; then its Center glides to it.
  const stage = await evaluate(`(() => { const r = document.getElementById("stage").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  const grid = [];
  for (const fy of [0.5, 0.35, 0.65, 0.2, 0.8]) for (const fx of [0.5, 0.35, 0.65, 0.2, 0.8]) grid.push([fx, fy]);
  grid.sort((a, b) => Math.hypot(a[0] - 0.5, a[1] - 0.5) - Math.hypot(b[0] - 0.5, b[1] - 0.5));
  const pickAt = async (fx, fy) => {
    const x = stage.left + stage.width * fx;
    const y = stage.top + stage.height * fy;
    await s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
    await sleep(100);
  };
  await record("select-and-centre", async () => {
    for (const [fx, fy] of grid) {
      await pickAt(fx, fy);
      if (await evaluate(`/\\bCentre/.test(document.getElementById("info-body").textContent)`)) break;
    }
    await clickJs("[data-center]");
  });

  // A dropped file is a new tab; the page shows it.
  await record("drop-second-scene", async () => {
    const text = await evaluate(`fetch(${JSON.stringify(new URL(droppedPath, base).href)}).then((r) => r.text())`);
    await evaluate(`(() => { const dt = new DataTransfer();
      dt.items.add(new File([${JSON.stringify(text)}], "dropped-ice-ih.json", { type: "application/json" }));
      window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true })); return true; })()`);
    await waitFor(
      `document.querySelector('[data-testid="page-title"]')?.textContent === "dropped-ice-ih.json"`,
      "the dropped scene",
    );
  });

  // An export makes one blob; the step reads the blob the click made (the count before the click tells which one), and
  // the status line (the toast) the export wrote. Its size and timing ("Saved view.svg (105 kB, 713 paths, 174 ms)") depend
  // on the renderer and the machine, so only the file name stays.
  const exportStep = async (name, label, kind) => {
    const before = await blobCount();
    await record(
      name,
      async () => {
        await openExportMenu();
        await pickExportItem(label);
        await waitFor(`!document.querySelector('[data-slot="dropdown-menu-content"]')`, "the export menu to shut");
      },
      async () => {
        await waitFor(`window.__blobs.length > ${before}`, `${kind} export`);
        const status = await evaluate(`document.getElementById("toast").textContent.replace(/ \\(.*$/, "")`);
        const blob = await evaluate(`(async () => { const b = window.__blobs[window.__blobs.length - 1];
        if (b.type === "image/svg+xml") return { type: b.type, text: await b.text() };
        const head = new DataView(await b.slice(0, 24).arrayBuffer());
        return { type: b.type, width: head.getUint32(16), height: head.getUint32(20) }; })()`);
        return blob.text !== undefined
          ? { status, svg: blob.text }
          : { status, png: { type: blob.type, width: blob.width, height: blob.height } };
      },
    );
  };
  await exportStep("export-svg", "SVG", "svg");
  await exportStep("export-png", "PNG", "png");
  // The theme, last: the theme button cycles Auto, Light, Dark, so two clicks make Dark. Both clicks run in one task, so the
  // canvas is drawn once in the dark colours (two tasks could let a frame draw between them). The page's data-theme and
  // the overlay's dark class follow it (after the exports, so the steps before it keep their pictures).
  await record("theme-dark", () =>
    evaluate(
      `(() => { const button = document.getElementById("theme-button"); button.click(); button.click(); return true; })()`,
    ),
  );
  // The layout, at the desktop width and at a phone's: the top bar's controls share a centre line, the page does not scroll
  // sideways, and the menu's panel lies on the screen (open, then shut again). Not a golden: it is read, not compared.
  const layout = {};
  for (const [name, width, height] of [
    ["desktop", 1280, 800],
    ["phone", 393, 852],
  ]) {
    await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 640 });
    await settle();
    const shut = await evaluate(LAYOUT);
    // The row unfolded (a phone starts with it folded): its controls are measured open, then it is folded again.
    const folded = await evaluate(`document.getElementById("view-toggle").getAttribute("aria-expanded") === "false"`);
    if (folded) {
      await clickJs("#view-toggle");
      await settle();
    }
    const unfolded = await evaluate(LAYOUT);
    if (folded) {
      await clickJs("#view-toggle");
      await settle();
    }
    await openMainMenu();
    const open = await evaluate(LAYOUT);
    await closeMainMenu();
    layout[name] = { shut, unfolded, open };
  }
  await s("Target.closeTarget", { targetId });
  return { steps, layout };
}

const browser = await connect(Number(portText));
try {
  await browser.send("Browser.setDownloadBehavior", { behavior: "deny" });
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const probe = await browser.send(
    "Runtime.evaluate",
    {
      expression: `(() => { const gl = document.createElement("canvas").getContext("webgl2");
        if (!gl) return null; const info = gl.getExtension("WEBGL_debug_renderer_info");
        return info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER); })()`,
      returnByValue: true,
    },
    sessionId,
  );
  const renderer = probe.result.value;
  await browser.send("Target.closeTarget", { targetId });
  if (!renderer) {
    console.error("WebGL 2 did not start");
    process.exitCode = 3;
  } else {
    const result = { renderer, pages: {} };
    for (const page of pages) result.pages[page.name] = await runPage(browser, page);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  }
} finally {
  browser.close();
}
