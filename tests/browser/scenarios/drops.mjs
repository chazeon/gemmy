// The front page's drops, each one a step (the card's scene is the reference for the dropped counts, tests/test_browser.py).
// The first four teach a LAMMPS type map: the stishovite POSCAR alone (the defaults), then with its config (the example's
// counts), then a LAMMPS file with no type information (the card's type form, filled in and applied). The rest cover the
// drops after that: a saved map is suggested, not applied, to a file with only type ids; an informative file (with masses)
// applies its saved map with a toast, which Undo (by pointer, then by keyboard) reverts; a toast expires on a tab switch
// and shows once per load; a second note replaces the first's action; the form's labels, errors and import; the POSCAR
// with its config; a scene among the sidecars; a config that does not read; and a switch while a file loads.

// The labels typed into the type form, by type id: the form has one input per id.
const TYPE_LABELS = { 1: "Na", 2: "Cl" };
const MASSES_LABELS = { 1: "Mg", 2: "O" };
// The Tab presses a keyboard user makes to reach the toast's button, at most (the focus starts in the page's first place).
const MAX_TAB_PRESSES = 400;
const KEYS = {
  tab: { key: "Tab", code: "Tab", keyCode: 9 },
  enter: { key: "Enter", code: "Enter", keyCode: 13, text: "\r" },
};

// The reads of the type form, the toast and the tabs, as page expressions.
const PROMPT_SHOWN = `!!document.querySelector('[data-testid="type-map"]')`;
const PROMPT_NAME = `(() => {
  const card = document.querySelector('[data-testid="type-map"]');
  return card ? document.getElementById(card.getAttribute("aria-labelledby")).textContent : null;
})()`;
const PROMPT_ALERT = `document.querySelector('[data-testid="type-map"] [role="alert"]')?.textContent ?? null`;
const FOCUSED_ID = `document.activeElement?.id ?? null`;
const APPLY_DISABLED = `document.querySelector('[data-testid="type-apply"]')?.disabled ?? null`;
const PRESET_BUTTONS = `[...document.querySelectorAll('[data-testid="type-preset"] button')].map((b) => b.getAttribute("aria-label"))`;
const PRESET_COUNT = `document.querySelectorAll('[data-testid="type-preset"]').length`;
const TOAST_ACTION_SHOWN = `!!document.querySelector("#message .message-action")`;
const FOCUS_IN_TOAST = `!!document.activeElement?.closest("#message")`;
// The current file's name: the file island's trigger (react/file-island.tsx), or the title when the island shows it as text.
const FILE_NAME = `(document.querySelector('[data-testid="file-trigger"]')?.textContent.trim() ?? document.querySelector('[data-testid="page-title"]')?.textContent ?? null)`;
const TITLE_IS = (name) => `${FILE_NAME} === ${JSON.stringify(name)}`;
const fieldError = (type) => `document.getElementById("type-input-${type}-error")?.textContent ?? null`;
const inputValue = (type) => `document.getElementById("type-input-${type}")?.value ?? null`;
// The file island's dropdown (react/file-island.tsx): its trigger opens the menu on a pointer press, which a script makes with
// a pointerdown event (Radix opens its menus on that press). Its items carry the file's name in data-label.
const OPEN_FILES = `(() => { document.querySelector('[data-testid="file-trigger"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" })); return true; })()`;
const FILE_ITEM = (label) => `[data-testid="file-item"][data-label=${JSON.stringify(label)}]`;
// New tab: the narrow "+" beside the file name (react/file-island.tsx), shown while no start tab exists. It opens the start
// screen.
const NEW_TAB_BUTTON = `[data-testid="new-tab-button"]`;
const PLUS_SHOWN = `!!document.querySelector('[data-testid="new-tab-button"]')`;
const FILE_COUNT = `Number(document.getElementById("file-island").dataset.files)`;
const ESCAPE = { key: "Escape", code: "Escape", keyCode: 27 };
const ARROW_DOWN = { key: "ArrowDown", code: "ArrowDown", keyCode: 40 };
const HOME = { key: "Home", code: "Home", keyCode: 36 };
const DELETE = { key: "Delete", code: "Delete", keyCode: 46 };
const FILE_MENU_OPEN = `!!document.getElementById("file-panel")`;
const FOCUS_ON_TRIGGER = `document.activeElement?.dataset.testid ?? null`;
// The presets file a user imports: not a presets file, so the form says why.
const BAD_PRESETS_IMPORT = `(() => {
  const input = document.querySelector('[data-testid="type-map"] input[type="file"]');
  const transfer = new DataTransfer();
  transfer.items.add(new File(['{"format": "nope"}'], "bad.presets.json", { type: "application/json" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
})()`;

