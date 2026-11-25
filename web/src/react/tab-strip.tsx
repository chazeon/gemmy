// The tab strip: the server's links (gemmy serve, a static site), then the loader's tabs, then the "+" that opens the
// start screen. A tab is a shadcn Button: the current one is the secondary variant, and a tab that can be closed has a
// small ghost ✕ beside it. The tabs are the loader's (ui/loader.ts): the strip only shows them and calls its handlers.
import { Plus, X } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type StripTab, type TabBarView, tabPulse } from "../ui/tab-bar";
import { useOverflowFade } from "./overflow";
import { Tip, TipButton } from "./tip";
import { useSignal } from "./use-signal";
import { QUARTER_TURN } from "./motion";

// The strip's controls are the toolbar's height (36 px), so the top bar's controls share one centre line.
const CONTROL = "h-9 flex-none";

export function TabStrip({ bar }: { bar: TabBarView }) {
  const ref = useRef<HTMLDivElement>(null);
  useOverflowFade(ref);
  // The open tab is scrolled to the strip's middle, clear of the faded edges, as the lens chosen is (lens-column.tsx):
  // when the strip first shows and whenever another tab opens, not on every draw, so it does not undo the user's own
  // scrolling. The whole pill goes to the middle (its ✕ too), not only the label; a server's link is its own pill.
  const openTab = `${bar.current} ${bar.tabs.length} ${bar.links.find((link) => link.current)?.href ?? ""}`;
  const centred = useRef("");
  useLayoutEffect(() => {
    if (centred.current === openTab) return;
    centred.current = openTab;
    const current = ref.current?.querySelector('[aria-current="page"]');
    (current?.closest(".group\\/tab") ?? current)?.scrollIntoView({ block: "nearest", inline: "center" });
  });

  const { handlers } = bar;
  // The tabs scroll in their own row; the "+" is after that row, so it stays in view at the strip's end (and is not
  // under the row's faded edge). It opens the start screen's tab, so it is hidden while that tab is the one shown.
  return (
    <div data-testid="tab-strip" className="flex min-w-0 flex-[0_1_auto] items-center gap-1">
      <div
        ref={ref}
        className="tabs flex min-w-0 flex-[0_1_auto] items-center gap-1 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {bar.links.map((link) => (
          <Button
            key={link.href}
            asChild
            variant={link.current ? "secondary" : "ghost"}
            size="sm"
            className={cn(CONTROL, "px-3 no-underline", !link.current && "text-foreground")}
          >
            <a
              href={link.href}
              aria-current={link.current ? "page" : undefined}
              onClick={
                link.own
                  ? (event) => {
                      event.preventDefault();
                      handlers.own();
                    }
                  : undefined
              }
            >
              {link.label}
            </a>
          </Button>
        ))}
        {bar.tabs.map((tab, k) =>
          k === 0 && bar.hasOwnLink ? null : (
            <LocalTab key={tab.label} tab={tab} k={k} current={k === bar.current} handlers={handlers} />
          ),
        )}
      </div>
      {!bar.tabs[bar.current]?.home && (
        <TipButton
          variant="ghost"
          size="icon"
          aria-label="New tab"
          tip="Start screen: open a scene in a new tab"
          className={CONTROL}
          style={QUARTER_TURN}
          onClick={handlers.add}
        >
          <Plus size={18} strokeWidth={2} />
        </TipButton>
      )}
    </div>
  );
}

// A tab the loader made: one pill, its label and (on a tab that can be closed) a small ✕ inside the same rounded shape.
// The pill's background shows the current tab or a hover, for the whole pill. The ✕ shows on the current tab and on a
// hover (and on keyboard focus); on a touch screen it is shown on the current tab only, since a touch has no hover.
function LocalTab({
  tab,
  k,
  current,
  handlers,
}: {
  tab: StripTab;
  k: number;
  current: boolean;
  handlers: TabBarView["handlers"];
}) {
  // A tab that has just opened pulses once (ui/tab-bar.ts pulseTab). The pill is keyed by the pulse, so it is drawn
  // again with the pulse's class and the animation runs; 0 is no pulse.
  const pulse = useSignal(tabPulse);
  const pulsing = pulse.tab === k ? pulse.serial : 0;
  return (
    <div
      key={pulsing}
      className={cn(
        "group/tab flex h-9 flex-none items-center gap-0.5 rounded-md pr-1 pl-3 transition-colors",
        current ? "bg-secondary text-secondary-foreground" : "hover:bg-accent hover:text-accent-foreground",
        pulsing > 0 && "tab-opened",
      )}
    >
      <Tip text={tab.label}>
        <button
          type="button"
          aria-current={current ? "page" : undefined}
          onClick={() => handlers.choose(k)}
          className="h-full max-w-[7.5rem] cursor-pointer truncate text-sm font-medium whitespace-nowrap outline-none"
        >
          {tab.label}
        </button>
      </Tip>
      {tab.closable && (
        <TipButton
          variant="ghost"
          size="icon-xs"
          aria-label={`Close ${tab.label}`}
          tip={`Close ${tab.label}`}
          className={cn(
            "size-6 shrink-0 bg-transparent text-muted-foreground transition-opacity hover:bg-transparent hover:text-foreground dark:bg-transparent dark:hover:bg-transparent",
            current
              ? "opacity-100"
              : "opacity-0 group-hover/tab:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-0",
          )}
          style={QUARTER_TURN}
          onClick={() => handlers.close(k)}
        >
          <X size={14} strokeWidth={2} />
        </TipButton>
      )}
    </div>
  );
}
