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
const POLYHEDRON = "Si (O)";
// A box is settled when it has held still for STILL_TICKS polls, SETTLE_TICK_MS apart.
const STILL_TICKS = 3;
const SETTLE_TICK_MS = 60;
const BOND = "O–Si";
// The Cell section's supercell: a row of three counts (a, b, c in order), found by its label in the dock.
const SUPERCELL_ROW = "Supercell";
const SUPERCELL_INDEX = { a: 0, b: 1, c: 2 };
// The stage points a phone tap tries, as fractions of the stage: the middle first, then outwards.
const TAP_POINTS = [
  [0.5, 0.5], [0.4, 0.45], [0.6, 0.55], [0.3, 0.4], [0.7, 0.6], [0.5, 0.3], [0.5, 0.7], [0.3, 0.6], [0.7, 0.4],
];
const STAGE_RECT = `(() => { const r = document.getElementById("stage").getBoundingClientRect();
  return { left: r.left, top: r.top, width: r.width, height: r.height }; })()`;

// Tweakpane's folder by its title, and a row of a folder by its label (Tweakpane's markup: .tp-fldv, .tp-fldv_t, .tp-lblv_l).
// A folder's title is the title attribute of its button (tweakpane-adapter.ts sets it to the full title): a shut folder's
// text can carry its summary and marks, so the text is not the title.
const folder = (title) =>
  `[...document.querySelectorAll("#inspector .tp-fldv")].find((f) => f.querySelector(":scope > .tp-fldv_b")?.title === ${JSON.stringify(title)})`;
const row = (folderTitle, label) =>
  `[...(${folder(folderTitle)}).querySelectorAll(".tp-lblv")].find((r) => r.querySelector(".tp-lblv_l")?.textContent.trim() === ${JSON.stringify(label)})`;
