// The keyboard shortcuts: a shadcn Popover from the "?" button in the corner, with the keys as shadcn Kbd. Its open state is
// ui/help.ts's (helpOpen), so the ? key and the ? button toggle it the same way. It opens without moving the focus, so the
// ? key still shuts it.
import {
  CircleHelp,
  ExternalLink,
  type LucideIcon,
  Mouse as MouseIcon,
  MouseLeft,
  MousePointerClick,
  MouseRight,
} from "lucide-react";
import type { ReactNode } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SHORTCUT } from "../ui/keyboard";
import { helpOpen, showHelp } from "../ui/help";
import { TipButton } from "./tip";
import { useSignal } from "./use-signal";
import { ISLAND_MENU } from "./placement";
import { Key } from "./key";
import { ICON, ICON_SMALL } from "./icons";

const PROJECT_URL = "https://github.com/chazeon/gemmy";

// A mouse action: Lucide's mouse with the button it uses (or the click pointer), and the action's name.
function Mouse({ icon: Icon, action }: { icon: LucideIcon; action: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon {...ICON_SMALL} aria-hidden="true" />
      {action}
    </span>
  );
}

// A row of shortcuts: the keys (key caps) or the mouse action, and what they do.
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
          <CircleHelp {...ICON} />
        </TipButton>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        sideOffset={ISLAND_MENU.sideOffset}
        alignOffset={ISLAND_MENU.alignOffset}
        aria-label="Keyboard shortcuts"
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="box-border max-h-(--radix-popover-content-available-height) w-[min(340px,calc(100vw-16px))] overflow-y-auto p-3.5 text-[13px]"
      >
        <h2 className="m-0 mb-2 text-sm font-semibold">Keyboard shortcuts</h2>
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2">
          <Row keys={<Mouse icon={MouseLeft} action="drag" />} does="rotate" />
          <Row keys={<Mouse icon={MouseRight} action="drag" />} does="move" />
          <Row keys={<Mouse icon={MouseIcon} action="scroll" />} does="zoom" />
          <Row
            keys={<Mouse icon={MousePointerClick} action="double-click" />}
            does="rotate around this atom; click empty space or Esc to let go"
          />
          <Row
            keys={
              <>
                <Key>←</Key>
                <Key>→</Key>
                <Key>↑</Key>
                <Key>↓</Key>
              </>
            }
            does="turn and tilt (hold to keep turning)"
          />
          <Row
            keys={
              <>
                <Key>[</Key>
                <Key>]</Key>
              </>
            }
            does="spin anticlockwise, clockwise"
          />
          <Row
            keys={
              <>
                <Key>Shift</Key> + arrows
              </>
            }
            does="move the structure"
          />
          <Row
            keys={
              <>
                <Key>W</Key>
                <Key>S</Key>
              </>
            }
            does="fly in, out (hold)"
          />
          <Row
            keys={
              <>
                <Key>A</Key>
                <Key>D</Key> · <Key>Q</Key>
                <Key>E</Key>
              </>
            }
            does="fly left, right · down, up"
          />
          <Row
            keys={
              <>
                <Key>Shift</Key> + <Key>W</Key>
                <Key>S</Key>
              </>
            }
            does="fly up, down"
          />
          <Row
            keys={
              <>
                <Key>+</Key>
                <Key>−</Key> · <Key>0</Key>
              </>
            }
            does="zoom in, out · fit to window"
          />
          <Row keys={<Key>i</Key>} does="show or hide the selection details" />
          <Row keys={<Key>t</Key>} does="theme: auto, light, dark" />
          <Row
            keys={
              <>
                <Key>?</Key> · <Key>Esc</Key>
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
