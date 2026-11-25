// A move button's icon: the structure where it was (a dashed square) and where it goes (a solid square over it, filled
// with the button's colour so the dashes under it do not show), with Lucide's long thin arrow (move-up) beside them.
// Drawn for up and mirrored, not turned, for the others, so the arrow keeps its side: right of the squares for up and
// down, under them for left and right. The fill follows the button's hover through --halo (set by the button). On
// hover (the button is group/move) the solid square slides on along the arrow and the arrow with it, while the dashed
// one stays where the structure was; drawn in the icon's own frame, so the mirroring turns the motion too.
import { cn } from "@/lib/utils";

const SLIDE = "transition-transform duration-[180ms] ease-out motion-reduce:transition-none";

// (dx, dy) as the toolbar gives it: dx right, dy up
function transformFor(dx: number, dy: number): string | undefined {
  if (dy > 0) return undefined;
  if (dy < 0) return "scaleY(-1)";
  return dx > 0 ? "rotate(90deg)" : "scaleX(-1) rotate(90deg)";
}

export function MoveIcon({ dx, dy }: { dx: number; dy: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ transform: transformFor(dx, dy) }}
      className="size-5 fill-none stroke-current [stroke-linecap:round] [stroke-linejoin:round] [stroke-width:1.75]"
    >
      <rect width="10" height="10" x="2.5" y="11" rx="1.5" strokeDasharray="2.5 2.5" />
      <rect
        width="10"
        height="10"
        x="2.5"
        y="3"
        rx="1.5"
        className={cn("fill-(--halo)", SLIDE, "group-hover/move:-translate-y-[2.5px]")}
      />
      <g className={cn(SLIDE, "group-hover/move:-translate-y-[1.5px]")}>
        <path d="M15.5 6 18.5 3 21.5 6" />
        <path d="M18.5 3V21" />
      </g>
    </svg>
  );
}
