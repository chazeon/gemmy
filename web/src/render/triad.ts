// The a b c letters of the triad, as flat text on the page over the WebGL canvas. The arrows and the origin ball are 3D
// (triad3d.ts); the letters sit at the projected arrow tips (triad-layout.ts). drawLiveTriad draws them on the page's
// own canvas after the 3D triad; drawTriad draws them into any canvas (the PNG export's).
import { Color } from "three";
import { AXIS_FONT, AXIS_LETTERS, LOOK } from "../config";
import { camera, loaded, requestRender } from "../state";
import { MAX_PIXEL_RATIO, cssVar, stage } from "./draw";
import { type TriadItem, type TriadLayout, latticeInView, triadLayout } from "./triad-layout";

// The size in the font-loading request. Any size loads the face, so this only names it.
const FONT_LOAD_PX = 16;
const AXIS_FONT_STYLE = "italic 700"; // the axis letters' face: the bundled bold italic

const triadCanvas = document.getElementById("triad") as HTMLCanvasElement;
const triadContext = triadCanvas.getContext("2d") as CanvasRenderingContext2D;

// The axis faces join the page once, as FontFace objects: the bold italic for the letters and the regular italic for
// the a/b/c buttons (react/toolbar.tsx). The triad waits for the bold one, since a canvas never falls back to another font and
// redraws by itself: the letters are skipped until it has loaded, and requestRender then draws them.
for (const [weight, base64] of Object.entries(AXIS_FONT.faces)) {
  document.fonts.add(
    new FontFace(AXIS_FONT.family, `url(data:font/ttf;base64,${base64})`, { style: "italic", weight }),
  );
}
let axisFontReady = false;
document.fonts.load(`${AXIS_FONT_STYLE} ${FONT_LOAD_PX}px "${AXIS_FONT.family}"`).finally(() => {
  axisFontReady = true;
  requestRender();
});

// The live view's letters: the page's canvas, at the page's pixel ratio.
export function drawLiveTriad(): void {
  drawTriad(triadCanvas, triadContext, Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO), false);
}

// Draws the letters into `canvas`, sized to the stage at `dpr` pixels per CSS pixel. A transparent image (the PNG
// export) has no page background to fade toward, so its faded letters are drawn at their opacity instead.
export function drawTriad(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  dpr: number,
  transparent: boolean,
): void {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  sizeCanvas(canvas, width, height, dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!axisFontReady) return;
  const lattice = latticeInView(loaded.value.lattice, camera.value.quaternion);
  const background = transparent ? null : cssVar("--bg").trim();
  drawLetters(ctx, triadLayout(lattice, width, height), background);
}

// The letters of a laid-out triad, each at its label. Background null: the full colour, the fade being applied as
// opacity.
function drawLetters(ctx: CanvasRenderingContext2D, triad: TriadLayout, background: string | null): void {
  for (const item of triad.items) drawLetter(ctx, item, triad.fontSize, background);
}

// One letter at its label. Its colour is mixed toward the background by how far its axis points away.
function drawLetter(ctx: CanvasRenderingContext2D, item: TriadItem, fontSize: number, background: string | null): void {
  const base = LOOK.axisColors[item.index];
  ctx.save();
  if (background === null) {
    ctx.globalAlpha = 1 - item.fade;
    ctx.fillStyle = base;
  } else {
    ctx.fillStyle = new Color(base).lerp(new Color(background), item.fade).getStyle();
  }
  ctx.font = `${AXIS_FONT_STYLE} ${fontSize}px ${cssVar("--label")}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(AXIS_LETTERS[item.index], item.label.x, item.label.y);
  ctx.restore();
}

// Sets the canvas bitmap to dpr pixels per CSS pixel, and its CSS box to the stage size.
function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number, dpr: number): void {
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}
