// The toolbar island: the look-along views (a, b, c, and the rotated view), the turn and tilt and spin buttons, and the
// move buttons, and the message line under them (message-line.tsx). A turn or a move is a press (ui/press.ts): it keeps
// going while held. On a phone the row scrolls sideways.
import { Box, type LucideIcon, Rotate3d, RotateCcwSquare, RotateCwSquare } from "lucide-react";
import { useRef } from "react";
import { cn } from "@/lib/utils";
import { panMotion, turnMotion } from "../camera/fly";
import { SHORTCUT } from "../ui/keyboard";
import { beginRotation } from "../ui/pivot";
import { lookAlong } from "../ui/views";
import { AxisViewIcon } from "./axis-view-icon";
import { Divider, Group } from "./group";
import { CUTOUT, ICON } from "./icons";
import { MoveIcon } from "./move-icon";
import { MessageLine } from "./message-line";
import { useOverflowFade } from "./overflow";
import { ScrollChevrons } from "./scroll-chevrons";
import { usePress } from "./press";
import { TipButton } from "./tip";
import { nudge, STILL, spin } from "./motion";

// Lucide icons: 20 px, with strokes that draw 1.46 px lines (crisp on 1x and 2x screens).
// A tool button: its touches pan the row it is in, and it is not selected by a press.
const TOOL = "touch-pan-x select-none [-webkit-touch-callout:none] [-webkit-user-select:none]";
const GROUP = "flex flex-none items-center gap-0.5";

// A look-along button: its axis's icon and letter (AxisViewIcon), or the cube for the rotated view.
function LookAlong({ view, tip }: { view: "a" | "b" | "c" | "rotated"; tip: string }) {
  return (
    <TipButton
      variant="ghost"
      size="icon"
      aria-label={view === "rotated" ? "Rotated view" : `Look along ${view}`}
      tip={tip}
      className={`${TOOL} group/axis relative`}
      onClick={() => lookAlong(view)}
    >
      {view === "rotated" ? <Box {...ICON} /> : <AxisViewIcon axis={view} />}
    </TipButton>
  );
}

// A turn: the axis of the view (x tilts, y turns, z spins) and the sign of its direction. Its icon is Lucide's rotate-3d,
// turned to show the move: as drawn it turns right (the arrow runs over the near side to the right); mirrored, it turns
// left. Turned a quarter (-90°), its ring is the horizontal one: as drawn it tilts up, and mirrored it tilts down.
// The sign of each is checked against the camera's moves in camera/view.ts (rotate: positive is tilt up, turn left).
// The spins keep their own icons (icon); the turns and tilts are the rotate-3d.
function Turn({
  axis,
  sign,
  icon: Icon = Rotate3d,
  transform,
  label,
  tip,
  shortcut,
}: {
  axis: "x" | "y" | "z";
  sign: 1 | -1;
  icon?: LucideIcon;
  transform?: string;
  label: string;
  tip: string;
  shortcut: readonly string[];
}) {
  const press = usePress(() => turnMotion(axis, sign), beginRotation);
  // The hover motion: a spin turns the icon its way; a turn or a tilt nudges it the way the near side goes (a positive
  // turn goes left, a positive tilt up).
  const motion = axis === "z" ? spin(sign) : axis === "y" ? nudge(-sign, 0) : nudge(0, -sign);
  return (
    <TipButton
      variant="ghost"
      size="icon"
      aria-label={label}
      tip={tip}
      shortcut={shortcut}
      className={TOOL}
      style={motion}
      {...press}
    >
      <Icon {...ICON} style={{ transform }} />
    </TipButton>
  );
}

// A move: a step across the view, in screen units (dx right, dy up).
function Move({
  dx,
  dy,
  label,
  tip,
  shortcut,
}: {
  dx: number;
  dy: number;
  label: string;
  tip: string;
  shortcut: readonly string[];
}) {
  const press = usePress(() => panMotion(dx, dy));
  return (
    <TipButton
      variant="ghost"
      size="icon"
      aria-label={label}
      tip={tip}
      shortcut={shortcut}
      className={cn(TOOL, "group/move", CUTOUT)}
      style={STILL}
      {...press}
    >
      <MoveIcon dx={dx} dy={dy} />
    </TipButton>
  );
}

export function ToolBar() {
  const ref = useRef<HTMLDivElement>(null);
  useOverflowFade(ref);
  return (
    <div className="tools-stack">
      <div id="tools" ref={ref} role="toolbar" aria-label="View controls" className="island">
        <Group label="Look along" className={GROUP}>
          <LookAlong view="a" tip="Look along a (b right, c up)" />
          <LookAlong view="b" tip="Look along b (c up)" />
          <LookAlong view="c" tip="Look along c (a right, b up)" />
          <LookAlong view="rotated" tip="Rotated view, as in the 3to2d renders" />
        </Group>
        <Divider className="mx-1 my-1.5 flex-none" />
        <Group label="Rotate" className={GROUP}>
          <Turn
            axis="x"
            sign={1}
            transform="rotate(-90deg)"
            label="Tilt up"
            tip="Tilt up, hold to keep turning"
            shortcut={SHORTCUT.turnUp}
          />
          <Turn
            axis="x"
            sign={-1}
            transform="rotate(-90deg) scaleX(-1)"
            label="Tilt down"
            tip="Tilt down"
            shortcut={SHORTCUT.turnDown}
          />
          <Turn
            axis="y"
            sign={1}
            transform="scaleX(-1)"
            label="Turn left"
            tip="Turn left"
            shortcut={SHORTCUT.turnLeft}
          />
          <Turn axis="y" sign={-1} label="Turn right" tip="Turn right" shortcut={SHORTCUT.turnRight} />
          <Turn
            axis="z"
            sign={-1}
            icon={RotateCcwSquare}
            label="Spin anticlockwise"
            tip="Spin anticlockwise"
            shortcut={SHORTCUT.spinAnticlockwise}
          />
          <Turn
            axis="z"
            sign={1}
            icon={RotateCwSquare}
            label="Spin clockwise"
            tip="Spin clockwise"
            shortcut={SHORTCUT.spinClockwise}
          />
        </Group>
        <Divider className="mx-1 my-1.5 flex-none" />
        <Group label="Move" className={GROUP}>
          <Move dx={0} dy={1} label="Move up" tip="Move up" shortcut={SHORTCUT.moveUp} />
          <Move dx={0} dy={-1} label="Move down" tip="Move down" shortcut={SHORTCUT.moveDown} />
          <Move dx={-1} dy={0} label="Move left" tip="Move left" shortcut={SHORTCUT.moveLeft} />
          <Move dx={1} dy={0} label="Move right" tip="Move right" shortcut={SHORTCUT.moveRight} />
        </Group>
      </div>
      <ScrollChevrons scroller={ref} />
      <MessageLine />
    </div>
  );
}
