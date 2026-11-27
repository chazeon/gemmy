// The dock's section frame: a 28 px header (the fold's chevron, the title, a count and an optional add button) over a body
// that folds. Each section keeps its own open state, remembered per section (ui/panels.ts). When the dock is opened at this
// section, the frame opens and scrolls to its header.
import { ChevronRight, Plus } from "lucide-react";
import { signal } from "@preact/signals-core";
import { useEffect, useRef, useState } from "react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import type { SceneConfig } from "../../compile/config";
import { clearSectionFocus, inspector, rememberSection, sectionChoice } from "../../ui/panels";
import { activeModel } from "../../ui/structure-model";
import { SectionBoundary } from "../style-panel/section-boundary";
import { TipButton } from "../tip";
import { useSignal } from "../use-signal";
import { DOCK_ICON_BUTTON, type DockSectionProps } from "./contract";

const DEFAULT_OPEN = true;
// The chevron is 7 px with a 2.5 stroke; the count is 11 px, the size of the dock's notes (inspector/contract.ts DOCK_NOTE).
const CHEVRON_SIZE = 7;
const CHEVRON_STROKE = 2.5;
const COUNT_CLASS = "ml-auto text-[11px] font-normal tabular-nums text-(--dock-muted)";
// The config a section with no structure (the dock on a scene tab) resets on: none, so its error stays.
const NO_CONFIG = signal<SceneConfig | null>(null);

export function DockSection({ id, title, count, add, children }: DockSectionProps) {
  const [open, setOpen] = useState(() => sectionChoice(id) ?? DEFAULT_OPEN);
  const root = useRef<HTMLDivElement>(null);
  const { focus } = useSignal(inspector);
  // A section that the user shut stays shut; the dock's opening at it is not a choice, so it is not remembered.
  const choose = (next: boolean) => {
    setOpen(next);
    rememberSection(id, next);
  };
  useEffect(() => {
    if (focus !== id) return;
    setOpen(true);
    root.current?.scrollIntoView({ block: "start" });
    clearSectionFocus();
  }, [focus, id]);
  // A structure's config resets the boundary, as the style panel's did: a section that failed on an old config is tried
  // again on the new one.
  const model = useSignal(activeModel);
  const config = useSignal<SceneConfig | null>(model?.config ?? NO_CONFIG);
  return (
    <Collapsible ref={root} open={open} onOpenChange={choose} className="pt-2 first:pt-0">
      <div className="flex h-(--dock-header) items-center gap-1 pr-(--dock-pad-right) pl-(--dock-edge)">
        <CollapsibleTrigger className="flex h-full min-w-0 flex-none items-center gap-1.5 text-left text-(--dock-font) font-semibold text-foreground hover:text-(--dock-strong)">
          <ChevronRight
            size={CHEVRON_SIZE}
            strokeWidth={CHEVRON_STROKE}
            aria-hidden="true"
            className={cn("-ml-[9px] shrink-0 transition-transform", open && "rotate-90")}
          />
          <span className="truncate">{title}</span>
        </CollapsibleTrigger>
        {/* The add button sits right after the title, small and muted; the count alone keeps the right edge (one column). */}
        {add && (
          <TipButton
            variant="ghost"
            size="icon-xs"
            className={cn(DOCK_ICON_BUTTON, "ml-1")}
            aria-label={add.label}
            tip={add.label}
            onClick={() => {
              if (!open) choose(true);
              add.onAdd(!open);
            }}
          >
            <Plus className="size-3.5" />
          </TipButton>
        )}
        {count !== undefined && <span className={COUNT_CLASS}>{count}</span>}
      </div>
      <CollapsibleContent>
        <SectionBoundary resetKey={config}>{children}</SectionBoundary>
      </CollapsibleContent>
    </Collapsible>
  );
}