// Opens the file menu and waits for it (a click on the trigger, as a mouse makes it).
async function openFiles({ evaluate, waitFor }) {
  await evaluate(OPEN_FILES);
  await waitFor(FILE_MENU_OPEN, "the file menu");
}

// A file chosen from the file menu: the menu opens, and the file's item is clicked.
async function clickTab(context, label) {
  await openFiles(context);
  await context.clickJs(FILE_ITEM(label));
}

// Shows the start screen: the main menu's New tab.
async function openStart(context) {
  // A start screen that is open is the current view already, so there is nothing to open; the "+" is shown only without one.
  await context.evaluate(`document.querySelector(${JSON.stringify(NEW_TAB_BUTTON)})?.click();`);
}

// Types a label into a type's input, replacing what it holds.
async function typeLabel({ s, evaluate }, type, label) {
  await evaluate(`(() => { const input = document.getElementById("type-input-${type}"); input.focus(); input.select(); })()`);
  await s("Input.insertText", { text: label });
}

// The form's state for a step that opens or reads it.
function promptReads({ formShown, evaluate }) {
  return async () => ({
    form: await formShown(),
    prompt: await evaluate(PROMPT_NAME),
    focus: await evaluate(FOCUSED_ID),
    presetButtons: await evaluate(PRESET_BUTTONS),
  });
}

// A keyboard user's Tab presses until the focus is on the toast's button; the focus is then ready for Enter.
async function tabToToastAction({ evaluate, pressKey }) {
  for (let presses = 0; presses < MAX_TAB_PRESSES; presses++) {
    if (await evaluate(FOCUS_IN_TOAST)) return;
    await pressKey(KEYS.tab);
  }
  throw new Error("Tab did not reach the toast's action");
}

