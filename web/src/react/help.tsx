// The keyboard shortcuts: a shadcn Popover from the "?" button in the corner, with the keys as shadcn Kbd. Its open state is
// ui/menus.ts's (helpOpen), so the ? key and the ☰ menu's item toggle it the same way. It opens without moving the
// focus, so the ? key still shuts it.
import { CircleHelp, ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { Kbd } from "@/components/ui/kbd";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SHORTCUT } from "../ui/keyboard";
import { helpOpen, showHelp } from "../ui/menus";
import { TipButton } from "./tip";
import { useSignal } from "./use-signal";
import { ISLAND_MENU } from "./placement";

const PROJECT_URL = "https://github.com/chazeon/gemmy";

// A row of shortcuts: the keys (kbd), and what they do.
function Row({ keys, does }: { keys: ReactNode; does: string }) {
  return (
    <>
      <dt className="flex items-center gap-1 whitespace-nowrap">{keys}</dt>
      <dd className="m-0 text-muted-foreground">{does}</dd>
    </>
  );
}

export function HelpButton() {
  const open = useSignal(helpOpen);
  return (
    <Popover open={open} onOpenChange={showHelp}>
      <PopoverTrigger asChild>
        <TipButton
          id="help-button"
          variant={open ? "secondary" : "ghost"}
          size="icon"
          aria-label="Keyboard shortcuts"
          tip="Keyboard shortcuts"
          shortcut={SHORTCUT.help}
        >
          <CircleHelp size={20} strokeWidth={1.75} />
        </TipButton>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={ISLAND_MENU.sideOffset}
        alignOffset={ISLAND_MENU.alignOffset}
        aria-label="Keyboard shortcuts"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="w-[min(340px,calc(100vw-16px))] p-3.5 text-[13px]"
      >
        <h2 className="m-0 mb-2 text-sm font-semibold">Keyboard shortcuts</h2>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2">
          <Row keys="Drag · right-drag · scroll" does="rotate · move · zoom" />
          <Row keys="double-click" does="rotate around this atom; click empty space or Esc to let go" />
          <Row
            keys={
              <>
                <Kbd>←</Kbd>
                <Kbd>→</Kbd>
                <Kbd>↑</Kbd>
                <Kbd>↓</Kbd>
              </>
            }
            does="turn and tilt (hold to keep turning)"
          />
          <Row
            keys={
              <>
                <Kbd>[</Kbd>
                <Kbd>]</Kbd>
              </>
            }
            does="spin anticlockwise, clockwise"
          />
          <Row
            keys={
              <>
                <Kbd>Shift</Kbd> + arrows
              </>
            }
            does="move the structure"
          />
          <Row
            keys={
              <>
                <Kbd>W</Kbd>
                <Kbd>S</Kbd>
              </>
            }
            does="fly in, out (hold)"
          />
          <Row
            keys={
              <>
                <Kbd>A</Kbd>
                <Kbd>D</Kbd> · <Kbd>Q</Kbd>
                <Kbd>E</Kbd>
              </>
            }
            does="fly left, right · down, up"
          />
          <Row
            keys={
              <>
                <Kbd>Shift</Kbd> + <Kbd>W</Kbd>
                <Kbd>S</Kbd>
              </>
            }
            does="fly up, down"
          />
          <Row
            keys={
              <>
                <Kbd>+</Kbd>
                <Kbd>−</Kbd> · <Kbd>0</Kbd>
              </>
            }
            does="zoom in, out · fit to window"
          />
          <Row keys={<Kbd>i</Kbd>} does="show or hide the selection details" />
          <Row keys={<Kbd>t</Kbd>} does="theme: auto, light, dark" />
          <Row
            keys={
              <>
                <Kbd>?</Kbd> · <Kbd>Esc</Kbd>
              </>
            }
            does="this list · close a menu"
          />
        </dl>
        <p className="m-0 mt-3 text-xs text-muted-foreground">
          <a
            href={PROJECT_URL}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-inherit underline-offset-4 hover:underline"
          >
            gemmy on GitHub
            <ExternalLink size={12} />
          </a>
        </p>
      </PopoverContent>
    </Popover>
  );
}
