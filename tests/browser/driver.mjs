// The viewer's behaviour script, run by tests/test_browser.py in headless Chrome. This file is the shared harness: for each
// page it opens the page, runs the page's scenario (tests/browser/scenarios/<scenario>.mjs), then reads the layout at two
// widths. A page with a card (the hosted front page) first records the start screen (home), then opens the card's
// example. Each step is recorded as { name, draws, ...UI state }, where draws counts the WebGL clear and draw calls the
// step made; the two exports also carry their file (the SVG text, the PNG's size). The scenarios:
//   view   the viewer's steps on a scene (scenarios/view.mjs)
//   drops  the front page's drops of structure files (scenarios/drops.mjs)
//   alert  a single-file page's drop of a structure, which that page cannot compile (scenarios/alert.mjs)
//   panel  a structure tab and the style panel's edits on it (scenarios/panel.mjs)
//   structure  the structure a hosted site's card opened, with the style sections (scenarios/structure.mjs)
// Prints one JSON document on stdout. Exit code 3 means WebGL 2 did not start, so the caller can retry with software
// rendering.
//
// Usage: node driver.mjs <devtools-port> <base-url> <dropped-scene-path> <pages-json>
// where pages-json is a JSON array of { name, path, card, scenario }: path is under the base URL, card is the example a
// page opens from its start screen (null when the page opens on its scene), and scenario is one of the names above.
import { connect } from "./cdp.mjs";
import * as alert from "./scenarios/alert.mjs";
import * as closed from "./scenarios/closed.mjs";
import * as drops from "./scenarios/drops.mjs";
import * as panel from "./scenarios/panel.mjs";
import * as structure from "./scenarios/structure.mjs";
import * as view from "./scenarios/view.mjs";

const SCENARIOS = { view, drops, alert, panel, closed, structure };
const [portText, base, droppedPath, pagesText] = process.argv.slice(2);
const pages = JSON.parse(pagesText);

// Installed before each page loads. window.__gemmyTest is the test flag read by camera/view.ts (glides land at once).
// The WebGL counters count every clear and draw call. The instances are the instanced draws' instance counts since the
// last clear, so after a frame they are the frame's instances (the atoms and bonds, which are instanced). The export
// blobs are kept, so nothing is downloaded.
const HOOK = `(() => {
  window.__gemmyTest = true;
  window.__gl = { clear: 0, draw: 0, instances: 0 };
  const proto = WebGL2RenderingContext.prototype;
  const wrap = (name, counter) => {
    const original = proto[name];
    proto[name] = function (...args) { window.__gl[counter]++; return original.apply(this, args); };
  };
  // A frame starts with a colour clear. A depth-only clear (the triad's) keeps the frame's count.
  const clear = proto.clear;
  proto.clear = function (...args) {
    window.__gl.clear++;
    if (args[0] & 0x4000) window.__gl.instances = 0; // COLOR_BUFFER_BIT
    return clear.apply(this, args);
  };
  // drawElementsInstanced(mode, count, type, offset, instanceCount) and drawArraysInstanced(mode, first, count, instances).
  const instanced = (name, instancesArgument) => {
    const original = proto[name];
    proto[name] = function (...args) {
      window.__gl.draw++;
      window.__gl.instances += args[instancesArgument];
      return original.apply(this, args);
    };
  };
  instanced("drawElementsInstanced", 4);
  instanced("drawArraysInstanced", 3);
  for (const name of ["drawElements", "drawArrays"]) wrap(name, "draw");
  window.__blobs = [];
  const createObjectURL = URL.createObjectURL;
  URL.createObjectURL = function (blob) { window.__blobs.push(blob); return createObjectURL.call(URL, blob); };
})();`;

