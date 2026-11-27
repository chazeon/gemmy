// The inspector dock's style sections on a structure tab: the stishovite POSCAR dropped with its config, then the edits
// made in the Tweakpane panes of the dock. Every edit is typed into a field or pressed on a button, as a user does, and
// each accepted edit is waited on (the frame drawn, the dock's compile ended) before the step's counts are read. The
// counts are the instances the frame drew (window.__gl.instances): the atoms and the bonds are instanced, so the frame's
// count follows them, and a bond window's change is the change in the bond count (the atoms do not move).
//
// The steps: the polyhedron's colour is set to green; a bond rule is added and its window narrowed and widened; the
// supercell goes to 2 x 2 x 2 and then 1 x 1 x 1; a supercell over the atom budget is refused with a note and the
// previous value stays; a section folds and unfolds with the dock's rectangle unchanged; and the config is exported as
// TOML and as JSON, the downloads read back as text; a step lowers the polyhedron's alpha to 0.5 in the picker.
// The key a field commits on (Tweakpane's text fields commit on Enter).
const ENTER = { key: "Enter", code: "Enter", keyCode: 13, text: "\r" };
const INSTANCES = "window.__gl.instances";
const TOAST_TEXT = `(document.getElementById("message")?.textContent ?? "")`;
const BUDGET_NOTE = "the page compiles at most";
const SECTION_TRIGGER = (title) =>
  `[...document.querySelectorAll('#inspector [data-slot="collapsible-trigger"]')].find((b) => b.querySelector("span.truncate")?.textContent.trim() === ${JSON.stringify(title)})`;
const POLYHEDRON = "Si (O) · polyhedron";
// A box is settled when it has held still for STILL_TICKS polls, SETTLE_TICK_MS apart.
const STILL_TICKS = 3;
const SETTLE_TICK_MS = 60;
const BOND = "O–Si";
// The Cell section's supercell: one folder, with the three counts in one row (a, b, c in order).
const SUPERCELL_FOLDER = "Supercell";
const SUPERCELL_ROW = "Count";
const SUPERCELL_INDEX = { a: 0, b: 1, c: 2 };
// The stage points a phone tap tries, as fractions of the stage: the middle first, then outwards.
const TAP_POINTS = [
  [0.5, 0.5], [0.4, 0.45], [0.6, 0.55], [0.3, 0.4], [0.7, 0.6], [0.5, 0.3], [0.5, 0.7], [0.3, 0.6], [0.7, 0.4],
];
const STAGE_RECT = `(() => { const r = document.getElementById("stage").getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`;

// Tweakpane's folder by its title, and a row of a folder by its label (Tweakpane's markup: .tp-fldv, .tp-fldv_t, .tp-lblv_l).
const folder = (title) =>
  `[...document.querySelectorAll("#inspector .tp-fldv")].find((f) => f.querySelector(".tp-fldv_t")?.textContent.trim() === ${JSON.stringify(title)})`;
const row = (folderTitle, label) =>
  `[...(${folder(folderTitle)}).querySelectorAll(".tp-lblv")].find((r) => r.querySelector(".tp-lblv_l")?.textContent.trim() === ${JSON.stringify(label)})`;
// A row's number fields, by what they hold: a colour's components, an interval's ends, a number. The colour's text view
// (which holds the object) and the selects are left out, and so is any control that is not a number's text.
const field = (folderTitle, label, index = 0) =>
  `[...(${row(folderTitle, label)}).querySelectorAll("input")].filter((i) => /^-?[0-9.]+$/.test(i.value))[${index}]`;
const fieldValue = (folderTitle, label, index = 0) => `(${field(folderTitle, label, index)}).value`;

