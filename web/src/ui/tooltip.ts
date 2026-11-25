// Tooltips: a control's title moves to data-tip, so the browser's slow native tooltip stays away, and the tooltip shows
// in #tip after a short hover. A control in the bottom-left column gets its tip to the right; any other gets one
// centred below it (in the top half of the window) or above it (in the bottom half).
import { MathUtils } from "three";
import { closestOf } from "./dom";

const TIP_DELAY_MS = 300;
const TIP_GAP_PX = 8;
const tip = Object.assign(document.createElement("div"), { id: "tip", role: "tooltip" });
let tipTimer = 0;

function hideTip() {
  window.clearTimeout(tipTimer);
  tip.classList.remove("on");
}
function showTip(el: HTMLElement) {
  tip.textContent = el.dataset.tip ?? "";
  placeTip(el);
  tip.classList.add("on");
}
function placeTip(el: HTMLElement) {
  const r = el.getBoundingClientRect(),
    t = tip.getBoundingClientRect();
  const [x, y] = el.closest("#bottom") ? tipBesideLeftColumn(r, t) : tipCentredVertically(r, t);
  // Kept inside the window: a tip wider than the window sticks to its low edge (MathUtils.clamp's order).
  tip.style.left = `${MathUtils.clamp(x, TIP_GAP_PX, innerWidth - t.width - TIP_GAP_PX)}px`;
  tip.style.top = `${MathUtils.clamp(y, TIP_GAP_PX, innerHeight - t.height - TIP_GAP_PX)}px`;
}
function tipBesideLeftColumn(r: DOMRect, t: DOMRect): [number, number] {
  return [r.right + TIP_GAP_PX, r.top + r.height / 2 - t.height / 2];
}
function tipCentredVertically(r: DOMRect, t: DOMRect): [number, number] {
  const x = r.left + r.width / 2 - t.width / 2;
  const y = r.top < innerHeight / 2 ? r.bottom + TIP_GAP_PX : r.top - TIP_GAP_PX - t.height;
  return [x, y];
}

export function wireTooltips(): void {
  document.body.appendChild(tip);
  document.addEventListener("pointerover", (e) => {
    const el = closestOf(e.target, "[title], [data-tip]");
    if (!el || e.pointerType === "touch") return;
    if (el.hasAttribute("title")) {
      el.dataset.tip = el.title;
      el.removeAttribute("title");
    }
    window.clearTimeout(tipTimer);
    tipTimer = window.setTimeout(() => showTip(el), TIP_DELAY_MS);
  });
  document.addEventListener("pointerout", (e) => {
    if (closestOf(e.target, "[data-tip]")) hideTip();
  });
  for (const ev of ["pointerdown", "keydown", "wheel"]) document.addEventListener(ev, hideTip, { passive: true });
}
