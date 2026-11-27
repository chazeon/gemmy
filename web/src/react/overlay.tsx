// The React overlay: the viewer's floating controls, drawn by React over the three.js canvas. The canvas, the rendering,
// the camera and the scene loading stay plain TypeScript; the components call into them.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";
import { takeServerLinks } from "../ui/tab-bar";
import { inspector } from "../ui/panels";
import { CornerButtons } from "./corner-buttons";
import { ExportArea } from "./export-menu";
import { Inspector } from "./inspector/inspector";
import { InspectorToggle } from "./inspector-toggle";
import { Home } from "./home";
import { LensRow } from "./lens-row";
import { SelectionCard } from "./selection-card";
import { TopBar } from "./top-bar";
import { useSignal } from "./use-signal";
import type { CSSProperties } from "react";

const TIP_DELAY_MS = 300;

// The dock's width is the page's own token (style.css --dock-width), which the stock Sidebar reads as its width.
const SIDEBAR_STYLE = { "--sidebar-width": "var(--dock-width)" } as CSSProperties;

function Overlay() {
  // The dock's open state is the sidebar's: the provider is controlled by the inspector signal, which the edge tab toggles.
  const { open } = useSignal(inspector);
  // The start screen comes first: it spans the grid under the islands, which are drawn after it.
  return (
    <SidebarProvider open={open} className="contents" style={SIDEBAR_STYLE}>
      <TooltipProvider delayDuration={TIP_DELAY_MS}>
        <Home />
        <TopBar />
        <ExportArea />
        <LensRow />
        <Inspector />
        <InspectorToggle />
        <SelectionCard />
        <CornerButtons />
      </TooltipProvider>
    </SidebarProvider>
  );
}

// Mounts the overlay into the page's container (page.html, #overlay), once and synchronously: the modules that wire the
// rest of the page look for its elements as soon as they run.
export function mountOverlay(container: HTMLElement): void {
  takeServerLinks(container);
  flushSync(() => {
    createRoot(container).render(<Overlay />);
  });
  // The transitions of the dock, the stage, the island layer and the edge tab wait for the first paint (style.css, data-ready).
  requestAnimationFrame(() => requestAnimationFrame(() => document.documentElement.setAttribute("data-ready", "")));
}
