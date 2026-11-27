// The chevrons on a scrolling toolbar's faded edges (the tool row on a phone): a ghost button on each edge that has more
// hidden that way, for a mouse that cannot scroll sideways. A chevron is drawn only while its edge has more (useScrollEdges,
// the same state as the edge's fade) and only for a fine pointer, so none shows on a touch screen, nor while the toolbar is
// hidden (the start screen). Each is absolutely placed by style.css, so it takes no layout space. A click scrolls about 70%
// of the visible width. They are not tab stops: the keyboard reaches the hidden buttons by focus, and the browser scrolls a
// focused button into view.
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { RefObject } from "react";
import { Button } from "@/components/ui/button";
import { useScrollEdges } from "./overflow";

const SHARE_OF_VISIBLE = 0.7;

export function ScrollChevrons({ scroller }: { scroller: RefObject<HTMLElement | null> }) {
  const edges = useScrollEdges(scroller);
  const fine = window.matchMedia("(pointer: fine)").matches;
  const scrollBy = (direction: -1 | 1) => {
    const el = scroller.current;
    if (el === null) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: direction * el.clientWidth * SHARE_OF_VISIBLE, behavior: reduced ? "auto" : "smooth" });
  };
  return (
    <>
      {fine && edges.left && (
        <Button
          type="button"
          variant="ghost"
          tabIndex={-1}
          aria-label="Scroll left"
          className="scroll-chevron scroll-chevron-left h-9 w-5 min-w-0 rounded-none p-0"
          onClick={() => scrollBy(-1)}
        >
          <ChevronLeft size={14} />
        </Button>
      )}
      {fine && edges.right && (
        <Button
          type="button"
          variant="ghost"
          tabIndex={-1}
          aria-label="Scroll right"
          className="scroll-chevron scroll-chevron-right h-9 w-5 min-w-0 rounded-none p-0"
          onClick={() => scrollBy(1)}
        >
          <ChevronRight size={14} />
        </Button>
      )}
    </>
  );
}
