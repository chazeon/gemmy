// The lens and zoom row, bottom-left under the axis triad's labels: the aperture button in the corner, and to its right
// one island that folds into it (ui/panels.ts). The island holds the lenses (the focal lengths in the config, then ∞ for
// orthographic, each Lucide's lens with its number; three lenses at a time, scrolling, with ∞ always in view), the zoom
// (−, the multiple of the fit, +) and Fit. The lens in use is the secondary variant, and so is the aperture button while
// the island is open. + and − are holds (press.ts).
import { Aperture, Minus, Plus, type LucideIcon, ScanBox } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { zoomMotion } from "../camera/fly";
import { fit, switchProjection } from "../camera/view";
import { GEMMY } from "../config";
import { lens, projection, zoomLabel } from "../state";
import { SHORTCUT } from "../ui/keyboard";
import { toggleViewControls, viewControlsOpen } from "../ui/panels";
import { Divider, Group } from "./group";
import { CUTOUT, ICON, ICON_SMALL } from "./icons";
import { LensIcon } from "./lens-icon";
import { useOverflowFade } from "./overflow";
import { PANEL_MOTION, usePresence } from "./presence";
import { usePress } from "./press";
import { Tip } from "./tip";
import { useSignal } from "./use-signal";
import { spin } from "./motion";

// The aperture button's island: 44 px square (the island's own padding, then a 36 px button).
const APERTURE_ISLAND = "island w-11 flex-none flex-col overflow-visible";
// The orthographic lens is an infinitely long one: its data-lens tag is "inf" (the test and the page's own lookups).
const ORTHO_LENS = Infinity;
const ORTHO_TAG = "inf";

// A lens button is on when it is the perspective lens in use, or the orthographic one when that is in use.
function lensOn(focal: number, persp: boolean, current: number): boolean {
  return focal === ORTHO_LENS ? !persp : persp && focal === current;
}

function LensButton({ focal }: { focal: number }) {
  const persp = useSignal(projection) === "persp";
  const current = useSignal(lens);
  const ortho = focal === ORTHO_LENS;
  const on = lensOn(focal, persp, current);
  const tip = ortho
    ? "Orthographic (an infinitely long lens): no perspective, as in the 3to2d renders"
    : `${focal} mm lens on a ${GEMMY.sensorWidth} mm sensor`;
  return (
    <Tip text={tip} side="top">
      <Button
        variant={on ? "secondary" : "ghost"}
        size="icon"
        type="button"
        data-lens={ortho ? ORTHO_TAG : String(focal)}
        aria-pressed={on}
        aria-label={ortho ? "Orthographic" : `${focal} mm`}
        className={cn(CUTOUT, "shrink-0 snap-center p-0 aria-pressed:[--cutout:var(--hover)]")}
        onClick={() => (ortho ? switchProjection("ortho") : switchProjection("persp", focal))}
      >
        <LensIcon focal={ortho ? null : focal} />
      </Button>
    </Tip>
  );
}

// A zoom button: a hold keeps zooming (press.ts), so its handlers are the press's. Smaller than the other buttons (a
// 16 px icon in a 24 px button) and with no hover background: its lines thicken instead, so −, the zoom and + sit
// close together as one control.
function ZoomButton({ sign, label, icon: Icon }: { sign: 1 | -1; label: string; icon: LucideIcon }) {
  const press = usePress(() => zoomMotion(sign));
  return (
    <Tip text={`${label}, hold to keep zooming`} shortcut={sign > 0 ? SHORTCUT.zoomIn : SHORTCUT.zoomOut} side="top">
      <Button
        variant="ghost"
        size="icon"
        type="button"
        aria-label={label}
        className="group/zoom w-6 touch-none select-none hover:bg-transparent dark:hover:bg-transparent"
        {...press}
      >
        <Icon
          {...ICON_SMALL}
          className="transition-[stroke-width] duration-[120ms] group-hover/zoom:[stroke-width:2.75] motion-reduce:transition-none"
        />
      </Button>
    </Tip>
  );
}

