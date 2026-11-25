// A lens choice's icon: Lucide's lens with the lens in use cut into its ring at the lower right, the focal length or,
// for orthographic, Lucide's infinity. A halo in the button's own colour (--cutout, set by the button for its rest, hover
// and pressed states) breaks the ring where the mark sits. The lens is 20 px, the toolbar's icon size, and the offsets
// (top-2 and left-2 for the lens, right and bottom for the mark) place both in the 36 px button (size-9). Each icon has
// its own size class, as shadcn's Button resizes the icons in it that have none.
import { Infinity as InfinityIcon, Lens } from "lucide-react";

export function LensIcon({ focal }: { focal: number | null }) {
  return (
    <span className="lens-icon relative block size-9 shrink-0">
      <Lens strokeWidth={1.75} className="absolute top-2 left-2 size-5" />
      {focal === null ? <OrthoMark /> : <FocalMark focal={focal} />}
    </span>
  );
}

function FocalMark({ focal }: { focal: number }) {
  return (
    <span className="absolute right-[8.5px] bottom-[7.5px] text-[10px] leading-none font-semibold tracking-[-0.03em] [paint-order:stroke] [-webkit-text-stroke:3.5px_var(--cutout)]">
      {focal}
    </span>
  );
}

// The infinity is drawn twice, a wide stroke in the halo's colour under the ink.
function OrthoMark() {
  return (
    <span className="absolute right-[7.5px] bottom-[6px] size-3">
      <InfinityIcon strokeWidth={7} className="absolute inset-0 size-3 overflow-visible text-[var(--cutout)]" />
      <InfinityIcon strokeWidth={2.5} className="absolute inset-0 size-3 overflow-visible" />
    </span>
  );
}
