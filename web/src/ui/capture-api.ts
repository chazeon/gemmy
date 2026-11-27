// The programmatic side of capture mode: window.gemmy, a small facade over the viewer's signals and exports, for scripts and
// tests (docs/ui.md, "Capture mode"). It holds no logic of its own. Installed only in capture mode (ui/capture.ts).
import { galleryNear, structureOf } from "../scene/examples";
import { openSources } from "./loader";
import { applyPose } from "./share";
import { decodeView, encodeView, poseOf } from "../camera/viewhash";
import { viewNow } from "../camera/view";
import { nextFrame } from "../render/loop";
import { stage } from "../render/draw";
import { loaded, outlines, requestRender, showAtoms, showBox } from "../state";
import { makePng, makeSvg } from "./export";
import { OUTLINE_WIDTHS, chooseOutlineScale, outlineScale } from "./outline-scale";
import { type ThemeChoice, setTheme, theme } from "./theme";

const TRANSPARENT_CLASS = "transparent";

export interface CaptureOptions {
  atoms?: boolean;
  box?: boolean;
  outlines?: boolean;
  /** The outline width multiplier: 0.5 (thin), 1 (normal) or 1.75 (bold). */
  outlineWidth?: number;
  theme?: "light" | "dark";
  /** No page background behind the structure. */
  transparent?: boolean;
  /** The camera, as the #view hash writes it: "ortho;zoom=1;eye=x,y,z;at=x,y,z;up=x,y,z". */
  view?: string;
}

const root = document.documentElement;

function set(options: CaptureOptions): void {
  if (options.atoms !== undefined) showAtoms.value = options.atoms;
  if (options.box !== undefined) showBox.value = options.box;
  if (options.outlines !== undefined) outlines.value = options.outlines;
  if (options.outlineWidth !== undefined) {
    if (!OUTLINE_WIDTHS.some((width) => width.value === options.outlineWidth))
      throw new Error(`outlineWidth is one of ${OUTLINE_WIDTHS.map((width) => width.value).join(", ")}`);
    chooseOutlineScale(options.outlineWidth);
  }
  if (options.theme !== undefined) setTheme(options.theme);
  if (options.transparent !== undefined) root.classList.toggle(TRANSPARENT_CLASS, options.transparent);
  if (options.view !== undefined) {
    const pose = decodeView(options.view);
    if (pose === null) throw new Error(`not a view: ${options.view}`);
    applyPose(pose);
  }
  requestRender();
}

function state() {
  return {
    atoms: showAtoms.value,
    box: showBox.value,
    outlines: outlines.value,
    outlineWidth: outlineScale.value,
    theme: theme.value satisfies ThemeChoice,
    transparent: root.classList.contains(TRANSPARENT_CLASS),
    view: encodeView(poseOf(viewNow(), loaded.value.extent)),
    size: { width: stage.clientWidth, height: stage.clientHeight },
  };
}

async function exportView(kind: "png", options?: { transparent?: boolean }): Promise<Blob>;
async function exportView(kind: "svg"): Promise<string>;
async function exportView(kind: "png" | "svg", options: { transparent?: boolean } = {}): Promise<Blob | string> {
  if (kind === "svg") return makeSvg().text;
  const blob = await makePng(options.transparent ?? true);
  if (blob === null) throw new Error("the browser could not make the PNG");
  return blob;
}

const OPEN_TIMEOUT_MS = 60000;

// Opens a gallery example as its card does (scene/examples.ts structureOf), and resolves once its scene is on the stage and
// drawn. For a hosted site's page: the gallery is the examples.json beside it.
async function openExample(name: string): Promise<void> {
  const gallery = await galleryNear(location.href);
  const example = gallery?.examples.find((entry) => entry.name === name);
  if (!gallery || !example) throw new Error(`no example named ${name} in this page's gallery`);
  const before = loaded.value;
  openSources([structureOf(gallery, example)]);
  const started = performance.now();
  while (loaded.value === before) {
    if (performance.now() - started > OPEN_TIMEOUT_MS) throw new Error(`${name} did not load`);
    await new Promise((done) => requestAnimationFrame(done));
  }
  await nextFrame();
}

// `firstTab` settles when the page has shown its first tab (main.ts), then one more frame is drawn.
export function installCaptureApi(firstTab: Promise<void>): void {
  const api = {
    ready: () => firstTab.then(nextFrame),
    openExample,
    set,
    rendered: nextFrame,
    export: exportView,
    state,
  };
  Object.assign(window, { gemmy: api });
}
