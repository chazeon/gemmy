// The menu: a shadcn Popover that drops down from the menu button and stays open while the scene is used (a click
// elsewhere does not shut it); the menu button or Escape shuts it. The Scene actions come first, then checks for the Show
// flags and a choice of the outline width, drawn as the menu's rows were. Open local file and New tab shut it, as they
// take the user elsewhere. The viewer's state stays in its signals (state.ts, ui/outline-scale.ts); the panel reads
// them and calls their setters.
import { Check, Circle, Copy, FolderOpen, type LucideIcon, PanelTopClose, PanelTopOpen, Plus } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { outlines, showAtoms, showBox } from "../state";
import { focusUrl } from "../ui/home";
import { openNewTab, openSceneFile, openUrlUnavailable } from "../ui/loader";
import { chooseOutlineScale, outlineScale } from "../ui/outline-scale";
import { copyLink } from "../ui/share";
import { Group } from "./group";
import { ICON, MENU_ICON } from "./icons";
import { ISLAND_MENU } from "./placement";
import { TipButton } from "./tip";
import { useSignal } from "./use-signal";

const OUTLINE_WIDTHS = [
  { value: 0.5, label: "Thin" },
  { value: 1, label: "Normal" },
  { value: 1.75, label: "Bold" },
] as const;

// A row, as shadcn's menu items are drawn: the mark or icon in a 16 px slot on the left, then the label.
const ROW =
  "flex h-8 w-full cursor-default items-center gap-2 rounded-sm px-2 text-left text-sm outline-none select-none hover:bg-accent focus-visible:bg-accent disabled:pointer-events-none disabled:opacity-50";

export function MainMenu() {
  const [open, setOpen] = useState(false);
  // New tab's focus goes to the start screen's address box once the panel has shut, not back to the menu button.
  const leaveFocus = useRef(false);
  const atoms = useSignal(showAtoms);
  const shownOutlines = useSignal(outlines);
  const box = useSignal(showBox);
  const scale = useSignal(outlineScale);
  const noUrl = useSignal(openUrlUnavailable);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <TipButton id="menu-button" variant={open ? "secondary" : "ghost"} size="icon" aria-label="Menu" tip="Menu">
          {open ? <PanelTopClose {...ICON} /> : <PanelTopOpen {...ICON} />}
        </TipButton>
      </PopoverTrigger>
      <PopoverContent
        id="main-panel"
        align="start"
        sideOffset={ISLAND_MENU.sideOffset}
        alignOffset={ISLAND_MENU.alignOffset}
        aria-label="Menu"
        className="box-border max-h-(--radix-popover-content-available-height) w-56 overflow-y-auto p-1"
        onInteractOutside={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => {
          if (leaveFocus.current) {
            event.preventDefault();
            focusUrl();
          }
          leaveFocus.current = false;
        }}
      >
        <Section label="Scene">
          <Action
            icon={FolderOpen}
            onClick={() => {
              setOpen(false);
              openSceneFile();
            }}
          >
            Open local file…
          </Action>
          <Action
            icon={Plus}
            disabled={noUrl !== null}
            title={noUrl ?? undefined}
            onClick={() => {
              leaveFocus.current = true;
              setOpen(false);
              openNewTab();
            }}
          >
            New tab
          </Action>
          <Action icon={Copy} onClick={copyLink}>
            Copy link
          </Action>
        </Section>
        <Separator className="-mx-1 my-1 w-auto" />
        <Section label="Show">
          <Toggle checked={atoms} onChange={(on) => (showAtoms.value = on)}>
            Atoms
          </Toggle>
          <Toggle checked={shownOutlines} onChange={(on) => (outlines.value = on)}>
            Outlines
          </Toggle>
          <Toggle checked={box} onChange={(on) => (showBox.value = on)}>
            Cell box
          </Toggle>
        </Section>
        <Separator className="-mx-1 my-1 w-auto" />
        <Section label="Outline width">
          {OUTLINE_WIDTHS.map((width) => (
            <button
              key={width.value}
              type="button"
              aria-pressed={scale === width.value}
              className={ROW}
              onClick={() => chooseOutlineScale(width.value)}
            >
              <span className="flex size-4 items-center justify-center">
                {scale === width.value && <Circle className="size-2 fill-current" />}
              </span>
              {width.label}
            </button>
          ))}
        </Section>
      </PopoverContent>
    </Popover>
  );
}

// A labelled run of rows. The checks and the choice are toggle buttons (aria-pressed): one pressed of the choice's.
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Group label={label}>
      <div className="px-2 py-1.5 text-sm font-medium">{label}</div>
      {children}
    </Group>
  );
}

function Action({
  icon: Icon,
  onClick,
  disabled,
  title,
  children,
}: {
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button type="button" className={ROW} onClick={onClick} disabled={disabled} title={title}>
      <Icon {...MENU_ICON} className="text-muted-foreground" />
      {children}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (on: boolean) => void;
  children: ReactNode;
}) {
  return (
    <button type="button" aria-pressed={checked} className={ROW} onClick={() => onChange(!checked)}>
      <span className="flex size-4 items-center justify-center">
        <Check className={cn("size-4", !checked && "invisible")} />
      </span>
      {children}
    </button>
  );
}
