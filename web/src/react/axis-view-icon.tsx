// The look-along icon of one axis: Lucide's move-3d, with its two in-plane axes (with their arrowheads) as one group and
// the stub, the axis you look along (going back into the screen), as its own path. The axis's italic letter sits at the
// stub's tip. At rest the icon and the letter are the foreground colour. On hover or keyboard focus of the button (its
// group is group/axis) the stub and the letter take the axis colour, the triad's (LOOK.axisColors in config.ts). The
// stroke is the other toolbar icons' 1.75, and the letter the axis font's regular face (view.py embeds 400 and 700; a
// weight between them would fall to the bold), so the three buttons weigh the same as their neighbours.
import type { CSSProperties } from "react";
import { LOOK } from "../config";

export type Axis = "a" | "b" | "c";

// The letter's top edge, in px from the button's top; its left edge is the same for all three. b is set 0.7 px lower
// than a and c: b has an ascender, so at the same size it looks bigger than the x-height letters, and the lower set puts
// it on the same line as them.
const LETTER_TOP: Record<Axis, number> = { a: 4.5, b: 5.2, c: 4.5 };
const LETTER_LEFT = 19.5;
const AXIS_INDEX: Record<Axis, number> = { a: 0, b: 1, c: 2 };

// Lucide's move-3d paths (the in-plane axes, then the stub); the paths are the same as Lucide's, only split.
const PLANE = ["M5 3v16h16", "m2 6 3-3 3 3", "m18 16 3 3-3 3"];
const STUB = "m5 19 6-6";

export function AxisViewIcon({ axis }: { axis: Axis }) {
  // The axis colour, for the hover and focus states (a CSS variable, so the classes can use it).
  const colour = { "--axis": LOOK.axisColors[AXIS_INDEX[axis]] } as CSSProperties;
  return (
    <>
      <svg
        viewBox="0 0 24 24"
        aria-hidden="true"
        style={colour}
        className="size-5 fill-none stroke-current [stroke-width:1.75] [stroke-linecap:round] [stroke-linejoin:round]"
      >
        {PLANE.map((d) => (
          <path key={d} d={d} />
        ))}
        <path
          d={STUB}
          className="transition-[stroke,stroke-width] duration-[120ms] group-focus-visible/axis:stroke-(--axis) group-focus-visible/axis:[stroke-width:3] group-hover/axis:stroke-(--axis) group-hover/axis:[stroke-width:3] motion-reduce:transition-none"
        />
      </svg>
      <span
        aria-hidden="true"
        style={{ ...colour, left: LETTER_LEFT, top: LETTER_TOP[axis] }}
        className="pointer-events-none absolute origin-bottom-left text-[15px] leading-none font-normal text-foreground italic transition-[scale,color] duration-[120ms] [font-family:var(--label)] group-focus-visible/axis:scale-[1.3] group-focus-visible/axis:text-(--axis) group-hover/axis:scale-[1.3] group-hover/axis:text-(--axis) motion-reduce:transition-none"
      >
        {axis}
      </span>
    </>
  );
}