// The aperture button: folds the island away, or opens it. Its state is the secondary variant when open.
function ApertureButton() {
  const open = useSignal(viewControlsOpen);
  return (
    <Tip text="Lens and zoom" side="top">
      <Button
        variant={open ? "secondary" : "ghost"}
        size="icon"
        type="button"
        id="view-toggle"
        aria-label="Lens and zoom"
        aria-expanded={open}
        aria-controls="lens-group zoom-group"
        onClick={toggleViewControls}
        style={spin(1, 45)}
      >
        <Aperture {...ICON} />
      </Button>
    </Tip>
  );
}

// The zoom readout: the zoom as a multiple of the fit, from the frame loop's signal (render/loop.ts).
function ZoomReadout() {
  const text = useSignal(zoomLabel);
  return (
    <Tip text="Zoom; 1× fits the structure to the window" side="top">
      <output id="zoom-level" className="block w-8 text-center text-xs tabular-nums select-none">
        {text}
      </output>
    </Tip>
  );
}

export function LensRow() {
  const { shown, state } = usePresence(useSignal(viewControlsOpen));
  // The island is kept mounted when folded (hidden), so the page's lens and zoom state stays in the DOM. It folds left
  // into the aperture button.
  const hidden = shown ? "" : "hidden";
  return (
    <div id="lens-column">
      <div className={APERTURE_ISLAND}>
        <ApertureButton />
      </div>
      <div
        data-state={state}
        className={`island min-w-0 flex-row items-center overflow-visible ${PANEL_MOTION} origin-left data-[state=closed]:slide-out-to-left-2 data-[state=open]:slide-in-from-left-2 ${hidden}`}
      >
        <Group
          id="lens-group"
          label="Lens: focal length in millimetres, infinity is orthographic"
          className="flex min-w-0 items-center gap-0.5"
        >
          <LensScroller shown={shown} />
          <LensButton focal={ORTHO_LENS} />
        </Group>
        <Divider className="mx-0.5 my-1.5" />
        <Group id="zoom-group" label="Zoom" className="flex items-center">
          <ZoomButton sign={-1} label="Zoom out" icon={Minus} />
          <ZoomReadout />
          <ZoomButton sign={1} label="Zoom in" icon={Plus} />
        </Group>
        <Divider className="mx-0.5 my-1.5" />
        <Tip text="Fit to window" shortcut={SHORTCUT.fit} side="top">
          <Button variant="ghost" size="icon" type="button" aria-label="Fit to window" onClick={() => fit()}>
            <ScanBox {...ICON} />
          </Button>
        </Tip>
      </div>
    </div>
  );
}

// The perspective lenses: three at a time in a row that scrolls sideways (a wheel scrolls it too), faded at an edge
// with more lenses past it, as the toolbars are (ui/overflow.ts). The lens chosen is scrolled to the middle. ∞ is not
// in it: it stays in view after it.
// A folded row is hidden, and a scroll into view does nothing there: so the chosen lens is brought into view again
// when the row is shown.
function LensScroller({ shown }: { shown: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useOverflowFade(ref);
  const persp = useSignal(projection) === "persp";
  const current = useSignal(lens);
  const chosen = persp ? current : null;
  useEffect(() => {
    if (chosen === null || !shown) return;
    ref.current?.querySelector(`[data-lens="${chosen}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [chosen, shown]);
  return (
    <div
      ref={ref}
      onWheel={(event) => {
        if (ref.current && event.deltaX === 0) ref.current.scrollLeft += event.deltaY;
      }}
      className="fade-row flex w-[112px] min-w-0 shrink snap-x snap-mandatory scroll-smooth items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {GEMMY.lenses.map((focal) => (
        <LensButton key={focal} focal={focal} />
      ))}
    </div>
  );
}
