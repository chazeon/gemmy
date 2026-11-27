// The inspector dock: the column on the right of the page that holds the View section (on every tab) and the style sections of
// a structure tab (Atoms, Bonds, Shapes and Cell). On a wide screen it is the stock Sidebar (components/ui/sidebar.tsx); on a
// phone it is a bottom sheet, opened by the customize button (react/customize-button.tsx), with the same sections. The
// picked object's details are the details card's (react/selection-card.tsx), and the edge tab opens the dock on a wide screen
// (react/inspector-toggle.tsx). Its open state is ui/panels.ts's (inspector). It has no title bar and no close button: the same
// tab or button shuts it.
import { X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Sidebar, SidebarContent, SidebarGroup } from "@/components/ui/sidebar";
import { useIsMobile } from "@/hooks/use-mobile";
import { AtomsSection, BondsSection, ShapesSection } from "../style-panel/sections";
import { ViewSection } from "../style-panel/view-section";
import { CellSection } from "../style-panel/cell";
import type { SectionProps } from "../style-panel/props";
import { note } from "../../ui/message";
import { clearSectionFocus, inspector, revealFolder, toggleInspector } from "../../ui/panels";
import { compiling, panelFacts } from "../../ui/structure-config";
import { activeModel, type StructureModel } from "../../ui/structure-model";
import { readout } from "../../ui/readout";
import { useSignal } from "../use-signal";
import { ICON_SMALL } from "../icons";
import { TipButton } from "../tip";
import { DOCK_NOTE } from "./contract";
import { styleTargetOf } from "../style-panel/style-target";
import { revealStyle } from "../style-panel/style-reveal";

export function Inspector() {
  const { focus, open } = useSignal(inspector);
  const model = useSignal(activeModel);
  const selected = useSignal(readout);
  // The dock says while a changed config is compiling (ui/structure-config.ts): the browser test waits for it to end.
  const busy = useSignal(compiling);
  // A click on an object shows the open dock the style it uses (style-target.ts): its section opens and its folder is
  // revealed. A shut dock stays shut, and a deselect (none) does nothing to the folders.
  useEffect(() => {
    const model = activeModel.value;
    if (model === null || !inspector.value.open) return;
    const target = styleTargetOf(selected, model.config.value);
    if (target === null) return;
    revealFolder(target.section);
    revealStyle(target);
  }, [selected]);
  // A section the dock was opened at that is not on this tab is not on the page: the request is dropped here.
  useEffect(() => {
    if (focus !== null) clearSectionFocus();
  }, [focus]);
  const phone = useIsMobile();
  const sections = (
    <>
      <SidebarGroup>
        <ViewSection />
      </SidebarGroup>
      {model === null ? (
        <SidebarGroup>
          <p className={DOCK_NOTE}>Open a structure file to style it.</p>
        </SidebarGroup>
      ) : (
        <StructureSections model={model} />
      )}
    </>
  );
  // On a phone the dock is the page's bottom sheet: it is there while open and gone when shut (no slide). Its close button shuts
  // it, as the edge tab does on a wide screen (its focus goes back to the customize button, ui/panels.ts).
  if (phone) {
    if (!open) return null;
    return (
      <Card
        id="inspector"
        role="complementary"
        tabIndex={-1}
        aria-label="Style panel"
        data-compiling={busy || undefined}
        className="sheet min-h-0 gap-0 py-0 outline-none no-scene:hidden"
      >
        <div className="flex justify-end px-3 pt-2">
          <TipButton
            variant="ghost"
            size="icon-xs"
            aria-label="Close the style panel"
            tip="Close the style panel"
            onClick={toggleInspector}
          >
            <X {...ICON_SMALL} />
          </TipButton>
        </div>
        <div className="min-h-0 flex-1 touch-pan-y overflow-y-auto pt-2 pb-3 [scrollbar-gutter:stable]">{sections}</div>
      </Card>
    );
  }
  // The stock Sidebar (components/ui/sidebar.tsx) keeps its content mounted and slides it off-canvas when shut; its open state
  // is the inspector signal (the provider in react/overlay.tsx). The edge tab is its one toggle (docs/ui.md).
  return (
    <Sidebar
      side="right"
      variant="sidebar"
      id="inspector"
      role="complementary"
      tabIndex={-1}
      aria-label="Style panel"
      data-compiling={busy || undefined}
      className="no-scene:hidden"
    >
      <SidebarContent className="pt-2 pb-3 [scrollbar-gutter:stable]">{sections}</SidebarContent>
    </Sidebar>
  );
}

// The four sections of a structure tab, each with the config the panel edits: a change is the model's config, which the
// watch in ui/structure-config.ts recompiles. Each section draws its own frame (DockSection).
function StructureSections({ model }: { model: StructureModel }) {
  const config = useSignal(model.config);
  const facts = useMemo(() => panelFacts(model), [model]);
  const props: SectionProps = {
    config,
    names: facts.names,
    distances: facts.distances,
    partial: facts.partial,
    onChange: (next) => {
      model.config.value = next;
    },
    onError: (message) => note(message),
  };
  return (
    <>
      <SidebarGroup>
        <AtomsSection {...props} />
      </SidebarGroup>
      <SidebarGroup>
        <BondsSection {...props} />
      </SidebarGroup>
      <SidebarGroup>
        <ShapesSection {...props} />
      </SidebarGroup>
      <SidebarGroup>
        <CellSection {...props} />
      </SidebarGroup>
    </>
  );
}