export async function run(context) {
  const { record, drawCount, dropFiles, waitFor, alertText, formShown, toastState, evaluate, s, clickJs, mouseClick, pressKey, settle } =
    context;
  const reads = promptReads(context);

  await record("drop-poscar", async () => {
    const before = await drawCount();
    await dropFiles(["POSCAR"]);
    await waitFor(`window.__gl.draw > ${before}`, "the dropped POSCAR's scene");
  }, async () => ({ alert: await alertText() }));

  await record("drop-poscar-config", async () => {
    const before = await drawCount();
    await dropFiles(["POSCAR", "config.toml"]);
    await waitFor(`window.__gl.draw > ${before}`, "the dropped POSCAR and config's scene");
  }, async () => ({ alert: await alertText() }));

  await record("drop-lammps-form", () => dropFiles(["two-types.dump"]), async () => ({
    form: await formShown(),
    alert: await alertText(),
  }));

  await record("type-form-apply", async () => {
    const before = await drawCount();
    for (const [typeId, label] of Object.entries(TYPE_LABELS)) {
      await evaluate(`document.getElementById("type-input-${typeId}").focus()`);
      await s("Input.insertText", { text: label });
    }
    await waitFor(`!document.querySelector('[data-testid="type-apply"]').disabled`, "the Apply button");
    await clickJs('[data-testid="type-apply"]');
    await waitFor(`window.__gl.draw > ${before}`, "the scene with the types");
  }, async () => ({ form: await formShown(), alert: await alertText() }));

  // A file with only type ids: the saved map is suggested in the form, and nothing is applied by itself.
  await record("drop-lammps-preset", async () => {
    await dropFiles(["second-types.dump"]);
    await waitFor(PROMPT_SHOWN, "the type form with the suggestion");
  }, async () => ({ ...(await reads()), toast: await toastState() }));

  // The saved map's Use fills the labels; Apply reads the file with them.
  await record("preset-use", async () => {
    await mouseClick('[aria-label="Use two-types.dump"]');
    await waitFor(`${inputValue(1)} === "Na"`, "the saved labels");
  }, async () => ({ labels: [await evaluate(inputValue(1)), await evaluate(inputValue(2))] }));
  await record("preset-apply", async () => {
    const before = await drawCount();
    await clickJs('[data-testid="type-apply"]');
    await waitFor(`!${PROMPT_SHOWN}`, "the form to close");
    await waitFor(`window.__gl.draw > ${before}`, "the scene of the second file");
  }, async () => ({ form: await formShown(), toast: await toastState() }));

  // An informative file (masses): a LAMMPS file with masses and no type names asks for its map once.
  await record("drop-masses-form", () => dropFiles(["masses-types.data"]), reads);
  await record("masses-apply", async () => {
    const before = await drawCount();
    await typeLabel(context, 1, MASSES_LABELS[1]);
    await typeLabel(context, 2, MASSES_LABELS[2]);
    await waitFor(`!document.querySelector('[data-testid="type-apply"]').disabled`, "the Apply button");
    await clickJs('[data-testid="type-apply"]');
    await waitFor(`!${PROMPT_SHOWN}`, "the form to close");
    await waitFor(`window.__gl.draw > ${before}`, "the scene with the masses map");
  }, async () => ({ form: await formShown() }));

  // Its saved map applies to the next file with the same masses, with a toast that offers Undo.
  await record("drop-masses-auto", async () => {
    const before = await drawCount();
    await dropFiles(["masses-auto.data"]);
    await waitFor(TOAST_ACTION_SHOWN, "the applied map's toast");
    await waitFor(`window.__gl.draw > ${before}`, "the scene with the saved map");
  }, async () => ({ form: await formShown(), alert: await alertText(), toast: await toastState() }));

  // Undo by a pointer click: the file's map is asked again, in the form.
  await record("undo-pointer", async () => {
    await mouseClick("#message .message-action");
    await waitFor(PROMPT_SHOWN, "the form after Undo");
  }, async () => ({ ...(await reads()), toast: await toastState() }));

  // The next load of the tab does not apply the saved map: the tab is left and opened again, and the form opens.
  await record("switch-to-start", async () => {
    await openStart(context);
    await waitFor(`!${PROMPT_SHOWN}`, "the form to clear");
  }, async () => ({ form: await formShown(), toast: await toastState() }));
  await record("switch-back-asks", async () => {
    await clickTab(context, "masses-auto.data");
    await waitFor(PROMPT_SHOWN, "the form, not the saved map");
  }, async () => ({ ...(await reads()), toast: await toastState() }));

  // Undo by the keyboard: a second file applies, and Tab reaches the toast's button, where Enter presses it.
  await record("drop-masses-third", async () => {
    const before = await drawCount();
    await dropFiles(["masses-third.data"]);
    await waitFor(TOAST_ACTION_SHOWN, "the applied map's toast");
    await waitFor(`window.__gl.draw > ${before}`, "the scene with the saved map");
  }, async () => ({ toast: await toastState() }));
  await record("undo-keyboard", async () => {
    await tabToToastAction(context);
    await pressKey(KEYS.enter);
    await waitFor(PROMPT_SHOWN, "the form after Undo");
  }, async () => ({ ...(await reads()), toast: await toastState() }));

  // A toast expires with a tab switch: the switch clears the note and its action.
  await record("drop-masses-fourth", async () => {
    const before = await drawCount();
    await dropFiles(["masses-fourth.data"]);
    await waitFor(TOAST_ACTION_SHOWN, "the applied map's toast");
    await waitFor(`window.__gl.draw > ${before}`, "the scene with the saved map");
  }, async () => ({ toast: await toastState() }));
  await record("switch-expires-toast", async () => {
    await openStart(context);
    await waitFor(`!${TOAST_ACTION_SHOWN}`, "the toast's action to expire");
  }, async () => ({ toast: await toastState() }));

  // The toast shows once per load: the tab is opened again with its scene already loaded, and no toast comes back.
  await record("switch-back-once", async () => {
    await clickTab(context, "masses-fourth.data");
    await waitFor(TITLE_IS("masses-fourth.data"), "the tab's scene");
  }, async () => ({ toast: await toastState() }));

  // A second note replaces the first's action: the toast names the second file, with its own Undo.
  await record("second-note", async () => {
    // Each file's scene is drawn before the next is dropped: a scene that is replaced before its frame draws is not drawn.
    const beforeFifth = await drawCount();
    await dropFiles(["masses-fifth.data"]);
    await waitFor(`${TOAST_ACTION_SHOWN} && ${TITLE_IS("masses-fifth.data")}`, "the first toast");
    await waitFor(`window.__gl.draw > ${beforeFifth}`, "the first scene's frame");
    await dropFiles(["masses-sixth.data"]);
    await waitFor(`${TITLE_IS("masses-sixth.data")} && document.querySelector("#message")?.textContent.includes("masses-sixth.data")`, "the second toast");
  }, async () => ({ toast: await toastState() }));

  // The form's own checks: an import that is not a presets file, and a label that names no element.
  await record("drop-two-types-again", async () => {
    await dropFiles(["two-types.dump"]);
    await waitFor(PROMPT_SHOWN, "the type form with the suggestion");
  }, async () => ({ ...(await reads()), presetCount: await evaluate(PRESET_COUNT) }));
  await record("import-bad", async () => {
    await evaluate(BAD_PRESETS_IMPORT);
    await waitFor(PROMPT_ALERT, "the import's reason");
  }, async () => ({ alert: await evaluate(PROMPT_ALERT), presetCount: await evaluate(PRESET_COUNT) }));
  await record("label-qq", async () => {
    await typeLabel(context, 1, "Qq");
    await typeLabel(context, 2, TYPE_LABELS[2]);
    await waitFor(`${fieldError(1)} !== null`, "the field's error");
  }, async () => ({
    fieldError: await evaluate(fieldError(1)),
    applyDisabled: await evaluate(APPLY_DISABLED),
    values: [await evaluate(inputValue(1)), await evaluate(inputValue(2))],
    presetCount: await evaluate(PRESET_COUNT),
  }));
  await record("label-good-apply", async () => {
    await typeLabel(context, 1, TYPE_LABELS[1]);
    await waitFor(`!document.querySelector('[data-testid="type-apply"]').disabled`, "the Apply button");
    await clickJs('[data-testid="type-apply"]');
    await waitFor(`!${PROMPT_SHOWN}`, "the form to close");
  }, async () => ({ form: await formShown() }));

  // A POSCAR with its config named for it (POSCAR.toml): one structure tab, compiled with that config.
  await record("drop-poscar-pair", async () => {
    const before = await drawCount();
    await dropFiles(["POSCAR", "POSCAR.toml"]);
    await waitFor(`window.__gl.draw > ${before}`, "the POSCAR's scene with its config");
  }, async () => ({ alert: await alertText(), toast: await toastState() }));

  // A scene among the sidecars is refused, and a config that does not read names its file first.
  await record("drop-scene-sidecar", async () => {
    await dropFiles(["POSCAR", "scene.json"]);
    await waitFor(`!!document.querySelector('#home [role="alert"]') || !!document.getElementById("message")`, "the refusal");
  }, async () => ({ alert: await alertText(), toast: await toastState() }));
  await record("drop-bad-config", async () => {
    await dropFiles(["POSCAR", "bad-config.toml"]);
    await waitFor(`!!document.querySelector('#home [role="alert"]') || !!document.getElementById("message")`, "the config's error");
  }, async () => ({ alert: await alertText(), toast: await toastState() }));

  // A switch while a structure loads: the file's tab is left before its scene shows, so the start screen stays.
  await record("switch-while-loading", async () => {
    await dropFiles(["POSCAR"], `document.querySelector(${JSON.stringify(NEW_TAB_BUTTON)})?.click();`);
    await waitFor(`document.title === "gemmy"`, "the start screen");
  }, async () => ({ alert: await alertText(), toast: await toastState() }));
  // A switch clears the form too.
  await record("switch-clears-form", async () => {
    await dropFiles(["two-types.dump"]);
    await waitFor(PROMPT_SHOWN, "the type form");
    await openStart(context);
    await waitFor(`!${PROMPT_SHOWN}`, "the form to clear");
  }, async () => ({ form: await formShown() }));
  // The page ends on a scene, which the layout is measured with (the start screen has no lens row).
  await record("drop-poscar-last", async () => {
    const before = await drawCount();
    await dropFiles(["POSCAR"]);
    await waitFor(`window.__gl.draw > ${before}`, "the dropped POSCAR's scene");
  }, async () => ({ alert: await alertText() }));

  // New tab opens the start screen once: from the main menu, or the "+" while no start tab exists. A press of New tab
  // while a start tab is open switches to it and adds none, and the "+" is hidden while the start tab exists.
  const startReads = async () => ({
    files: await evaluate(FILE_COUNT),
    plus: await evaluate(PLUS_SHOWN),
    title: await evaluate(FILE_NAME),
  });
  const FOCUS_IN_START = `!!document.activeElement?.closest("#home")`;
  // The file list's labels, read with the menu open and then shut.
  const listedFiles = async () => {
    await openFiles(context);
    const list = await evaluate(`({
      items: [...document.querySelectorAll('[data-testid="file-item"]')].map((el) => el.dataset.label),
      checked: document.querySelectorAll('#file-panel [data-testid="file-item"][aria-current="true"]').length,
    })`);
    await context.pressKey(ESCAPE);
    await waitFor(`!${FILE_MENU_OPEN}`, "the file menu to shut");
    return list;
  };
  await record("new-tab-before", null, startReads);
  await record(
    "new-tab-open",
    async () => {
      await openStart(context);
      await waitFor(`document.title === "gemmy"`, "the start screen");
    },
    async () => ({ ...(await startReads()), focusInStart: await evaluate(FOCUS_IN_START), ...(await listedFiles()) }),
  );
  // New tab again, while it is the current view: the same start screen, no second one.
  await record(
    "new-tab-pressed-again",
    async () => {
      await openStart(context);
      await waitFor(`document.title === "gemmy"`, "the start screen");
    },
    startReads,
  );
  // The New tab is transient: switching to a file from the dropdown closes it, and the list has no New tab row.
  await record(
    "new-tab-switched",
    async () => {
      await openFiles(context);
      const other = await evaluate(
        `[...document.querySelectorAll('[data-testid="file-item"]')].map((el) => el.dataset.label).find((label) => label !== "New tab")`,
      );
      await context.clickJs(FILE_ITEM(other));
      await waitFor(`document.title !== "gemmy"`, "the other tab's scene");
    },
    async () => ({ ...(await startReads()), ...(await listedFiles()) }),
  );
  // With no New tab open, the "+" is back and opens one.
  await record(
    "new-tab-plus",
    async () => {
      await context.clickJs(NEW_TAB_BUTTON);
      await waitFor(`document.title === "gemmy"`, "the start screen");
    },
    startReads,
  );
  // Leaving the New tab for a file (picked from the list) closes it, and the "+" is back.
  await record(
    "new-tab-closed",
    async () => {
      await openFiles(context);
      const other = await evaluate(
        `[...document.querySelectorAll('[data-testid="file-item"]')].map((el) => el.dataset.label).find((label) => label !== "New tab")`,
      );
      await context.clickJs(FILE_ITEM(other));
      await waitFor(`document.title !== "gemmy"`, "the file's scene");
    },
    async () => ({ ...(await startReads()), focusCurrent: await evaluate(FOCUS_ON_TRIGGER) }),
  );
  // One popup at a time: the file menu opens while the export menu is open, and the export menu shuts.
  await record(
    "popup-one-at-a-time",
    async () => {
      await context.openExportMenu();
      await evaluate(`document.querySelector('[data-testid="file-trigger"]').dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, pointerType: "mouse" }))`);
      await waitFor(FILE_MENU_OPEN, "the file menu");
      await waitFor(`!document.getElementById("export-panel")`, "the export menu to shut");
    },
    async () => {
      const state = { exportMenu: await evaluate(`!!document.getElementById("export-panel")`), fileMenu: await evaluate(FILE_MENU_OPEN) };
      await context.pressKey(ESCAPE);
      await waitFor(`!${FILE_MENU_OPEN}`, "the file menu to shut");
      return state;
    },
  );

  // The file menu lists every open file (37 at the end of the drops), and the list fits the window: a long list scrolls
  // inside the menu, and the menu stays on the screen.
  await record(
    "file-menu-long",
    () => openFiles(context),
    async () => {
      const menu = await evaluate(`(() => {
        const panel = document.getElementById("file-panel").getBoundingClientRect();
        return {
          items: document.querySelectorAll('[data-testid="file-item"]').length,
          files: Number(document.getElementById("file-island").dataset.files),
          fits: panel.top >= 0 && panel.bottom <= innerHeight,
        };
      })()`);
      await context.pressKey(ESCAPE);
      await waitFor(`!${FILE_MENU_OPEN}`, "the file menu to shut");
      return menu;
    },
  );
  // The page ends on a file again (the layout is read on a scene): the first file that is not the start screen.
  await record(
    "back-to-file",
    async () => {
      await openFiles(context);
      const first = await evaluate(
        `[...document.querySelectorAll('[data-testid="file-item"]')].map((el) => el.dataset.label).find((label) => label !== "New tab")`,
      );
      await context.clickJs(FILE_ITEM(first));
      await waitFor(`document.title !== "gemmy"`, "the file's scene");
    },
    startReads,
  );
  // The keyboard close, as a probe after the recorded steps: the menu is opened with the mouse, the highlighted row is
  // walked to with the arrow keys, and Delete closes that file. The focus must then be on the trigger.
  context.probes["keyboard-close"] = await keyboardClose(context);
}

