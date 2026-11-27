// The structure a hosted site's card opened (site/index.html, the card's example): compiled in the page, so the dock has
// the style sections and the Atoms section has the colour-scheme dropdown. The step records what the page shows;
// tests/test_browser.py checks it.
const SECTIONS = `[...document.querySelectorAll('#inspector [data-slot="collapsible-trigger"] span.truncate')].map((s) => s.textContent.trim())`;
// The colour-scheme row of the style panel (Atoms), by its label: its control is a select or a combobox.
const SCHEME_CONTROL = `(() => {
  const row = [...document.querySelectorAll("#inspector .tp-lblv")].find((r) => r.querySelector(".tp-lblv_l")?.textContent.trim() === "Colour scheme");
  return row ? row.querySelector('select, [role="combobox"], button') !== null : false;
})()`;

export async function run(context) {
  const { record, evaluate } = context;
  await record("structure-page", null, async () => ({
    sections: await evaluate(SECTIONS),
    colourScheme: await evaluate(SCHEME_CONTROL),
  }));
}
