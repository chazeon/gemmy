// The Export menu, built as shadcn's DropdownMenu like the ☰ menu: the pictures (PNG with its transparency, SVG), the
// render settings (saved or copied as TOML or JSON, the render command) and, on the serve page, the item that sends the
// view to Blender. Each item runs its action (ui/export.ts). The area it sits in, top right, also holds the theme button
// (src/react/theme-button.tsx), so the two share one centre line.
import { Clapperboard, Copy, Download, FileCode, FileCog, FileJson, Image, Terminal } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyFallback, type ExportAction, renderView, runExport } from "../ui/export";
import { ThemeButton } from "./theme-button";
import { useSignal } from "./use-signal";
import { GAP } from "./placement";
import { nudge } from "./motion";

const ICON = { size: 16, strokeWidth: 2, className: "text-muted-foreground" };
// A check keeps the menu open, so the background can be set and the picture taken in turn.
const KEEP_OPEN = { onSelect: (event: Event) => event.preventDefault() };

// The top-right area: the theme button and the Export menu, on one centre line.
export function ExportArea() {
  return (
    <div id="export-area" className="flex items-center gap-2 justify-self-end [grid-area:right]">
      <ThemeButton />
      <ExportMenu />
    </div>
  );
}

function run(action: ExportAction, transparent = true) {
  return () => runExport(action, { transparent });
}

function ExportMenu() {
  const [transparent, setTransparent] = useState(true);
  const serveItem = useSignal(renderView);
  const fallback = useSignal(copyFallback);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            id="export-button"
            style={nudge(0, 1)}
            className="h-11 gap-2 rounded-[var(--radius)] px-4 text-sm font-medium shadow-[var(--shadow)] [body.no-scene_&]:hidden"
          >
            <Download size={18} strokeWidth={2} />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" sideOffset={GAP} className="w-60">
          <DropdownMenuLabel>Picture</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={run("png", transparent)}>
              <Image {...ICON} />
              PNG
              <DropdownMenuShortcut>2× the window</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem checked={transparent} onCheckedChange={setTransparent} {...KEEP_OPEN}>
              Transparent background
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem onSelect={run("svg")}>
              <FileCode {...ICON} />
              SVG
              <DropdownMenuShortcut>vector, text editable</DropdownMenuShortcut>
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Render settings</DropdownMenuLabel>
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={run("save-toml")}>
              <FileCog {...ICON} />
              Save as TOML
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run("copy-toml")}>
              <Copy {...ICON} />
              Copy as TOML
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run("save-json")}>
              <FileJson {...ICON} />
              Save as JSON
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run("copy-json")}>
              <Copy {...ICON} />
              Copy as JSON
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run("copy-command")}>
              <Terminal {...ICON} />
              Copy render command
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {serveItem !== null && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={run("render-view")}>
                <Clapperboard {...ICON} />
                Use this view for the Blender render
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <CopyByHand text={fallback?.text ?? ""} what={fallback?.what ?? ""} open={fallback !== null} />
    </>
  );
}

// The clipboard refused the text: the dialog shows it, selected, for the user to copy with the keyboard.
function CopyByHand({ text, what, open }: { text: string; what: string; open: boolean }) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) copyFallback.value = null;
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Copy {what}</DialogTitle>
          <DialogDescription>
            The clipboard is not available here. The text is selected: press Ctrl/Cmd+C.
          </DialogDescription>
        </DialogHeader>
        <textarea
          readOnly
          autoFocus
          aria-label="Text to copy"
          value={text}
          onFocus={(event) => event.currentTarget.select()}
          className="h-40 w-full rounded-[var(--radius-small)] border border-[var(--rule)] bg-[var(--bg)] p-2 font-mono text-xs text-[var(--fg)]"
        />
      </DialogContent>
    </Dialog>
  );
}
