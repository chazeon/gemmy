// The viewer's steps on a scene: the View section's checks and outline width, the lens, fit and look along a, a selection that
// centres a polyhedron, a dropped second scene (a tab), the SVG and PNG exports, and the theme last, so the steps before
// it keep their pictures. Every page with a scene runs these, except the drop scenarios.

// The stage points a selection tries, as fractions of the stage's width and height; the middle is tried first.
const SELECTION_FRACTIONS = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];
const MIDDLE_FRACTION = 0.5;
// The pause after a press, so the picked object's readout is drawn before the next press.
const PICK_PAUSE_MS = 100;
// How long the phone step waits for its focus to move (the drawn customize button, ui/panels.ts), and how often it looks.
const PHONE_FOCUS_MS = 2000;
const PHONE_POLL_MS = 100;
// The PNG header holds the image's width and height as 32-bit integers at these byte offsets (the IHDR chunk).
const PNG_HEADER_BYTES = 24;
const PNG_WIDTH_OFFSET = 16;
const PNG_HEIGHT_OFFSET = 20;

const STAGE_RECT = `(() => {
  const rect = document.getElementById("stage").getBoundingClientRect();
  return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
})()`;
// The readout of a polyhedron has a Mean row (an atom's and a bond's do not). Its labels run into their values ("Mean1.776").
const CENTRE_SHOWN = String.raw`/Mean/.test(document.getElementById("info-body")?.textContent ?? "")`;
// Both clicks run in one task, so the canvas is drawn once in the dark colours (two tasks could let a frame draw between
// them). The theme button cycles Auto, Light, Dark, so two clicks make Dark.
const THEME_TWICE = `(() => {
  const button = document.getElementById("theme-button");
  button.click();
  button.click();
  return true;
})()`;
// The status line the export wrote, without its size and timing ("Saved view.svg (105 kB, 713 paths, 174 ms)").
const EXPORT_STATUS = String.raw`document.getElementById("message").textContent.replace(/ \(.*$/, "")`;
// The blob the last click made: an SVG's text, or a PNG's width and height read from its header.
const LAST_BLOB = `(async () => {
  const blob = window.__blobs[window.__blobs.length - 1];
  if (blob.type === "image/svg+xml") return { type: blob.type, text: await blob.text() };
  const header = new DataView(await blob.slice(0, ${PNG_HEADER_BYTES}).arrayBuffer());
  return { type: blob.type, width: header.getUint32(${PNG_WIDTH_OFFSET}), height: header.getUint32(${PNG_HEIGHT_OFFSET}) };
})()`;

// The dock's View section (react/style-panel/view-section.tsx): its checkboxes and its outline-width list, drawn by Tweakpane.
// A row is found by its label. The dock opens at its tab on a wide screen when it is shut; a scene opens with it as it was left.
const VIEW_ROW = (label) =>
  `[...document.querySelectorAll("#inspector .tp-lblv")].find((row) => row.querySelector(".tp-lblv_l")?.textContent.trim() === ${JSON.stringify(label)})`;

async function openViewSection({ evaluate, mouseClick, waitFor }) {
  if (!(await evaluate(`!!${VIEW_ROW("Atoms")}`))) {
    await mouseClick('#inspector-tab');
    await waitFor(`!!${VIEW_ROW("Atoms")}`, "the dock's View section");
  }
}

async function clickViewCheck({ evaluate }, label) {
  await evaluate(`(() => { const input = ${VIEW_ROW(label)}?.querySelector('input[type="checkbox"]');
    if (!input) throw new Error(${JSON.stringify(`no View check ${label}`)}); input.click(); return true; })()`);
}

async function chooseViewWidth({ evaluate }, text) {
  await evaluate(`(() => { const select = ${VIEW_ROW("Outline width")}?.querySelector("select");
    const option = select && [...select.options].find((o) => o.textContent.trim() === ${JSON.stringify(text)});
    if (!option) throw new Error(${JSON.stringify(`no outline width ${text}`)});
    select.value = option.value; select.dispatchEvent(new Event("change", { bubbles: true })); return true; })()`);
}

