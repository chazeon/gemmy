// The React overlay: the viewer's floating controls, drawn by React over the three.js canvas. The canvas, the rendering,
// the camera and the scene loading stay plain TypeScript; the components call into them.
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { TooltipProvider } from "@/components/ui/tooltip";
import { takeServerLinks } from "../ui/tab-bar";
import { CornerButtons } from "./corner-buttons";
import { ExportArea } from "./export-menu";
import { Home } from "./home";
import { InfoCard } from "./info-card";
import { LensColumn } from "./lens-column";
import { TopBar } from "./top-bar";

const TIP_DELAY_MS = 300;

function Overlay() {
  // The start screen comes first: it spans the grid under the islands, which are drawn after it.
  return (
    <TooltipProvider delayDuration={TIP_DELAY_MS}>
      <Home />
      <TopBar />
      <ExportArea />
      <LensColumn />
      <InfoCard />
      <CornerButtons />
    </TooltipProvider>
  );
}

// Mounts the overlay into the page's container (page.html, #overlay), once and synchronously: the modules that wire the
// rest of the page look for its elements as soon as they run.
export function mountOverlay(container: HTMLElement): void {
  takeServerLinks(container);
  flushSync(() => {
    createRoot(container).render(<Overlay />);
  });
}
