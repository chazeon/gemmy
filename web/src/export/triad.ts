// The a b c triad, as the page draws it: lines, arrow heads and editable text. The sizes come from triadLayout.
import { Vector2 } from "three";
import { AXIS_FONT, LOOK } from "../config";
import { triadLayout } from "../camera/framing";
import { el, pointList, textEl } from "./markup";
import type { Ctx } from "./shape";
import { vec3 } from "./view";

export function triadSvg(ctx: Ctx): string {
  const { o, view } = ctx;
  const dirs = o.lattice.map((vec) => {
    const v = vec3(vec);
    return [v.dot(view.right), v.dot(view.up), v.dot(view.back)];
  });
  const tri = triadLayout(dirs, o.width, o.height);
  const items: string[] = [];
  for (const it of tri.items) {
    const color = LOOK.axisColors[it.index];
    if (it.head) {
      items.push(el("line", { x1: tri.origin[0], y1: tri.origin[1], x2: it.shaftEnd[0], y2: it.shaftEnd[1], stroke: color, "stroke-width": tri.lineWidth }));
      items.push(el("polygon", { points: pointList(it.head.map(([x, y]: [number, number]) => new Vector2(x, y))), fill: color }));
    }
    items.push(textEl("text", {
      x: it.label.x,
      y: it.label.y,
      fill: color,
      "text-anchor": "middle",
      "dominant-baseline": "central",
      "font-family": `'${AXIS_FONT.family}', sans-serif`,
      "font-style": "italic",
      "font-weight": 700,
      "font-size": tri.fontSize,
    }, "abc"[it.index]));
  }
  items.push(el("circle", { cx: tri.origin[0], cy: tri.origin[1], r: tri.dotRadius, fill: o.boxColor }));
  return el("g", { id: "triad", "stroke-linecap": "round" }, items.join(""));
}