// The UI state the picture and the controls show, read from the page.
// The current file's name: the file island's trigger, or the page's title when the island shows the name as text.
const FILE_NAME = `(document.querySelector('[data-testid="file-trigger"]')?.textContent.trim() ?? document.querySelector('[data-testid="page-title"]')?.textContent ?? null)`;
const SNAP = `(() => ({
  title: ${FILE_NAME},
  // The file island (react/file-island.tsx): its file count, whether it is a menu (or the name as text), the start item's
  // label, and the chevrons drawn on the toolbar.
  files: Number(document.getElementById("file-island")?.dataset.files ?? 0),
  menu: document.getElementById("file-island")?.dataset.menu ?? null,
  plus: !!document.querySelector('[data-testid="new-tab-button"]'),
  // The toolbar's chevrons drawn now, and those drawn outside the toolbar island (#tools): none, ever.
  chevrons: [...document.querySelectorAll(".scroll-chevron")].filter((el) => el.getClientRects().length > 0).length,
  chevronsOutside: [...document.querySelectorAll(".scroll-chevron")].filter((el) => {
    if (el.getClientRects().length === 0) return false;
    const tools = document.getElementById("tools");
    if (!tools || tools.getClientRects().length === 0) return true;
    const a = el.getBoundingClientRect();
    const b = tools.getBoundingClientRect();
    return !(a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5);
  }).length,
  zoom: document.getElementById("zoom-level").textContent,
  theme: document.documentElement.dataset.theme ?? null,
  dark: document.documentElement.classList.contains("dark"),
  lensAria: [...document.querySelectorAll("#lens-group [data-lens]")].map((b) => [b.dataset.lens, b.getAttribute("aria-pressed")]),
  info: document.getElementById("info-body")?.textContent.slice(0, 300) ?? null,
}))()`;

// The menu's state, while it is open: the text of its items. Null when the menu is shut (its items are not in the page then).
const MENU = `(() => {
  const menu = document.getElementById("export-panel");
  if (!menu) return null;
  return { items: [...menu.querySelectorAll('[role="menuitem"]')].map((el) => el.textContent.trim()) };
})()`;

// The layout the test checks (tests/test_browser.py): the controls of the top bar (the menu island and the tool island)
// and their centre lines, the lens and zoom row's centre line, the page's sideways scroll, and
// the box round the menu's items (none when the menu is shut).
const LAYOUT = `(() => {
  const shown = (el) => el.getClientRects().length > 0;
  const centre = (el) => { const r = el.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
  const spread = (els) => { const ys = els.map(centre); return ys.length ? Math.max(...ys) - Math.min(...ys) : 0; };
  const shownAll = (selector) => [...document.querySelectorAll(selector)].filter(shown);
  const menuControls = shownAll("#file-island button, #file-island a");
  const toolControls = shownAll("#tools button");
  // The lens and zoom controls are one row from the aperture button: the lenses (scrolling), the zoom and fit.
  const rowControls = shownAll("#lens-column button, #lens-column output");
  const items = shownAll("#export-panel");
  // The file island and the toolbar island: the boxes that must not overlap. The file island's content is the union of its
  // visible descendants, so its slack (its width less its content and padding) shows whether it fits its content.
  const boxOf = (el) => {
    if (!el || !shown(el)) return null;
    const r = el.getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  };
  const toolsEdges = () => {
    const tools = document.getElementById("tools");
    if (!tools || !shown(tools)) return { left: false, right: false };
    return { left: tools.scrollLeft > 2, right: tools.scrollLeft + tools.clientWidth < tools.scrollWidth - 2 };
  };
  const fileIsland = document.getElementById("file-island");
  const fileContent = fileIsland ? shownAll("#file-island *") : [];
  const islandBox = boxOf(fileIsland);
  // The island's padding, and the margin of its last child (the + pill's own right space, which is not in its content).
  const lastChild = fileIsland?.lastElementChild;
  const padding = fileIsland
    ? parseFloat(getComputedStyle(fileIsland).paddingLeft) +
      parseFloat(getComputedStyle(fileIsland).paddingRight) +
      (lastChild ? parseFloat(getComputedStyle(lastChild).marginRight) : 0)
    : 0;
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
    // The file island's right end, by the SVG boxes: the chevron to the separator, the separator to the + icon, and the +
    // icon to the island's edge. The chevron's right padding is the button's, so the first gap is the chevron's own.
    spacing: (() => {
      const chevron = document.querySelector('[data-testid="file-trigger"] svg:last-of-type');
      const rule = document.querySelector('#file-island [role="separator"]');
      const icon = document.querySelector('[data-testid="new-tab-button"] svg');
      if (!chevron || !rule || !icon || !shown(icon)) return null;
      const c = chevron.getBoundingClientRect();
      const r = rule.getBoundingClientRect();
      const i = icon.getBoundingClientRect();
      return {
        chevronToRule: r.left - c.right,
        ruleToPlus: i.left - r.right,
        plusToEdge: document.getElementById("file-island").getBoundingClientRect().right - i.right,
      };
    })(),
    fileIsland: islandBox
      ? {
          ...islandBox,
          width: islandBox.right - islandBox.left,
          padding,
          content: Math.max(...fileContent.map((el) => el.getBoundingClientRect().right)) - Math.min(...fileContent.map((el) => el.getBoundingClientRect().left)),
        }
      : null,
    // The toolbar's edges with more hidden (its scroll position, as react/overflow.ts reads them) and the chevrons drawn on
    // them: each chevron's side, and whether it lies inside the toolbar island's box.
    toolsEdges: toolsEdges(),
    chevrons: shownAll(".scroll-chevron").map((el) => {
      const r = el.getBoundingClientRect();
      const t = document.getElementById("tools").getBoundingClientRect();
      return {
        side: el.classList.contains("scroll-chevron-left") ? "left" : "right",
        inside: r.left >= t.left - 0.5 && r.right <= t.right + 0.5 && r.top >= t.top - 0.5 && r.bottom <= t.bottom + 0.5,
      };
    }),
    tools: boxOf(document.getElementById("tools")),
    gap: parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--gap")),
  };
})()`;

