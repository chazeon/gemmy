// The page with the open-other-files flag off (web/src/ui/open-files.ts: no ?open=1, no gemmy-open meta): the file island
// shows the one file's name as text (no trigger, no menu), no New tab (the + is hidden with the flag off), and the Export menu leads with Copy link,
// and a dropped file is ignored: no file is added, no alert, and a drag over the page shows no outline.
const TRIGGER = `!!document.querySelector('[data-testid="file-trigger"]')`;
const MENU = `document.getElementById("file-island")?.dataset.menu ?? null`;
const FILES = `Number(document.getElementById("file-island")?.dataset.files ?? 0)`;
const TITLE = `document.querySelector('[data-testid="page-title"]')?.textContent ?? null`;
const PLUS = `!!document.querySelector('[data-testid="new-tab-button"]')`;
// A drag over the page, as the browser would send it: the page's outline (body.dragging) must not appear.
const DRAG_OVER = `(() => {
  window.dispatchEvent(new DragEvent("dragover", { dataTransfer: new DataTransfer(), bubbles: true, cancelable: true }));
  return document.body.classList.contains("dragging");
})()`;

export async function run(context) {
  const { record, evaluate, openExportMenu, dropFiles, alertText } = context;
  await record("closed-file-island", null, async () => ({
    trigger: await evaluate(TRIGGER),
    menu: await evaluate(MENU),
    title: await evaluate(TITLE),
    plus: await evaluate(PLUS),
  }));
  // The menu's state is read by the record (its items), then it is shut.
  await record("closed-menu", openExportMenu);
  await record(
    "closed-drop",
    () => dropFiles(["POSCAR", "config.toml"]),
    async () => ({
      files: await evaluate(FILES),
      alert: await alertText(),
      outline: await evaluate(DRAG_OVER),
    }),
  );
}
