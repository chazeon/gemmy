// The capture-mode scenario (tests/test_view_capture.py): opens a page with ?capture=1 in Chrome and prints JSON of what
// the page shows and what window.gemmy returns. Usage: node capture.mjs <devtools-port> <page-url>
import { connect } from "./cdp.mjs";

const [portText, url] = process.argv.slice(2);
const browser = await connect(Number(portText));
const { targetId } = await browser.send("Target.createTarget", { url: "about:blank" });
const { sessionId } = await browser.send("Target.attachToTarget", { targetId, flatten: true });
const send = (method, params = {}) => browser.send(method, params, sessionId);
const evaluate = async (expression) => {
  const { result, exceptionDetails } = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
  if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
  return result.value;
};
await send("Page.enable");
await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 480, height: 320, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url });
for (let i = 0; i < 300 && !(await evaluate("!!window.gemmy")); i++) await new Promise((ok) => setTimeout(ok, 100));
const out = {};
let status = 0;
try {
  await evaluate("gemmy.ready()");
  out.ui = await evaluate(`(() => ({
    overlayChildren: document.getElementById("overlay").children.length,
    controls: document.querySelectorAll("button, [role=toolbar], #inspector, #home").length,
    canvases: document.querySelectorAll("#stage canvas").length,
  }))()`);
  out.before = await evaluate("gemmy.state()");
  await evaluate('(gemmy.set({ box: false, theme: "light", transparent: true }), gemmy.rendered())');
  out.after = await evaluate("gemmy.state()");
  out.png = await evaluate(`(async () => {
    const blob = await gemmy.export("png");
    const header = new DataView(await blob.slice(0, 24).arrayBuffer());
    return { type: blob.type, width: header.getUint32(16), height: header.getUint32(20) };
  })()`);
  // The Axes toggle reaches the SVG export: the triad's group is in the document with it on, and not with it off.
  out.svg = await evaluate(`(async () => {
    gemmy.set({ axes: true });
    const shown = await gemmy.export("svg");
    gemmy.set({ axes: false });
    const hidden = await gemmy.export("svg");
    return { shown: shown.includes('id="triad"'), hidden: hidden.includes('id="triad"'), state: gemmy.state().axes };
  })()`);
} catch (error) {
  out.error = String(error);
  status = 1;
}
console.log(JSON.stringify(out));
browser.close();
process.exit(status);
