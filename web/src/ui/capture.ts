// Capture mode: the page with the stage alone, for scripts and tests (docs/ui.md, "Capture mode"). The address turns it on
// with ?capture=1, as ?open=1 turns on the file openers (open-files.ts). This is the one place the flag is read; main.ts
// leaves out the overlay and the page's inputs when it is on, the triad is not drawn, and web/style.css hides what is
// left of the controls under the `capture` class on <html>. ui/capture-api.ts is the page's programmatic side.
const CAPTURE_PARAM = "capture";
const CAPTURE_CLASS = "capture";

export const captureMode = new URLSearchParams(location.search).get(CAPTURE_PARAM) === "1";
if (captureMode) document.documentElement.classList.add(CAPTURE_CLASS);
