// The lens buttons: a focal length is a perspective camera; infinity is orthographic, the limit of a long lens. The
// camera move that switches (camera/view.ts switchProjection) keeps the framing and the view; this file only wires the
// buttons and keeps them pressed to the lens in use.
import { effect } from "@preact/signals-core";
import { GEMMY } from "../config";
import { lens, projection } from "../state";
import { switchProjection } from "../camera/view";
import { byId } from "./dom";

const ORTHO_LENS = Infinity;
const ORTHO_TAG = "inf"; // the data-lens value of the orthographic button

const lensGroup = byId("lens-group");

// A lens button is pressed when it is the perspective lens in use, or the orthographic one when that is in use.
function isLensOn(button: HTMLElement, persp: boolean, focal: number): boolean {
  const value = button.dataset.lens;
  return value === ORTHO_TAG ? !persp : persp && Number(value) === focal;
}

function addLensButton(focalLength: number) {
  const ortho = focalLength === ORTHO_LENS;
  const button = document.createElement("button");
  Object.assign(button, {
    type: "button",
    className: "pill lens",
    textContent: ortho ? "∞" : String(focalLength),
    title: ortho
      ? "Orthographic (an infinitely long lens): no perspective, as in the 3to2d renders"
      : `${focalLength} mm lens on a ${GEMMY.sensorWidth} mm sensor`,
  });
  button.dataset.lens = ortho ? ORTHO_TAG : String(focalLength);
  button.setAttribute("aria-label", ortho ? "Orthographic" : `${focalLength} mm`);
  button.addEventListener("click", () => {
    if (ortho) switchProjection("ortho");
    else switchProjection("persp", focalLength);
  });
  if (ortho) lensGroup.insertAdjacentHTML("beforeend", '<span class="unit">mm</span>'); // reads "24 … 85 mm ∞"
  lensGroup.appendChild(button);
}

// Builds the lens buttons (the lenses in the config, then the orthographic one) and keeps them pressed.
export function wireLensBar(): void {
  for (const focalLength of [...GEMMY.lenses, ORTHO_LENS]) addLensButton(focalLength);
  // The buttons follow the lens and the projection in use (the signals camera/view.ts commit writes).
  effect(() => {
    const persp = projection.value === "persp";
    for (const button of lensGroup.querySelectorAll<HTMLElement>("[data-lens]")) {
      button.setAttribute("aria-pressed", String(isLensOn(button, persp, lens.value)));
    }
  });
}