// The page's reads for the drop scenarios: the card's error (the start screen's alert; null when the card shows none),
// whether the type form is shown, and the message line. The line (React, web/src/react/message-line.tsx) exists only while it shows,
// so "shown" is whether its element is there, and its actions are the buttons inside it.
const ALERT_TEXT = `document.querySelector('#home [role="alert"]')?.textContent || null`;
const FORM_SHOWN = `!!document.querySelector('[data-testid="type-map"]')`;
const TOAST_STATE = `(() => {
  const line = document.getElementById("message");
  const buttons = line ? [...line.querySelectorAll("button")] : [];
  return {
    shown: line !== null,
    text: line?.textContent ?? "",
    actions: buttons.map((button) => button.textContent),
  };
})()`;
// Drops files on the page as the browser does: the files (drop/<name>, served beside the pages) become File objects in a
// DataTransfer, and a drop event carries them to the window.
// `afterDrop` is script run in the same task right after the drop, so a switch in it happens before the load can finish.
const dropFilesScript = (names, afterDrop = "") => `(async () => {
  const transfer = new DataTransfer();
  for (const name of ${JSON.stringify(names)}) {
    const url = new URL("drop/" + name, ${JSON.stringify(base)});
    const text = await (await fetch(url)).text();
    transfer.items.add(new File([text], name, { type: "text/plain" }));
  }
  window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  ${afterDrop}
  return true;
})()`;