// A row of the dock by its label, in any section (a row that is not in a folder: Supercell, Outlines).
const rowIn = (label) =>
  `[...document.querySelectorAll("#inspector .tp-lblv")].find((r) => r.querySelector(".tp-lblv_l")?.textContent.trim() === ${JSON.stringify(label)})`;
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
// The press and the release are each drawn in a frame of their own: the page redraws on the press (the hover and the
// press state) and on the release (the pick), and two events in one frame would draw one frame, not two.
async function tapAt({ s, sleep, nextFrame }, stage, fx, fy) {
  const x = stage.left + stage.width * fx;
  const y = stage.top + stage.height * fy;
  await s("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await nextFrame();
  await s("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
  await nextFrame();
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
const supercellField = (axis) =>
  `[...(${rowIn(SUPERCELL_ROW)}).querySelectorAll("input")].filter((i) => /^-?[0-9.]+$/.test(i.value))[${SUPERCELL_INDEX[axis]}]`;
const supercellValues = (context) =>
  context.evaluate(`[${Object.keys(SUPERCELL_INDEX).map((axis) => `(${supercellField(axis)}).value`).join(", ")}]`);

// Sets each lattice vector's supercell count to a target (an axis that is already there is not typed).
async function setSupercell(context, targets) {
  for (const [axis, count] of targets) {
    const current = await context.evaluate(`(${supercellField(axis)}).value`);
    if (Number(current) === count) continue;
    await commitField(context, supercellField(axis), String(count));
  }
}

export async function run(context) {
  const { record, dropFiles, waitFor, evaluate, openExportMenu, pickExportItem, blobCount, drawCount, s, settle, sleep, waitForDock, nextFrame } = context;

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
      if (!(await context.dockIsOpen())) {
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
  // The selection's readout before the first style edit and after it (docs/ui.md, rule 3): a style edit rebuilds the scene, and the
  // selected object is found again by its identity, so its readout stays (a probe, after the steps).
  const READOUT = `document.getElementById("info-body")?.textContent ?? null`;
  const readoutBeforeEdit = await evaluate(READOUT);
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
  context.probes["colour-edit-readout"] = { before: readoutBeforeEdit, after: await evaluate(READOUT) };

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
      // The hue bar is found in the dock's scroll box: a press below the window's edge would land on nothing.
      await evaluate(`(${bar}).scrollIntoView({ block: "nearest" })`);
      await context.settle();
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
      if (!(await context.dockIsOpen())) {
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

  // Probes on the stishovite tab, not golden steps (docs/ui.md: Changed values, Outlines, drafts). The dock is open on a wide screen.
  if (!(await context.dockIsOpen())) await pressElement(context, `document.querySelector('#inspector-tab')`);
  const openSection = async (title) => {
    if ((await evaluate(`${SECTION_TRIGGER(title)}.getAttribute("aria-expanded")`)) === "false") {
      await pressElement(context, SECTION_TRIGGER(title));
      await waitFor(`${SECTION_TRIGGER(title)}.getAttribute("aria-expanded") === "true"`, `the ${title} section to open`);
    }
  };
  // A changed value: an atom's radius edited shows the reset dot, its label does not move, and a press on the dot restores
  // the value it reset to (the scheme's radius, the default) and the dot goes.
  await openSection("Atoms");
  await openFolder(context, "O");
  const RADIUS = row("O", "Radius");
  const RADIUS_DOT = `(${RADIUS}).querySelector(".gemmy-reset")`;
  const dotShown = `getComputedStyle(${RADIUS_DOT}).display !== "none"`;
  const labelLeft = `(${RADIUS}).querySelector(".tp-lblv_l").getBoundingClientRect().left`;
  const radiusProbe = {
    before: await evaluate(fieldValue("O", "Radius")),
    dotBefore: await evaluate(dotShown),
    labelBefore: await evaluate(labelLeft),
  };
  await commitField(context, field("O", "Radius"), "0.9");
  radiusProbe.edited = {
    value: await evaluate(fieldValue("O", "Radius")),
    dot: await evaluate(dotShown),
    labelAfter: await evaluate(labelLeft),
  };
  await pressElement(context, RADIUS_DOT);
  await context.settle();
  radiusProbe.restored = await evaluate(fieldValue("O", "Radius"));
  radiusProbe.dotAfter = await evaluate(dotShown);
  // The Periodic boxes sit over the Supercell boxes: each checkbox's right edge is the right edge of the box below it, in
  // light and in dark (the probe measures the rectangles, so a change of the grid shows here).
  await openSection("Cell");
  const measureAlign = () =>
    evaluate(`(() => {
      const row = (label) => [...document.querySelectorAll("#inspector .tp-lblv")].find((r) => r.querySelector(".tp-lblv_l")?.textContent.trim() === label);
      const checks = [...row("Periodic").querySelectorAll(".gemmy-check .tp-ckbv_w")].map((el) => Math.round(el.getBoundingClientRect().right * 10) / 10);
      const boxes = [...row("Supercell").querySelectorAll("input")].filter((i) => /^-?[0-9.]+$/.test(i.value)).map((el) => Math.round(el.getBoundingClientRect().right * 10) / 10);
      return { checks, boxes };
    })()`);
  const alignLight = await measureAlign();
  await context.s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "dark" }] });
  await context.settle();
  const alignDark = await measureAlign();
  await context.s("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: "light" }] });
  await context.settle();
  context.probes["cell-align"] = { light: alignLight, dark: alignDark };
  // The dock's scroll box is never wider than its content, with a changed value's dot showing (a sideways overflow lets a
  // text selection's autoscroll cut the labels off): the box's scroll width, its client width, and what sticks out.
  radiusProbe.scroll = await evaluate(`(() => {
    const box = document.querySelector('#inspector [data-slot="sidebar-content"]');
    const right = box.getBoundingClientRect().right;
    const left = box.getBoundingClientRect().left;
    const outside = [...box.querySelectorAll("*")].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > right + 0.5 || r.left < left - 0.5) && !el.closest(".tp-popv");
    }).map((el) => el.className.toString().slice(0, 40) || el.tagName);
    return { scrollWidth: box.scrollWidth, clientWidth: box.clientWidth, scrollLeft: box.scrollLeft, outside: outside.slice(0, 8) };
  })()`);
  context.probes["reset-dot"] = radiusProbe;
  // Outlines is one row: its checkbox turns the number off, the number is disabled and keeps its value, and turns back on.
  await openSection("View");
  const OUTLINES = rowIn("Outlines");
  const OUTLINE_BOX = `(${OUTLINES}).querySelector('input[type="checkbox"]')`;
  const OUTLINE_NUMBER = `[...(${OUTLINES}).querySelectorAll("input")].find((i) => i.type !== "checkbox")`;
  const outlineBefore = await evaluate(`(${OUTLINE_NUMBER}).value`);
  await pressElement(context, `(${OUTLINES}).querySelector(".tp-ckbv_l")`);
  await context.settle();
  const outlinesOff = {
    checked: await evaluate(`(${OUTLINE_BOX}).checked`),
    disabled: await evaluate(`(${OUTLINE_NUMBER}).disabled`),
    value: await evaluate(`(${OUTLINE_NUMBER}).value`),
  };
  await pressElement(context, `(${OUTLINES}).querySelector(".tp-ckbv_l")`);
  await context.settle();
  context.probes["outlines-off"] = {
    before: outlineBefore,
    off: outlinesOff,
    disabledOn: await evaluate(`(${OUTLINE_NUMBER}).disabled`),
  };
  // A bond for a pair with no rule yet, saved: its folder is the last bond folder, and it is expanded.
  await openSection("Bonds");
  await pressElement(context, `document.querySelector('#inspector [aria-label="Add a bond"]')`);
  await waitFor(`!!(${folder("New bond")})`, "the New bond folder");
  for (const [label, name] of [
    ["First atom", "O"],
    ["Second atom", "O"],
  ]) {
    await context.evaluate(`(() => {
      const select = (${row("New bond", label)}).querySelector("select");
      select.value = ${JSON.stringify(name)};
      select.dispatchEvent(new Event("change", { bubbles: true }));
    })()`);
    await context.settle();
  }
  await pressElement(
    context,
    `[...(${folder("New bond")}).querySelectorAll("button")].find((b) => b.textContent.trim() === "Add bond")`,
  );
  await waitFor(`!!(${folder("O–O")})`, "the new O–O bond's folder");
  await context.settle();
  context.probes["bond-draft"] = await evaluate(`(() => {
    const bonds = [...document.querySelectorAll("#inspector .tp-fldv")].filter((f) => f.querySelector(".tp-fldv_t")?.textContent.includes("–"));
    const last = bonds[bonds.length - 1];
    return {
      titles: bonds.map((f) => f.querySelector(".tp-fldv_t").textContent.trim()),
      expanded: last.classList.contains("tp-fldv-expanded"),
      draftOpen: !!${folder("New bond")},
    };
  })()`);
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
    if (!(await context.dockIsOpen())) {
      await pressElement(context, `document.querySelector('#inspector-tab')`);
    }
    await waitFor(`!!${SECTION_TRIGGER("Cell")}`, "the c60 tab's Cell section");
    // The dock keeps each section open or shut as the user left it: the Cell is opened if it is shut.
    if ((await evaluate(`${SECTION_TRIGGER("Cell")}.getAttribute("aria-expanded")`)) === "false") {
      await pressElement(context, SECTION_TRIGGER("Cell"));
    }
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
      await nextFrame();
      if (await evaluate(`!!document.querySelector('[aria-label="Hide the selection details"]')`)) {
        await pressElement(context, `document.querySelector('[aria-label="Hide the selection details"]')`);
        await waitFor(`!document.querySelector('[aria-label="Hide the selection details"]')`, "the card to close");
      }
      // The dock may be open from the desktop steps: on a phone it is a sheet over the stage, so the tap waits for it to shut.
      if (await context.dockIsOpen()) {
        await pressElement(context, `document.getElementById("customize-button")`);
        await waitForDock(false);
      }
      const stage = await evaluate(STAGE_RECT);
      for (const [fx, fy] of TAP_POINTS) {
        await tapAt(context, stage, fx, fy);
        if (await evaluate(`!!document.querySelector('[aria-label="Hide the selection details"]')`)) break;
      }
      await waitFor(`!!document.querySelector('[aria-label="Hide the selection details"]')`, "the selection card to open on a tap");
      await nextFrame();
      await s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
      await waitFor(`window.innerWidth === 1280`, "the desktop viewport");
      await nextFrame();
    },
    async () => ({
      card: await evaluate(`document.querySelector('#info [role="heading"]')?.textContent ?? null`),
      dock: await context.dockIsOpen(),
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
  if (!(await context.dockIsOpen())) {
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
  // A probe after the steps (docs/ui.md, rule 4): the phone's style sheet has a Close button, and Escape closes it while it holds
  // the focus, the focus then going back to the customize button. The dock is one open state for both widths, so the probe puts
  // the sheet and the dock back as they were before the layout is measured after the scenario.
  const DOCK_OPEN_NOW = `document.documentElement.dataset.dock === "open"`;
  const dockWas = await context.evaluate(DOCK_OPEN_NOW);
  await context.s("Emulation.setDeviceMetricsOverride", { width: 393, height: 852, deviceScaleFactor: 1, mobile: true });
  await context.waitFor(`window.innerWidth === 393`, "the phone viewport");
  await context.settle();
  if (!(await context.evaluate(`!!document.getElementById("inspector")`))) {
    await pressElement(context, `document.getElementById("customize-button")`);
  }
  await context.waitFor(`!!document.querySelector("#inspector .style-pane")`, "the phone sheet");
  await context.settle();
  const closeButton = await context.evaluate(`!!document.querySelector('#inspector [aria-label="Close the style panel"]')`);
  await context.evaluate(`document.getElementById("inspector").focus({ preventScroll: true })`);
  const focusBefore = await context.evaluate(`document.activeElement?.id ?? null`);
  await context.pressKey({ key: "Escape", code: "Escape", keyCode: 27 });
  await context.sleep(300);
  context.probes["phone-sheet-escape"] = {
    closeButton,
    focusBefore,
    shut: await context.evaluate(`!document.getElementById("inspector")`),
    focus: await context.evaluate(`document.activeElement?.id ?? null`),
  };
  if (dockWas) {
    await pressElement(context, `document.getElementById("customize-button")`);
    await context.waitFor(`!!document.querySelector("#inspector .style-pane")`, "the phone sheet to open again");
  }
  await context.s("Emulation.setDeviceMetricsOverride", { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
  await context.waitFor(`window.innerWidth === 1280`, "the desktop viewport");
  if ((await context.evaluate(DOCK_OPEN_NOW)) !== dockWas) {
    await context.mouseClick("#inspector-tab");
    await context.waitForDock(dockWas);
  }
}
