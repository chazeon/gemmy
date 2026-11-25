// The abc triad: the three lattice directions drawn in 2D from the camera's orientation. It is drawn on the page after
// every frame, and into a canvas of its own by the menu's PNG export (drawTriad takes the canvas, context and ratio).
import { type TriadItem, triadLayout } from "../camera/framing";
import { AXIS_FONT, LOOK, axisFontFace } from "../config";
import { camera, lattice, requestRender } from "../state";
import { MAX_PIXEL_RATIO, cssVar, stage } from "./draw";

// The size in the font-loading request. Any size loads the face, so this only names it.
const FONT_LOAD_PX = 16;
const AXIS_FONT_STYLE = "italic 700"; // the axis letters' face: the bundled bold italic
const AXIS_LETTERS = "abc"; // the lattice vectors a, b, c
const FULL_TURN = 2 * Math.PI;

const triadCanvas = document.getElementById("triad") as HTMLCanvasElement;
const triadContext = triadCanvas.getContext("2d") as CanvasRenderingContext2D;

// The label face goes into the page once, and the triad waits for it: a canvas never falls back to another font and
// redraws by itself, so the triad is skipped until the face has loaded and requestRender then draws it.
document.head.appendChild(Object.assign(document.createElement("style"), { textContent: axisFontFace() }));
let axisFontReady = false;
document.fonts.load(`${AXIS_FONT_STYLE} ${FONT_LOAD_PX}px "${AXIS_FONT.family}"`).finally(() => {
  axisFontReady = true;
  requestRender();
});

// Draws the triad into `canvas`, sized to the stage at `dpr` pixels per CSS pixel. Returns the layout it drew, or
// nothing while the axis font is still loading.
export function drawTriad(
  canvas = triadCanvas,
  ctx = triadContext,
  dpr = Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO),
): ReturnType<typeof triadLayout> | undefined {
  const width = stage.clientWidth;
  const height = stage.clientHeight;
  sizeCanvas(canvas, width, height, dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  if (!axisFontReady) return undefined;
  const triad = triadLayout(latticeInView(), width, height);
  ctx.lineCap = "round"; // round ends, like Blender's axis triad
  ctx.lineWidth = triad.lineWidth;
  for (const item of triad.items) drawAxis(ctx, item, triad.origin, triad.fontSize);
  drawOrigin(ctx, triad.origin, triad.dotRadius);
  return triad;
}

// The lattice vectors as the camera sees them: the view rotated back by the camera's orientation.
function latticeInView(): number[][] {
  const inverse = camera.quaternion.clone().invert();
  return lattice.map((vector) => vector.clone().applyQuaternion(inverse).toArray());
}

// One axis: its shaft and head from the origin (the far ones first, see triadLayout), then its letter at the label.
function drawAxis(ctx: CanvasRenderingContext2D, item: TriadItem, origin: readonly number[], fontSize: number): void {
  const color = LOOK.axisColors[item.index];
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  if (item.head && item.shaftEnd) {
    drawShaft(ctx, origin, item.shaftEnd);
    drawHead(ctx, item.head);
  }
  ctx.font = `${AXIS_FONT_STYLE} ${fontSize}px ${cssVar("--label")}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(AXIS_LETTERS[item.index], item.label.x, item.label.y);
}

function drawShaft(ctx: CanvasRenderingContext2D, from: readonly number[], to: readonly number[]): void {
  ctx.beginPath();
  ctx.moveTo(from[0], from[1]);
  ctx.lineTo(to[0], to[1]);
  ctx.stroke();
}

// The three corners of an arrow head: the tip, then the two corners at its base.
function drawHead(ctx: CanvasRenderingContext2D, [tip, left, right]: [number, number][]): void {
  ctx.beginPath();
  ctx.moveTo(tip[0], tip[1]);
  ctx.lineTo(left[0], left[1]);
  ctx.lineTo(right[0], right[1]);
  ctx.closePath();
  ctx.fill();
}

// The dot where the three axes meet, in the box colour.
function drawOrigin(ctx: CanvasRenderingContext2D, [x, y]: readonly number[], radius: number): void {
  ctx.fillStyle = cssVar("--box");
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, FULL_TURN);
  ctx.fill();
}

// Sets the canvas bitmap to dpr pixels per CSS pixel, and its CSS box to the stage size.
function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number, dpr: number): void {
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}
