// The single-file page drops a structure: it cannot compile one, and its card says so. The card covers the page, so the
// layout is measured after a fresh load of the page, as a user would see it.

export async function run(context) {
  const { record, dropFiles, waitFor, alertText, page, base, s, settle } = context;
  await record(
    "drop-structure",
    async () => {
      await dropFiles(["POSCAR"]);
      await waitFor(`document.querySelector('#home [role="alert"]')`, "the card's alert");
    },
    async () => ({ alert: await alertText() }),
  );
  await s("Page.navigate", { url: new URL(page.path, base).href });
  await waitFor(
    `window.__gl.clear > 0 && document.getElementById("zoom-level").textContent !== ""`,
    "the reload",
  );
  await settle();
}