async function keyboardClose(context) {
  const { evaluate, waitFor, pressKey } = context;
  await openFiles(context);
  // The keys go to the focused item, so they wait until Radix has moved the focus into the list.
  await waitFor(`!!document.activeElement?.closest("#file-panel")`, "the file list to take the focus");
  const before = await evaluate(FILE_COUNT);
  // The target: the first file that may be closed and is not the current one.
  const target = await evaluate(
    `[...document.querySelectorAll('[data-testid="file-item"]')].find((el) => el.getAttribute("aria-current") !== "true" && el.querySelector("button"))?.dataset.label ?? null`,
  );
  const HIGHLIGHTED = `document.activeElement?.dataset.label ?? null`;
  // Radix moves the focus to a row in a timer queued by the key (Home: the first row; an arrow: the next one). A later key
  // must not find that timer still pending, or it would move the focus back. So after each key the page runs a zero-delay
  // timer of its own, which fires after the one Radix queued: the focus has landed before the next key. The walk starts at
  // the first row (Home), so the target is always below it.
  const landed = () => evaluate(`new Promise((ok) => setTimeout(ok, 0))`);
  const rows = await evaluate(`[...document.querySelectorAll('[data-testid="file-item"]')].map((el) => el.dataset.label)`);
  const targetRow = rows.indexOf(target);
  await pressKey(HOME);
  await landed();
  await waitFor(`${HIGHLIGHTED} === ${JSON.stringify(rows[0])}`, "the focus on the first file row");
  for (let row = 1; row <= targetRow; row++) {
    await pressKey(ARROW_DOWN);
    await landed();
    await waitFor(`${HIGHLIGHTED} === ${JSON.stringify(rows[row])}`, `the focus on the file row ${rows[row]}`);
  }
  const highlighted = await evaluate(HIGHLIGHTED);
  await pressKey(DELETE);
  await waitFor(`!${FILE_MENU_OPEN}`, "the file menu to shut");
  const after = await evaluate(FILE_COUNT);
  const focus = await evaluate(FOCUS_ON_TRIGGER);
  // Reopened to see the list: the target is gone from it.
  await openFiles(context);
  const remaining = await evaluate(
    `[...document.querySelectorAll('[data-testid="file-item"]')].map((el) => el.dataset.label)`,
  );
  await pressKey(ESCAPE);
  await waitFor(`!${FILE_MENU_OPEN}`, "the file menu to shut");
  return { target, highlighted, before, after, focus, closed: !remaining.includes(target) };
}
