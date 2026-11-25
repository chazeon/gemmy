// The top bar: the ☰ button with the page's name (or the tab strip, in its place), and the toolbar island (the views,
// the turn and move pad). Its islands are the grid items of #ui (style.css), placed by their grid areas.
import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { pageName } from "../ui/dom";
import { tabBar } from "../ui/tab-bar";
import { TabStrip } from "./tab-strip";
import { MainMenu } from "./main-menu";
import { ToolBar } from "./toolbar";
import { useSignal } from "./use-signal";

const TIP_DELAY_MS = 300;

// The page's name and its line under it; the line is hidden when it is empty, and on a phone. The name stays in the page
// when the tab strip shows in its place (hidden), so the page's title is always there.
function PageName({ hidden }: { hidden: boolean }) {
  const page = useSignal(pageName);
  return (
    <div className={cn("grid flex-none leading-[1.2] pr-2.5 pl-1", hidden && "hidden")}>
      <h1 data-testid="page-title" className="m-0 text-[15px] font-semibold whitespace-nowrap">
        {page.name}
      </h1>
      <p
        className={page.from ? "m-0 text-xs whitespace-nowrap text-muted-foreground max-[640px]:hidden" : "m-0 hidden"}
      >
        {page.from}
      </p>
    </div>
  );
}

export function TopBar() {
  const bar = useSignal(tabBar);
  return (
    <TooltipProvider delayDuration={TIP_DELAY_MS}>
      <div id="menu-island" className="island justify-self-start overflow-hidden [grid-area:left]">
        <MainMenu />
        {bar.visible && <TabStrip bar={bar} />}
        <PageName hidden={bar.visible} />
      </div>
      <ToolBar />
    </TooltipProvider>
  );
}