// The View section's values as the panel shows them: the three checks, and the outline width's text.
async function viewValues({ evaluate }) {
  return evaluate(`(() => {
    const checks = Object.fromEntries(["Atoms", "Outlines", "Cell box"].map((label) => {
      const row = [...document.querySelectorAll("#inspector .tp-lblv")]
        .find((r) => r.querySelector(".tp-lblv_l")?.textContent.trim() === label);
      return [label, row?.querySelector('input[type="checkbox"]')?.checked ?? null];
    }));
    const width = ${VIEW_ROW("Outline width")}?.querySelector("select");
    return { checks, width: width ? width.options[width.selectedIndex].textContent.trim() : null };
  })()`);
}

export async function run(context) {
  const { record, clickJs, evaluate, mouseClick, waitFor, openExportMenu } = context;
  await record("default-view");
  await record(
    "toggle-atoms",
    async () => {
      await openViewSection(context);
      await clickViewCheck(context, "Atoms");
    },
    () => viewValues(context),
  );
  await record(
    "outline-bold",
    async () => {
      await openViewSection(context);
      await chooseViewWidth(context, "Bold");
    },
    () => viewValues(context),
  );
  await record("lens-24", () => clickJs('#lens-group [data-lens="24"]'));
  await record("fit", () => clickJs('[aria-label="Fit to window"]'));
  await record("view-a", () => clickJs('[aria-label="Look along a"]'));
  // The pick is made before the step: the points tried before the polyhedron is hit vary the frames the pick draws, so the
  // step records only the Centre press, whose frames do not vary (the pick's are settled before its count starts).
  await pickPolyhedron(context);
  await record("select-and-centre", () => centreSelected(context));
  await record("drop-second-scene", () => dropSecondScene(context));
  await exportStep(context, "export-svg", "SVG", "svg");
  await exportStep(context, "export-png", "PNG", "png");
  await record("theme-dark", () => evaluate(THEME_TWICE));
  // The i key toggles the details card on a scene, as the details button does: each press flips the button's state.
  const I_KEY = { key: "i", code: "KeyI", keyCode: 73, text: "i" };
  const DETAILS_EXPANDED = `document.getElementById("details-button")?.getAttribute("aria-expanded")`;
  await record("details-key-first", () => context.pressKey(I_KEY), async () => ({ expanded: await evaluate(DETAILS_EXPANDED) }));
  await record("details-key-second", () => context.pressKey(I_KEY), async () => ({ expanded: await evaluate(DETAILS_EXPANDED) }));
  // Crossing to phone width with the card and the dock both open: the dock, opened last, stays and the card shuts, and the
  // focus on the edge tab (hidden on a phone) moves to the customize button. The window is restored after the step.
  const DOCK_OPEN = `document.documentElement.dataset.dock === "open"`;
  const EDGE_TAB = `#inspector-tab`;
  const SHEETS_FOCUS = `document.activeElement?.id ?? null`;
  const SHEETS = `(() => ({
    details: document.getElementById("details-button")?.getAttribute("aria-expanded") ?? null,
    dock: ${DOCK_OPEN},
    focus: document.activeElement?.id ?? null,
  }))()`;
  await record(
    "sheets-both-open",
    async () => {
      if (await evaluate(DOCK_OPEN)) {
        await context.mouseClick(EDGE_TAB);
        await context.waitForDock(false);
      }
      if ((await evaluate(DETAILS_EXPANDED)) !== "true") await context.pressKey(I_KEY);
      await context.mouseClick(EDGE_TAB);
      await context.waitForDock(true);
      await evaluate(`document.getElementById("inspector-tab")?.focus()`);
    },
    async () => evaluate(SHEETS),
  );
  await record(
    "sheets-phone",
    async () => {
      await context.s("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
      await context.settle();
      // The focus moves once the phone button is drawn (ui/panels.ts), a frame or so after the change: poll for it, briefly.
      for (let waited = 0; waited < PHONE_FOCUS_MS; waited += PHONE_POLL_MS) {
        if ((await evaluate(SHEETS_FOCUS)) === "customize-button") break;
        await context.sleep(PHONE_POLL_MS);
      }
    },
    async () => evaluate(SHEETS),
  );
  await record(
    "sheets-wide-again",
    async () => {
      await context.s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await context.settle();
    },
    async () => ({}),
  );
  // The file menu with three files (the scene, and two dropped ones): the menu lists the three with the current one
  // checked, and its start item reads New tab (no start screen is open yet).
  const FILE_ITEMS = `[...document.querySelectorAll('#file-panel [data-testid="file-item"]')].map((el) => ({ label: el.dataset.label, checked: el.getAttribute("aria-current") === "true" }))`;
  const FILE_NAME_NOW = `(document.querySelector('[data-testid="file-trigger"]')?.textContent.trim() ?? null)`;
  const FILES_NOW = `Number(document.getElementById("file-island").dataset.files)`;
  const MENU_SHUT = `!document.getElementById("file-panel")`;
  const labels = [];
  await record(
    "files-three",
    () => dropSecondScene(context, "third-ice-ih.json", 3),
    async () => {
      await openFileMenu(context);
      const state = { items: await evaluate(FILE_ITEMS) };
      labels.push(...state.items.map((item) => item.label));
      await context.pressKey({ key: "Escape", code: "Escape", keyCode: 27 });
      await waitFor(MENU_SHUT, "the file menu to shut");
      return state;
    },
  );
  // Closing a file that is not the last one makes its right neighbour current, and the focus goes back to the trigger.
  await record(
    "files-close-middle",
    async () => {
      await openFileMenu(context);
      await context.clickJs(`[data-testid="file-item"][data-label=${JSON.stringify(labels[1])}]`);
      await openFileMenu(context);
      // The page is quiet before the close, so the draws counted from here are the neighbour's: its scene is loaded and drawn
      // after the close, and the step waits for that first frame (the draw count rises) and for the page to stop drawing.
      await context.settle();
      const drawsBefore = await evaluate(`window.__gl.draw`);
      await context.clickJs(`[aria-label=${JSON.stringify(`Close ${labels[1]}`)}]`);
      await waitFor(MENU_SHUT, "the file menu to shut");
      await waitFor(`(document.querySelector('[data-testid="file-trigger"]')?.textContent.trim() ?? null) === ${JSON.stringify(labels[2])}`, "the neighbour's file to show");
      await waitFor(`window.__gl.draw > ${drawsBefore}`, "the neighbour's first frame");
      await context.settle();
    },
    async () => ({
      file: await evaluate(FILE_NAME_NOW),
      files: await evaluate(FILES_NOW),
      focus: await evaluate(`document.activeElement?.dataset.testid ?? null`),
    }),
  );
  // The "+" opens the start screen: with three files and none open, it adds one (four files), and the file button then
  // reads New tab.
  await record(
    "files-start",
    async () => {
      await context.clickJs('[data-testid="new-tab-button"]');
      await waitFor(`document.title === "gemmy"`, "the start screen");
    },
    async () => ({
      title: await evaluate(`document.querySelector('[data-testid="file-trigger"]')?.textContent.trim() ?? null`),
      files: await evaluate(FILES_NOW),
    }),
  );
  // The page ends on a file again, as the layout is read on a scene (the start screen has no lens row or tools).
  await record("files-back", async () => {
    await openFileMenu(context);
    await context.clickJs(`[data-testid="file-item"][data-label=${JSON.stringify(labels[0])}]`);
    await waitFor(`!document.getElementById("file-panel")`, "the file menu to shut");
  }, async () => ({ title: await evaluate(FILE_NAME_NOW) }));
  // The Export menu leads with Copy link, and lists no New tab. It is read on a scene: its button is hidden on the start screen.
  await record("menu-start", openExportMenu);
}

// The file menu opens on a pointer press on its trigger (Radix opens its menus on pointerdown, not on click).
async function openFileMenu({ evaluate, waitFor }) {
  await evaluate(`document.querySelector('[data-testid="file-trigger"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))`);
  await waitFor(`!!document.getElementById("file-panel")`, "the file menu");
}

// A click on the stage picks the object under it, and the pick opens the details card (react/selection-card.tsx). The
// readout of a polyhedron names its centre, so the click is repeated over the grid until a polyhedron is picked; then the
// card's Center button glides to it.
async function pickPolyhedron(context) {
  const { evaluate } = context;
  // The look along a has turned the view: the fit brings the whole scene back to the window before the points are tried.
  await evaluate(`document.querySelector('[aria-label="Fit to window"]').click()`);
  const stage = await evaluate(STAGE_RECT);
  let picked = false;
  for (const [fx, fy] of selectionPoints()) {
    await pressAt(context, stage, fx, fy);
    if (await evaluate(CENTRE_SHOWN)) {
      picked = true;
      break;
    }
  }
  if (!picked) throw new Error("no point of the stage picked the polyhedron");
}

// The details card's Center button glides to the picked polyhedron.
async function centreSelected({ evaluate }) {
  await evaluate(`document.querySelector('#info [aria-label="Center and fit this object"]').click()`);
}

// The grid's points, nearest the middle first (the sort keeps the grid's order for points at the same distance).
function selectionPoints() {
  const points = [];
  for (const fy of SELECTION_FRACTIONS) for (const fx of SELECTION_FRACTIONS) points.push([fx, fy]);
  return points.sort((a, b) => distanceToMiddle(a) - distanceToMiddle(b));
}

function distanceToMiddle([fx, fy]) {
  return Math.hypot(fx - MIDDLE_FRACTION, fy - MIDDLE_FRACTION);
}

// A press and a release at a point of the stage, as a mouse makes them.
async function pressAt({ s, sleep }, stage, fx, fy) {
  const x = stage.left + stage.width * fx;
  const y = stage.top + stage.height * fy;
  await s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(PICK_PAUSE_MS);
}

// A dropped file is a new file; the page shows it. The scene file is read from the server and dropped under the name
// (dropped-ice-ih.json by default); the wait is for the file island to count `files` files and show the name.
async function dropSecondScene({ evaluate, waitFor, base, droppedPath }, name = "dropped-ice-ih.json", files = 2) {
  const url = new URL(droppedPath, base).href;
  const text = await evaluate(`fetch(${JSON.stringify(url)}).then((response) => response.text())`);
  await evaluate(`(() => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([${JSON.stringify(text)}], ${JSON.stringify(name)}, { type: "application/json" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await waitFor(
    `document.getElementById("file-island")?.dataset.files === ${JSON.stringify(String(files))} && (document.querySelector('[data-testid="file-trigger"]')?.textContent.trim() ?? document.querySelector('[data-testid="page-title"]')?.textContent) === ${JSON.stringify(name)}`,
    "the dropped scene",
  );
}

// An export makes one blob. The step reads the blob that its click made (the count before the click tells which one),
// and the status line the export wrote. The file's size and timing depend on the renderer and the machine, so only the
// file name stays in the status.
async function exportStep(context, name, label, kind) {
  const { record, evaluate, waitFor, blobCount, openExportMenu, pickExportItem } = context;
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
      const status = await evaluate(EXPORT_STATUS);
      const blob = await evaluate(LAST_BLOB);
      return blob.text !== undefined
        ? { status, svg: blob.text }
        : { status, png: { type: blob.type, width: blob.width, height: blob.height } };
    },
  );

}
