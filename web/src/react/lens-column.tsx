// The lens and zoom row, bottom-left under the axis triad's labels: the aperture button in the corner, and to its right
// one island that folds into it (ui/panels.ts) with the lenses (the focal lengths in the config, then ∞ for
// orthographic, each Lucide's lens with its number; three lenses at a time, scrolling, and ∞ always in view), the zoom (−, the multiple of the fit, +) and fit. The lens in use and the row's
// open state are the secondary variant. + and − are holds (press.ts).
import { Aperture, Minus, Plus, type LucideIcon, ScanBox } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { zoomMotion } from "../camera/fly";
import { fit, switchProjection } from "../camera/view";
import { GEMMY } from "../config";
import { lens, projection, zoomLabel } from "../state";
import { SHORTCUT } from "../ui/keyboard";
import { toggleViewControls, viewControlsOpen } from "../ui/panels";
import { LensIcon } from "./lens-icon";
import { useOverflowFade } from "./overflow";
import { PANEL_MOTION, usePresence } from "./presence";
import { usePress } from "./press";
import { Tip } from "./tip";
import { useSignal } from "./use-signal";
import { spin } from "./motion";

const TIP_DELAY_MS = 300;
// The aperture button's island: 44 px square (the island's own padding, then a 36 px button).
const ISLAND = "island w-11 flex-col overflow-visible";
const ICON = { size: 20, strokeWidth: 1.75 };
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
        className="shrink-0 snap-center p-0 [--halo:var(--bar)] hover:[--halo:var(--hover)] aria-pressed:[--halo:var(--hover)]"
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
          size={16}
          strokeWidth={1.75}
          className="size-4 transition-[stroke-width] duration-[120ms] group-hover/zoom:[stroke-width:2.75] motion-reduce:transition-none"
        />
      </Button>
    </Tip>
  );
}

// The aperture button: folds the column's two islands away, or opens them. Its state is the secondary variant when open.
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

export function LensColumn() {
  const { shown, state } = usePresence(useSignal(viewControlsOpen));
  // The island is kept mounted when folded (hidden), so the page's lens and zoom state stays in the DOM. It folds left
  // into the aperture button.
  const hidden = shown ? "" : "hidden";
  return (
    <TooltipProvider delayDuration={TIP_DELAY_MS}>
      <div id="lens-column">
        <div className={ISLAND}>
          <ApertureButton />
        </div>
        <div
          data-state={state}
          className={`island flex-row items-center overflow-visible ${PANEL_MOTION} origin-left data-[state=closed]:slide-out-to-left-2 data-[state=open]:slide-in-from-left-2 ${hidden}`}
        >
          {/* biome-ignore lint/a11y/useSemanticElements: a div keeps the row's flex layout; a fieldset is a form control */}
          <div
            id="lens-group"
            role="group"
            aria-label="Lens: focal length in millimetres, infinity is orthographic"
            className="flex items-center gap-0.5"
          >
            <LensScroller />
            <LensButton focal={ORTHO_LENS} />
          </div>
          <Rule />
          {/* biome-ignore lint/a11y/useSemanticElements: a div keeps the row's flex layout; a fieldset is a form control */}
          <div id="zoom-group" role="group" aria-label="Zoom" className="flex items-center">
            <ZoomButton sign={-1} label="Zoom out" icon={Minus} />
            <ZoomReadout />
            <ZoomButton sign={1} label="Zoom in" icon={Plus} />
          </div>
          <Rule />
          <Tip text="Fit to window" shortcut={SHORTCUT.fit} side="top">
            <Button variant="ghost" size="icon" type="button" aria-label="Fit to window" onClick={() => fit()}>
              <ScanBox {...ICON} />
            </Button>
          </Tip>
        </div>
      </div>
    </TooltipProvider>
  );
}

// The perspective lenses: three at a time in a row that scrolls sideways (a wheel scrolls it too), faded at an edge
// with more lenses past it, as the toolbars are (ui/overflow.ts). The lens chosen is scrolled to the middle. ∞ is not
// in it: it stays in view after it.
function LensScroller() {
  const ref = useRef<HTMLDivElement>(null);
  useOverflowFade(ref);
  const persp = useSignal(projection) === "persp";
  const current = useSignal(lens);
  const chosen = persp ? current : null;
  useEffect(() => {
    if (chosen === null) return;
    ref.current?.querySelector(`[data-lens="${chosen}"]`)?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [chosen]);
  return (
    <div
      ref={ref}
      onWheel={(event) => {
        if (ref.current && event.deltaX === 0) ref.current.scrollLeft += event.deltaY;
      }}
      className="tabs flex w-[112px] snap-x snap-mandatory scroll-smooth items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {GEMMY.lenses.map((focal) => (
        <LensButton key={focal} focal={focal} />
      ))}
    </div>
  );
}

// A thin rule between the row's groups
function Rule() {
  // biome-ignore lint/a11y/useSemanticElements: a rule between two buttons, drawn as a div (as the toolbar does)
  return <div role="separator" aria-orientation="vertical" className="mx-0.5 my-1.5 w-px self-stretch bg-border" />;
}