// The waits for the start screen (every thumbnail is in) and for a page's first render.
const GALLERY_READY = `document.querySelectorAll("#examples-grid .example").length > 0 && document.querySelectorAll("#examples-grid .thumb img").length === document.querySelectorAll("#examples-grid .example").length`;
// The first draw calls, not the first clear: a page can clear an empty frame before its scene is drawn, and the scene's
// draws must land before the first step's counters are read.
const FIRST_RENDER = `window.__gl.draw > 0 && document.getElementById("zoom-level").textContent !== ""`;
// The page has revealed: its first tab is shown and the fonts are in (main.ts drops body.booting two frames after that). The
// fonts are the redraws that come last: the triad's axis font redraws the page when it loads (render/triad.ts), and the
// reveal waits for document.fonts. Both land at a variable time, so a step waits for them before its counters start.
const PAGE_REVEALED = `!document.body.classList.contains("booting") && document.fonts.status === "loaded"`;

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
// How often a wait looks again, and how long a wait looks before it fails.
const POLL_MS = 100;
const WAIT_MS = 30000;
// The start screen's thumbnails are drawn one at a time, when idle, so they get a longer wait.
const GALLERY_WAIT_MS = 120000;
// How long the draw counters must hold still before a step is read (the page's timers fire within this).
const QUIET_MS = 200;
// The longest a step waits for the page to stop drawing.
const SETTLE_LIMIT_MS = 15000;
// The viewports the layout is read at: the desktop, and a phone (which starts with its lens row folded).
const LAYOUT_VIEWPORTS = [
  { name: "desktop", width: 1280, height: 800, mode: "wide" },
  { name: "phone", width: 393, height: 852, mode: "phone" },
];
// The page's layout mode follows the window's width (data-mode, ui/layout-modes.ts), which is where the page's phone width is
// read from. A phone is a touch device (Chrome's mobile emulation), turned on once the page says it is in the phone layout.
async function setViewport({ s, waitFor }, { width, height, mode }) {
  await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
  await waitFor(`document.documentElement.dataset.mode === ${JSON.stringify(mode)}`, `the ${mode} layout`);
  if (mode === "phone") await s("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
}

// The page's controls, each one a call on the page through `s` (a CDP method and its params) in the page's session.
function pageTools(s) {
  const evaluate = async (expression) => {
    const reply = await s("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (reply.exceptionDetails) {
      throw new Error(`page error: ${reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text}`);
    }
    return reply.result.value;
  };
  const waitFor = async (expression, what, limit = WAIT_MS) => {
    for (let waited = 0; waited < limit; waited += POLL_MS) {
      if (await evaluate(`!!(${expression})`)) return;
      await sleep(POLL_MS);
    }
    throw new Error(`timeout waiting for ${what}`);
  };
  const clickJs = (selector, index = 0) =>
    evaluate(`(() => { const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
      if (!el) throw new Error(${JSON.stringify(`no element ${selector} ${index}`)}); el.click(); return true; })()`);
  const glCounts = () => evaluate("({ ...window.__gl })");
  const drawCount = async () => (await glCounts()).draw;
  const blobCount = () => evaluate("window.__blobs.length");
  // Waits until the page stops drawing: the counters hold still for QUIET_MS.
  const settle = async () => {
    let last = "";
    let quietSince = Date.now();
    for (let waited = 0; waited < SETTLE_LIMIT_MS; waited += POLL_MS) {
      const now = JSON.stringify(await glCounts());
      if (now !== last) {
        last = now;
        quietSince = Date.now();
      } else if (Date.now() - quietSince >= QUIET_MS) return;
      await sleep(POLL_MS);
    }
    throw new Error("the page kept drawing");
  };
  // A press at the centre of an element, as a user's mouse makes it (the menu opens on a press, not a click).
  const mouseClick = async (selector) => {
    const { x, y } =
      await evaluate(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await s("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
    await s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  };
  // The dock is open (or shut): the page's data-dock says so at once, and the dock's slide (a CSS transition on the sidebar,
  // the stage, the island layer and the edge tab, --slide-duration) is finished. An idle headless page draws no frames, so its
  // transitions never advance by themselves: they are finished, which lands every element on its final box.
  const dockIsOpen = () => evaluate(`document.documentElement.dataset.dock === "open"`);
  const waitForDock = async (open) => {
    await waitFor(`document.documentElement.dataset.dock === ${JSON.stringify(open ? "open" : "shut")}`, `the dock to be ${open ? "open" : "shut"}`);
    await evaluate(`document.getAnimations().forEach((animation) => animation.finish())`);
  };
  // The export menu is shut by its button again, pressed with the mouse.
  const closeExportMenu = async () => {
    await mouseClick("#export-button");
    await waitFor(`!document.getElementById("export-panel")`, "the export menu to shut");
  };
  // The Export menu: a shadcn dropdown, opened by a press on its button (as the menu), and an item picked by its text
  // (an item's text is its label and its note, so the label is the start of it).
  const openExportMenu = async () => {
    await mouseClick("#export-button");
    await waitFor(`!!document.getElementById("export-panel")`, "the export menu to open");
  };
  const pickExportItem = (label) =>
    evaluate(`(() => { const el = [...document.querySelectorAll('[data-slot="dropdown-menu-content"] [role="menuitem"]')]
      .find((item) => item.textContent.trim().startsWith(${JSON.stringify(label)}));
      if (!el) throw new Error(${JSON.stringify(`no export item ${label}`)}); el.click(); return true; })()`);
  // A key pressed and released, as a keyboard sends it (the key's name, its code, its virtual key code, the text it types).
  const pressKey = async ({ key, code, keyCode, text = "" }) => {
    const press = { key, code, windowsVirtualKeyCode: keyCode, nativeVirtualKeyCode: keyCode };
    await s("Input.dispatchKeyEvent", { type: "keyDown", ...press, text });
    await s("Input.dispatchKeyEvent", { type: "keyUp", ...press });
  };
  return {
    evaluate,
    waitFor,
    pressKey,
    clickJs,
    glCounts,
    drawCount,
    blobCount,
    settle,
    mouseClick,
    waitForDock,
    dockIsOpen,
    openExportMenu,
    closeExportMenu,
    pickExportItem,
    dropFiles: (names, afterDrop) => evaluate(dropFilesScript(names, afterDrop)),
    alertText: () => evaluate(ALERT_TEXT),
    formShown: () => evaluate(FORM_SHOWN),
    toastState: () => evaluate(TOAST_STATE),
  };
}

// Runs one page: opens it, runs its start screen and its scenario, and reads the layout. Returns { steps, layout }.
async function runPage(browser, page) {
  const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
  const s = (method, params) => browser.send(method, params, sessionId);
  const tools = pageTools(s);
  const { evaluate, waitFor, waitForDock, dockIsOpen, clickJs, settle, glCounts, mouseClick, pressKey, openExportMenu, closeExportMenu } = tools;
  const steps = [];
  // Probes: checks a scenario makes after its recorded steps. They are returned beside the steps, never in them, so a probe
  // adds nothing to the goldens (tests/fixtures/browser), which hold the recorded steps only.
  const probes = {};
  // Runs one step: the page settles, the counters start, the action runs, the page settles, then the state is read.
  async function record(name, action = null, extra = null) {
    const started = Date.now();
    // The page is settled before the counters start, so a draw from the state before this step is not counted in it.
    await settle();
    const before = await glCounts();
    if (action) await action();
    await settle();
    const after = await glCounts();
    const state = await evaluate(SNAP);
    // The menu, when it is open for this step: its state is kept, and the menu is shut for the next step.
    const menu = await evaluate(MENU);
    if (menu) {
      state.menu = menu;
      await closeExportMenu();
    }
    const step = { name, draws: { clear: after.clear - before.clear, draw: after.draw - before.draw }, ...state };
    if (extra) Object.assign(step, await extra());
    steps.push(step);
    console.error(`${page.name} ${name} ${JSON.stringify(step.draws)} ${Date.now() - started} ms`);
  }
  const context = { ...tools, s, sleep, page, base, droppedPath, record, probes };

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

  // A page with a card opens on the start screen: the card's example is the first step's scene. A page without one
  // opens on its scene, so the wait is for its first render.
  const opensOnStartScreen = page.card !== null;
  if (opensOnStartScreen) {
    // The start screen draws its thumbnails one at a time, when idle: all of them are in before the start screen is read,
    // so no draw of a thumbnail lands in a later step.
    await waitFor(`(${GALLERY_READY}) && (${PAGE_REVEALED})`, "the start screen", GALLERY_WAIT_MS);
    await record("home");
    await record("open-card", async () => {
      await clickJs(`[data-example="${page.card}"]`);
      // A card opens its example's structure, titled by its file (ui/loader.ts showLoaded sets "gemmy: <name>").
      await waitFor(`document.title.startsWith("gemmy: ") && window.__gl.clear > 0`, "the card's scene");
    });
  } else {
    await waitFor(`(${FIRST_RENDER}) && (${PAGE_REVEALED})`, "the first render");
    await settle();
  }

  await SCENARIOS[page.scenario].run(context);
  const layout = await measureLayout({ s, evaluate, clickJs, settle, waitFor, waitForDock, dockIsOpen, mouseClick, pressKey, openExportMenu, closeExportMenu });
  await s("Target.closeTarget", { targetId });
  return { steps, layout, probes };
}

// The top bar's two rows with the dock open (below 1560 px the views toolbar takes its own row): the toolbar's controls and
// the title row's (the menu island and the Export area), each with its box and the spread of its centre lines.
const ROWS = `(() => {
  const shown = (el) => el.getClientRects().length > 0;
  const boxOf = (els) => {
    const rects = els.filter(shown).map((el) => el.getBoundingClientRect());
    if (rects.length === 0) return null;
    const centres = rects.map((r) => (r.top + r.bottom) / 2);
    return {
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
      spread: Math.max(...centres) - Math.min(...centres),
    };
  };
  return {
    tools: boxOf([...document.querySelectorAll("#tools button")]),
    title: boxOf([...document.querySelectorAll("#file-island button, #file-island a, #export-area button")]),
  };
})()`;

// The media conditions of the rules that peek the edge tab (a translate-x of 4 px), read from the page's stylesheets. A touch
// screen has no hover, so the peek must sit in a hover media rule. (This browser's device emulation does not change hover, so
// the rule is read rather than a touch press.) "" is the rule's own, unconditioned, place.
const PEEK_MEDIA = `(() => {
  const found = [];
  const walk = (rules, media) => {
    for (const rule of rules) {
      if (rule.style) {
        if (rule.style.getPropertyValue("--tw-translate-x") === "4px") found.push(media);
      } else if (rule.cssRules) {
        walk(rule.cssRules, rule.conditionText ?? media);
      }
    }
  };
  // A cross-origin sheet (a font's) has no readable rules: it is skipped.
  for (const sheet of document.styleSheets) {
    try { walk(sheet.cssRules, ""); } catch (error) { /* cross-origin */ }
  }
  return found;
})()`;

// The edge tab (react/inspector-toggle.tsx) as the desktop reads it: its box, the viewport's width, its icons (their Lucide
// names and widths), whether a point at the screen's last pixel column is the tab (its hit area reaches the edge), whether
// it has keyboard focus-visible, and the dock's left edge (null when the dock is shut).
const EDGE_TAB = `(() => {
  const tab = document.getElementById("inspector-tab");
  const r = tab.getBoundingClientRect();
  const dock = document.getElementById("inspector");
  return {
    box: { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height },
    viewportWidth: innerWidth,
    icons: [...tab.querySelectorAll("svg")].map((svg) => ({
      name: [...svg.classList].find((name) => name.startsWith("lucide-")) ?? null,
      width: svg.getBoundingClientRect().width,
    })),
    hitAtEdge: tab.contains(document.elementFromPoint(innerWidth - 1, (r.top + r.bottom) / 2)),
    focusVisible: tab.matches(":focus-visible"),
    dock: dock && document.documentElement.dataset.dock === "open" ? dock.getBoundingClientRect().left : null,
  };
})()`;

// The edge tab at the desktop width, with the dock shut: at rest (the pointer away), on hover, on keyboard focus, and open.
// The dock is shut again at the end, so the phone reads it shut.
async function measureEdgeTab({ s, evaluate, mouseClick, pressKey, waitFor, waitForDock }) {
  // The slide is a CSS transition (translate, 150 ms), which an idle page may not advance: a read can catch its start. So a
  // read first finishes the tab's running transitions, which lands it on its final position (the duration is checked too).
  const finishSlides = () =>
    evaluate(`document.getElementById("inspector-tab").getAnimations().forEach((animation) => animation.finish())`);
  const pointerTo = async (x, y) => {
    await s("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
    await finishSlides();
  };
  const pointerAway = () => pointerTo(600, 400);
  const tabCentre = () =>
    evaluate(`(() => { const r = document.getElementById("inspector-tab").getBoundingClientRect();
      return { x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 }; })()`);
  const edge = {};
  await pointerAway();
  edge.rest = await evaluate(EDGE_TAB);
  const { x, y } = await tabCentre();
  await pointerTo(x, y);
  edge.hover = await evaluate(EDGE_TAB);
  await pointerAway();
  // A key press makes the next focus a keyboard one (focus-visible).
  await pressKey({ key: "Shift", code: "ShiftLeft", keyCode: 16 });
  await evaluate(`document.getElementById("inspector-tab").focus()`);
  await finishSlides();
  edge.focused = await evaluate(EDGE_TAB);
  await evaluate(`document.getElementById("inspector-tab").blur()`);
  await finishSlides();
  edge.peekMedia = await evaluate(PEEK_MEDIA);
  await mouseClick("#inspector-tab");
  await waitForDock(true);
  await finishSlides();
  edge.open = await evaluate(EDGE_TAB);
  await mouseClick("#inspector-tab");
  await waitForDock(false);
  return edge;
}

// The layout at each viewport: read with the dock shut (its toggle shuts it), then the lens row unfolded (a phone starts
// with it folded, and it is folded again after), then with the menu open. The desktop is also read with the dock open,
// where the top bar's rows are measured (ROWS). Not a golden: the layout is read, not compared.
async function measureLayout({ s, evaluate, clickJs, settle, waitFor, waitForDock, dockIsOpen, mouseClick, pressKey, openExportMenu, closeExportMenu }) {
  const layout = {};
  for (const viewport of LAYOUT_VIEWPORTS) {
    await setViewport({ s, waitFor }, viewport);
    await settle();
    if (await dockIsOpen()) {
      await mouseClick('#inspector-tab');
      await waitForDock(false);
      await settle();
    }
    const shut = await evaluate(LAYOUT);
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
    await openExportMenu();
    const open = await evaluate(LAYOUT);
    await closeExportMenu();
    layout[viewport.name] = { shut, unfolded, open };
    if (viewport.name === "desktop") {
      await mouseClick('#inspector-tab');
      await waitForDock(true);
      await settle();
      layout[viewport.name].dock = await evaluate(ROWS);
      await mouseClick('#inspector-tab');
      await waitForDock(false);
      await settle();
    }
  }
  // Last, so its desktop emulation and its pointer leave nothing behind for the viewports above.
  await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await settle();
  layout.desktop.edgeTab = await measureEdgeTab({ s, evaluate, mouseClick, pressKey, waitFor, waitForDock });
  return layout;
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