// A press and a release at the centre of an element, as a mouse makes them (a button, a field, a folder's fold). The
// element is pressed once its box has stopped moving: Tweakpane and the dock animate their folds and sections, so a press
// on a box still in motion would land on whatever is under it then.
async function pressElement({ s, evaluate }, expression) {
  // A box below the dock's visible part is scrolled into view first (the dock scrolls), as a user would scroll to it.
  await evaluate(`(${expression}).scrollIntoView({ block: "nearest" })`);
  const settled = await evaluate(`(async () => {
    let previous = "";
    let still = 0;
    for (let tick = 0; tick < 100; tick++) {
      const r = (${expression}).getBoundingClientRect();
      const box = [r.left, r.top, r.width, r.height].join(",");
      still = box === previous && r.height > 0 ? still + 1 : 0;
      if (still >= STILL_TICKS) return true;
      previous = box;
      await new Promise((ok) => setTimeout(ok, SETTLE_TICK_MS));
    }
    return false;
  })()`.replaceAll("STILL_TICKS", String(STILL_TICKS)).replaceAll("SETTLE_TICK_MS", String(SETTLE_TICK_MS)));
  if (!settled) throw new Error(`no settled box to press: ${expression.slice(0, 120)}`);
  const { x, y } = await evaluate(`(() => { const r = (${expression}).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await s("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  await s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
}

// A tap at a point of the stage, as a finger makes it: a press and a release at one place.
async function tapAt({ s, sleep }, stage, fx, fy) {
  const x = stage.left + stage.width * fx;
  const y = stage.top + stage.height * fy;
  await s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(100);
}

// A folder open, if it is shut (Tweakpane's fold is its title's button). Tweakpane animates the fold, and the folder's
// class is set before its body is drawn, so this waits until the body's height is above zero and holds still.
async function openFolder(context, title) {
  const expanded = await context.evaluate(`(${folder(title)}).classList.contains("tp-fldv-expanded")`);
  if (!expanded) await pressElement(context, `(${folder(title)}).querySelector(".tp-fldv_b")`);
  const drawn = await context.evaluate(`(async () => {
    const body = (${folder(title)}).querySelector(".tp-fldv_c");
    let last = -1;
    for (let tick = 0; tick < 100; tick++) {
      const height = body.getBoundingClientRect().height;
      if (height > 0 && height === last) return true;
      last = height;
      await new Promise((ok) => setTimeout(ok, 50));
    }
    return false;
  })()`);
  if (!drawn) {
    const state = await context.evaluate(
      `(() => { const f = (${folder(title)}); const b = f.querySelector(".tp-fldv_c"); return JSON.stringify({ cls: f.className, body: b && b.getBoundingClientRect().height, scroll: b && b.scrollHeight, kids: b && b.children.length, tags: [...f.children].map((c) => c.className).join(" ; ") }); })()`,
    );
    throw new Error(`the ${title} folder did not open: ${state}`);
  }
}

// A colour's picker, opened by a press on its swatch (a click from script does not open it): its number fields (the rgb
// components, 0 to 255) are in the picker's popover, which is drawn while it is open (the popover's class says so).
async function openColourPicker(context, folderTitle, label) {
  const shut = await context.evaluate(
    `!(${row(folderTitle, label)}).querySelector(".tp-popv").classList.contains("tp-popv-v")`,
  );
  if (shut) await pressElement(context, `(${row(folderTitle, label)}).querySelector(".tp-colswv_b")`);
  await context.waitFor(
    `(${row(folderTitle, label)}).querySelector(".tp-popv").getBoundingClientRect().height > 0`,
    `the ${label} picker to open`,
  );
}

// A field's text is typed: the field is pressed (focus), its text selected and replaced. Nothing commits yet.
async function enterText(context, expression, text) {
  await pressElement(context, expression);
  await context.evaluate(`(${expression}).select()`);
  await context.s("Input.insertText", { text });
}

// An accepted edit: Enter commits it, and the frame is drawn again once the dock's compile has run. The draw count is read
// after the typing, so a draw the press itself made is not taken for the edit's.
async function commitField(context, expression, text) {
  await enterText(context, expression, text);
  const before = await context.drawCount();
  await context.pressKey(ENTER);
  await context.waitFor(`window.__gl.draw > ${before}`, `the scene after ${text}`);
  await waitCompiled(context);
}

// A refused edit: the note says why and the field shows its previous value again. The scene is checked by the caller.
async function refuseField(context, expression, text, previous) {
  await enterText(context, expression, text);
  await context.pressKey(ENTER);
  await context.waitFor(`${TOAST_TEXT}.includes(${JSON.stringify(BUDGET_NOTE)})`, "the budget note");
  await context.waitFor(`(${expression}).value === ${JSON.stringify(previous)}`, "the field's previous value");
}

// Drops files fetched from the drop folder (driver.mjs's drop/): each is [path under drop/, the name it is dropped as].
async function dropNamed({ evaluate, base, drawCount, waitFor }, files) {
  const before = await drawCount();
  await evaluate(`(async () => {
    const transfer = new DataTransfer();
    for (const [path, name] of ${JSON.stringify(files)}) {
      const text = await (await fetch(new URL("drop/" + path, ${JSON.stringify(base)}))).text();
      transfer.items.add(new File([text], name, { type: "text/plain" }));
    }
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
    return true;
  })()`);
  await waitFor(`window.__gl.draw > ${before}`, "the dropped structure's scene");
}

// The keyboard's commit: the field is focused, its text replaced, and Enter commits (a field in the picker's popover is
// focused from script, since its position is under the dock's header on some layouts).
async function commitField2(context, expression, text) {
  await context.evaluate(`(${expression}).select()`);
  await context.s("Input.insertText", { text });
  const before = await context.drawCount();
  await context.pressKey(ENTER);
  await context.waitFor(`window.__gl.draw > ${before}`, `the scene after ${text}`);
  await waitCompiled(context);
}

async function waitCompiled({ waitFor }) {
  await waitFor(`!document.querySelector("#inspector[data-compiling]")`, "the dock's compile to end");
}

// The frame's instance count, read after the scene is drawn. A step that changes the atoms or the bonds reads it here.
async function instances({ evaluate }) {
  return evaluate(INSTANCES);
}

// The supercell's field on one axis, and the three counts read back.
const supercellField = (axis) => field(SUPERCELL_FOLDER, SUPERCELL_ROW, SUPERCELL_INDEX[axis]);
const supercellValues = (context) =>
  context.evaluate(
    `[${Object.keys(SUPERCELL_INDEX)
      .map((axis) => fieldValue(SUPERCELL_FOLDER, SUPERCELL_ROW, SUPERCELL_INDEX[axis]))
      .join(", ")}]`,
  );

// Sets each lattice vector's supercell count to a target (an axis that is already there is not typed).
async function setSupercell(context, targets) {
  for (const [axis, count] of targets) {
    const current = await context.evaluate(fieldValue(SUPERCELL_FOLDER, SUPERCELL_ROW, SUPERCELL_INDEX[axis]));
    if (Number(current) === count) continue;
    await commitField(context, supercellField(axis), String(count));
  }
}

export async function run(context) {
  const { record, dropFiles, waitFor, evaluate, openExportMenu, pickExportItem, blobCount, drawCount, s, settle, sleep, waitForDock } = context;

  await record("drop-structure", async () => {
    const before = await drawCount();
    await dropFiles(["POSCAR", "config.toml"]);
    await waitFor(`window.__gl.draw > ${before}`, "the dropped POSCAR and config's scene");
    await waitFor(`!!(${folder(POLYHEDRON)})`, "the structure's shapes in the dock");
  });

  // The edge tab opens the dock; the sections are the dock's own, and the panes are Tweakpane's.
  await record(
    "open-style",
    async () => {
      // The one inspector toggle opens the dock (it may already be open, as a scene left it): the sections are on the dock.
      if (!(await evaluate(`document.documentElement.dataset.dock === "open"`))) {
        await pressElement(context, `document.querySelector('#inspector-tab')`);
      }
      await waitFor(`!!document.querySelector("#inspector .style-pane")`, "the style sections");
    },
    async () => ({
      sections: await evaluate(
        `[...document.querySelectorAll('#inspector [data-slot="collapsible-trigger"] span.truncate')].map((s) => s.textContent.trim())`,
      ),
      instances: await instances(context),
    }),
  );

  // The polyhedron's colour, typed into its red, green, blue and alpha fields (r, g, b are set; a stays at 1).
  await record(
    "polyhedron-colour",
    async () => {
      await openFolder(context, POLYHEDRON);
      await openColourPicker(context, POLYHEDRON, "Colour");
      await context.evaluate(`(${field(POLYHEDRON, "Colour", 0)}).focus()`);
      await commitField2(context, field(POLYHEDRON, "Colour", 0), "0");
      for (const [index, text] of [
        [1, "255"],
        [2, "0"],
      ]) {
        await context.evaluate(`(${field(POLYHEDRON, "Colour", index)}).focus()`);
        await commitField2(context, field(POLYHEDRON, "Colour", index), text);
      }
    },
    async () => ({
      colour: await evaluate(`(${row(POLYHEDRON, "Colour")}).querySelector("input.tp-txtv_i").value`),
      instances: await instances(context),
    }),
  );

  // A bond rule is added from the Bonds section's + button: the New bond folder, then its Add bond button. The Bonds section
  // is folded first, so the + covers a folded section too: it opens the section and shows the row.
  await record(
    "bond-add",
    async () => {
      // The octahedra cover the Si-O bonds (a covered bond is hidden), so the polyhedron is hidden first: the bond window's
      // count then follows the window. The eye on the polyhedron's folder shows or hides it.
      // The eye is focused and Enter pressed (a keyboard press on the button, as the eye is a button).
      await context.evaluate(`(${folder(POLYHEDRON)}).querySelector(".dock-eye").focus({ preventScroll: true })`);
      await context.pressKey(ENTER);
      await waitFor(`(${folder(POLYHEDRON)}).querySelector(".tp-fldv_b").hasAttribute("data-hidden")`, "the polyhedron to hide");
      if ((await evaluate(`${SECTION_TRIGGER("Bonds")}.getAttribute("aria-expanded")`)) === "true") {
        await pressElement(context, SECTION_TRIGGER("Bonds"));
        await waitFor(`${SECTION_TRIGGER("Bonds")}.getAttribute("aria-expanded") === "false"`, "the Bonds section to fold");
      }
      await pressElement(context, `document.querySelector('#inspector [aria-label="Add a bond"]')`);
      await waitFor(`${SECTION_TRIGGER("Bonds")}.getAttribute("aria-expanded") === "true"`, "the Bonds section to open at its +");
      await waitFor(`!!(${folder("New bond")})`, "the New bond folder");
      const before = await drawCount();
      await pressElement(
        context,
        `[...(${folder("New bond")}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Add bond")`,
      );
      // The rule's folder comes with the edit, and the compile starts with it: the compile ends, then the frame is drawn.
      await waitFor(`!!(${folder(BOND)})`, "the new bond's folder");
      await waitCompiled(context);
      await waitFor(`window.__gl.draw > ${before}`, "the scene with the new bond");
    },
    async () => ({
      bonds: await evaluate(`[...document.querySelectorAll("#inspector .tp-fldv_t")].map((t) => t.textContent.trim()).filter((t) => t.includes("–"))`),
      window: await evaluate(`[${fieldValue(BOND, "Window", 0)}, ${fieldValue(BOND, "Window", 1)}]`),
      instances: await instances(context),
    }),
  );
  const withBonds = await instances(context);

  // The window's top is typed to 1.78 A, between the apical Si-O bonds (1.758) and the equatorial ones (1.810): the bonds
  // of the equatorial pairs drop out, so the frame has fewer instances.
  await record(
    "bond-narrow",
    async () => {
      await openFolder(context, BOND);
      await commitField(context, field(BOND, "Window", 1), "1.78");
    },
    async () => ({
      window: await evaluate(`[${fieldValue(BOND, "Window", 0)}, ${fieldValue(BOND, "Window", 1)}]`),
      instances: await instances(context),
    }),
  );

  // The window's top goes back to 2.00 A: every Si-O pair is in it again, so the count is the one before the narrowing.
  await record(
    "bond-widen",
    async () => {
      await openFolder(context, BOND);
      await commitField(context, field(BOND, "Window", 1), "2");
    },
    async () => ({
      window: await evaluate(`[${fieldValue(BOND, "Window", 0)}, ${fieldValue(BOND, "Window", 1)}]`),
      instances: await instances(context),
    }),
  );

  // The cell: the stishovite config is 2 x 2 x 3, so c goes to 2 (2 x 2 x 2), then all three go to 1 (1 x 1 x 1).
  await record(
    "supercell-two",
    async () => {
      await openFolder(context, SUPERCELL_FOLDER);
      await setSupercell(context, [
        ["a", 2],
        ["b", 2],
        ["c", 2],
      ]);
    },
    async () => ({
      supercell: await supercellValues(context),
      instances: await instances(context),
    }),
  );
  const twoByTwoByTwo = await instances(context);

  await record(
    "supercell-one",
    async () => {
      await setSupercell(context, [
        ["a", 1],
        ["b", 1],
        ["c", 1],
      ]);
    },
    async () => ({
      supercell: await supercellValues(context),
      instances: await instances(context),
    }),
  );
  const oneByOneByOne = await instances(context);
  if (!(oneByOneByOne < twoByTwoByTwo))
    throw new Error("the one-cell scene has as many instances as the 2 x 2 x 2 one");

  await record(
    "supercell-back",
    async () => {
      await setSupercell(context, [
        ["a", 1],
        ["b", 1],
      ]);
    },
    async () => ({
      supercell: await supercellValues(context),
      instances: await instances(context),
    }),
  );
  if ((await instances(context)) !== oneByOneByOne)
    throw new Error("the back-to-one-cell scene differs from the first one");

  // A section folds and unfolds: the dock's rectangle is the same afterwards (the column holds its height).
  const dockRect = () =>
    evaluate(`(() => { const r = document.getElementById("inspector").getBoundingClientRect();
    return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`);
  await record(
    "fold-section",
    async () => {
      const before = await dockRect();
      await pressElement(context, SECTION_TRIGGER("Atoms"));
      await waitFor(
        `${SECTION_TRIGGER("Atoms")}.getAttribute("aria-expanded") === "false"`,
        "the Atoms section to fold",
      );
      await pressElement(context, SECTION_TRIGGER("Atoms"));
      await waitFor(
        `${SECTION_TRIGGER("Atoms")}.getAttribute("aria-expanded") === "true"`,
        "the Atoms section to unfold",
      );
      const after = await dockRect();
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        throw new Error(
          `the dock moved when a section folded: ${JSON.stringify(before)} then ${JSON.stringify(after)}`,
        );
      }
    },
    async () => ({ dock: await dockRect() }),
  );

  // The exports read the config the edits made.
  await record(
    "export-toml",
    async () => {
      const before = await blobCount();
      await openExportMenu();
      await pickExportItem("Export config (TOML)");
      await waitFor(`window.__blobs.length > ${before}`, "the TOML export");
    },
    async () => ({
      status: await evaluate(`document.getElementById("message").textContent`),
      text: await evaluate(`window.__blobs[window.__blobs.length - 1].text()`),
    }),
  );

  await record(
    "export-json",
    async () => {
      const before = await blobCount();
      await openExportMenu();
      await pickExportItem("Export config (JSON)");
      await waitFor(`window.__blobs.length > ${before}`, "the JSON export");
    },
    async () => ({ text: await evaluate(`window.__blobs[window.__blobs.length - 1].text()`) }),
  );

  // The same colour's text field takes a hex: typed and committed with Enter, then the picker's hue bar is dragged. Each
  // accepted change is drawn and compiled; the text is read back after it, so a refresh that shows a new value is seen.
  await record(
    "polyhedron-colour-hex",
    async () => {
      await commitField(context, `(${row(POLYHEDRON, "Colour")}).querySelector("input.tp-txtv_i")`, "#0000ff");
    },
    async () => ({
      colour: await evaluate(`(${row(POLYHEDRON, "Colour")}).querySelector("input.tp-txtv_i").value`),
      instances: await instances(context),
    }),
  );
  await record(
    "polyhedron-colour-drag",
    async () => {
      // A press on the hue bar, a drag along it and a release: the change is committed once, on the release.
      await openColourPicker(context, POLYHEDRON, "Colour");
      const bar = `(${row(POLYHEDRON, "Colour")}).querySelector(".tp-colpv_h")`;
      const box = await evaluate(`(() => { const r = ${bar}.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
      const [left, top, width, height] = box;
      const y = top + height / 2;
      await context.s("Input.dispatchMouseEvent", { type: "mousePressed", x: left + width * 0.1, y, button: "left", clickCount: 1 });
      for (const fraction of [0.3, 0.5, 0.7]) {
        await context.s("Input.dispatchMouseEvent", { type: "mouseMoved", x: left + width * fraction, y, button: "left" });
      }
      await context.s("Input.dispatchMouseEvent", { type: "mouseReleased", x: left + width * 0.7, y, button: "left", clickCount: 1 });
      await waitCompiled(context);
    },
    async () => ({
      colour: await evaluate(`(${row(POLYHEDRON, "Colour")}).querySelector("input.tp-txtv_i").value`),
      instances: await instances(context),
    }),
  );

  // The polyhedron's alpha, typed into the picker's fourth field: a solid colour takes transparency, so the field is there
  // (its row offers alpha while the colour is solid). The polyhedron is shown first (the bond step hid it: a hidden one is
  // not drawn). The hex takes eight digits, the TOML export's polyhedron colour holds the alpha, and the polyhedron is drawn
  // see-through at that alpha (driver.mjs's window.__gl.opacities, listed by draw.ts for each see-through material). It
  // runs on the stishovite tab, before the c60 drop changes the tab's scene. The picker rounds the alpha to a byte, so the
  // checks allow one byte of difference from 0.5.
  await record(
    "polyhedron-alpha",
    async () => {
      // The dock is opened if it is shut, as the budget step opens it.
      if (!(await evaluate(`document.documentElement.dataset.dock === "open"`))) {
        await pressElement(context, `document.querySelector('#inspector-tab')`);
      }
      // The Shapes section is opened as the user left it: a folded section is opened at its header first.
      if ((await evaluate(`${SECTION_TRIGGER("Shapes")}.getAttribute("aria-expanded")`)) === "false") {
        await pressElement(context, SECTION_TRIGGER("Shapes"));
      }
      await openFolder(context, POLYHEDRON);
      if (await evaluate(`(${folder(POLYHEDRON)}).querySelector(".tp-fldv_b").hasAttribute("data-hidden")`)) {
        await context.evaluate(`(${folder(POLYHEDRON)}).querySelector(".dock-eye").focus({ preventScroll: true })`);
        await context.pressKey(ENTER);
        await waitFor(`!(${folder(POLYHEDRON)}).querySelector(".tp-fldv_b").hasAttribute("data-hidden")`, "the polyhedron to show");
        await waitCompiled(context);
      }
      await openColourPicker(context, POLYHEDRON, "Colour");
      await commitField2(context, field(POLYHEDRON, "Colour", 3), "0.5");
      await openExportMenu();
      const before = await blobCount();
      await pickExportItem("Export config (TOML)");
      await waitFor(`window.__blobs.length > ${before}`, "the TOML export");
    },
    async () => {
      const colour = await evaluate(`(${row(POLYHEDRON, "Colour")}).querySelector("input.tp-txtv_i").value`);
      const toml = await evaluate(`window.__blobs[window.__blobs.length - 1].text()`);
      // The first colour after the polyhedra table's header is the polyhedron rule's (the TOML writes arrays with spaces).
      const polyhedra = toml.slice(toml.indexOf("[[polyhedra]]"));
      const configRgba = polyhedra.match(/color\s*=\s*\[([^\]]*)\]/)?.[1].split(",").map(Number) ?? [];
      const configAlpha = configRgba[3];
      const opacity = await evaluate(`window.__gl.opacities?.at(-1) ?? null`);
      const byte = Math.abs(configAlpha - 0.5) <= 1 / 255 + 1e-9;
      if (!/^#[0-9a-f]{6}[0-9a-f]{2}$/.test(colour) || colour.length !== 9) {
        throw new Error(`the colour's hex is ${colour}, not eight digits`);
      }
      if (!byte) throw new Error(`the config's polyhedron alpha is ${configAlpha}, not 0.5 to one byte`);
      if (opacity !== configAlpha) throw new Error(`the polyhedron is drawn at opacity ${opacity}, not its alpha ${configAlpha}`);
      return { colour, configRgba, opacity, instances: await instances(context) };
    },
  );

  // Over the budget, on the c60 cage (240 atoms a cell, 1 920 at 2 x 2 x 2; the page compiles at most 200 000): a and b go
  // to 10 (48 000 atoms, within the budget), then c to 9 (216 000) is refused. The Cell's supercell stops at 10 a side,
  // so the stishovite cell (6 atoms) cannot reach the budget. c stays at 2, the note says why, and the scene keeps its
  // count.
  await record(
    "budget-drop-c60",
    async () => {
      await dropNamed(context, [
        ["c60/POSCAR", "POSCAR"],
        ["c60/config.toml", "config.toml"],
      ]);
    // The dock is shut on a new tab, as the tab was left: the one inspector toggle opens it.
    if (!(await evaluate(`document.documentElement.dataset.dock === "open"`))) {
      await pressElement(context, `document.querySelector('#inspector-tab')`);
    }
    await waitFor(`!!${SECTION_TRIGGER("Cell")}`, "the c60 tab's Cell section");
    // The dock keeps each section open or shut as the user left it: the Cell is opened if it is shut.
    if ((await evaluate(`${SECTION_TRIGGER("Cell")}.getAttribute("aria-expanded")`)) === "false") {
      await pressElement(context, SECTION_TRIGGER("Cell"));
    }
    await openFolder(context, SUPERCELL_FOLDER);
      await waitCompiled(context);
    },
    async () => ({
      supercell: await supercellValues(context),
      instances: await instances(context),
    }),
  );
  await record(
    "supercell-over-budget",
    async () => {
      await setSupercell(context, [
        ["a", 10],
        ["b", 10],
      ]);
      const scene = await instances(context);
      await refuseField(context, supercellField("c"), "9", "2");
      if ((await instances(context)) !== scene) throw new Error("a refused supercell changed the scene");
    },
    async () => ({
      note: await evaluate(TOAST_TEXT),
      supercell: await supercellValues(context),
      instances: await instances(context),
    }),
  );

  // A phone: the details card is the phone's panel (react/selection-card.tsx), a sheet above the bottom row. At 393 px the card
  // is closed, an atom is tapped on the stage, and the card opens with the pick (the dock, if it was open, shuts: one sheet
  // at a time). The desktop viewport is restored after the step.
  await record(
    "phone-tap-atom",
    async () => {
      await s("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
      await waitFor(`window.innerWidth === 393`, "the phone viewport");
      await settle();
      if (await evaluate(`!!document.querySelector('[aria-label="Hide the selection details"]')`)) {
        await pressElement(context, `document.querySelector('[aria-label="Hide the selection details"]')`);
        await waitFor(`!document.querySelector('[aria-label="Hide the selection details"]')`, "the card to close");
      }
      // The dock may be open from the desktop steps: on a phone it is a sheet over the stage, so the tap waits for it to shut.
      if (await evaluate(`document.documentElement.dataset.dock === "open"`)) {
        await pressElement(context, `document.getElementById("customize-button")`);
        await waitForDock(false);
      }
      const stage = await evaluate(STAGE_RECT);
      for (const [fx, fy] of TAP_POINTS) {
        await tapAt(context, stage, fx, fy);
        if (await evaluate(`!!document.querySelector('[aria-label="Hide the selection details"]')`)) break;
      }
      await waitFor(`!!document.querySelector('[aria-label="Hide the selection details"]')`, "the selection card to open on a tap");
      await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await waitFor(`window.innerWidth === 1280`, "the desktop viewport");
    },
    async () => ({
      card: await evaluate(`document.querySelector('#info [role="heading"]')?.textContent ?? null`),
      dock: await evaluate(`document.documentElement.dataset.dock === "open"`),
    }),
  );

  // On a phone the customize button (react/customize-button.tsx) opens the dock as a sheet of the style sections, and that
  // shuts the card. The sheet is read at 393 px; the desktop viewport is restored after it is read.
  await record(
    "phone-customize",
    async () => {
      await s("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
      await waitFor(`window.innerWidth === 393`, "the phone viewport");
      await settle();
      await pressElement(context, `document.getElementById("customize-button")`);
      await waitFor(`!!document.querySelector("#inspector .style-pane")`, "the style sections on the phone sheet");
      await settle();
    },
    async () => {
      const state = {
        sections: await evaluate(
          `[...document.querySelectorAll('#inspector [data-slot="collapsible-trigger"] span.truncate')].map((s) => s.textContent.trim())`,
        ),
        card: await evaluate(`!!document.getElementById("info")`),
        sheet: await evaluate(
          `(() => { const r = document.getElementById("inspector").getBoundingClientRect(); return { top: r.top, bottom: r.bottom, left: r.left, right: r.right }; })()`,
        ),
      };
      // The desktop viewport is restored once the sheet is read, at 393 px.
      await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await waitFor(`window.innerWidth === 1280`, "the desktop viewport");
      return state;
    },
  );

  // The phone's sheet takes touches, as the stage does not while it is over it: a finger's tap on a View checkbox toggles it,
  // and a finger's drag that starts on the sheet leaves the camera alone (the address holds the camera, camera/viewhash.ts).
  // Not golden steps: they are checked here, and fail the run. The desktop viewport is restored after.
  const touch = (type, x, y) =>
    s("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y, id: 1 }] });
  await s("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
  await waitFor(`window.innerWidth === 393`, "the phone viewport");
  await settle();
  if (!(await evaluate(`document.documentElement.dataset.dock === "open"`))) {
    await pressElement(context, `document.getElementById("customize-button")`);
  }
  await waitFor(`!!document.querySelector("#inspector .style-pane")`, "the phone sheet");
  await settle();
  const BOX_ROW = `[...document.querySelectorAll("#inspector .tp-lblv")].find((r) => r.querySelector(".tp-lblv_l")?.textContent.trim() === "Cell box")`;
  const BOX = `(${BOX_ROW}).querySelector('input[type="checkbox"]')`;
  const boxChecked = () => evaluate(`(${BOX}).checked`);
  await evaluate(`(${BOX_ROW}).scrollIntoView({ block: "nearest" })`);
  const spot = await evaluate(`(() => { const r = (${BOX_ROW}).querySelector(".tp-ckbv_w, .tp-ckbv").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const before = await boxChecked();
  await touch("touchStart", spot.x, spot.y);
  await touch("touchEnd", spot.x, spot.y);
  await waitFor(`(${BOX}).checked === ${!before}`, "a tap on the phone sheet to toggle the Cell box");
  await touch("touchStart", spot.x, spot.y);
  await touch("touchEnd", spot.x, spot.y);
  await waitFor(`(${BOX}).checked === ${before}`, "a second tap to toggle the Cell box back");
  const sheet = await evaluate(`(() => { const r = document.getElementById("inspector").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + 40, bottom: r.bottom }; })()`);
  const pose = () => evaluate(`location.hash`);
  const poseBefore = await pose();
  await touch("touchStart", sheet.x, sheet.y);
  for (let step = 1; step <= 10; step++) await touch("touchMove", sheet.x + step * 12, sheet.y + step * 12);
  await touch("touchEnd", sheet.x + 120, sheet.y + 120);
  await settle();
  await sleep(600); // the address is written 200 ms after the camera stops
  if ((await pose()) !== poseBefore) throw new Error("a touch drag on the phone sheet moved the camera");
  await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await waitFor(`window.innerWidth === 1280`, "the desktop viewport");
}
