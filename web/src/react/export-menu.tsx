// The Export menu, built as shadcn's DropdownMenu like the menu: the pictures (PNG with its transparency, SVG), the
// render settings (saved or copied as TOML or JSON, the render command), a structure tab's config (saved as TOML or JSON)
// and, on the serve page, the item that sends the view to Blender. Each item runs its action (ui/export.ts). The area it sits in, top right, also holds the theme button
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { copyFallback, type ExportAction, renderView, runExport } from "../ui/export";
import { copyLink } from "../ui/share";
import { activeModel } from "../ui/structure-model";
import { ThemeButton } from "./theme-button";
import { useSignal } from "./use-signal";
import { GAP } from "./placement";
import { usePopup } from "./use-popup";
import { nudge } from "./motion";

// A check keeps the menu open, so the background can be set and the picture taken in turn.
const KEEP_OPEN = { onSelect: (event: Event) => event.preventDefault() };

// The top-right island: the theme button and the Export menu, on one centre line.
export function ExportArea() {
  return (
    <div id="export-area" className="island justify-self-end [grid-area:right]">
      <ThemeButton />
      <ExportMenu />
    </div>
  );
}

function run(action: ExportAction, transparent = true) {
  return () => runExport(action, { transparent });
}

function ExportMenu() {
  const popup = usePopup("export-menu");
  const [transparent, setTransparent] = useState(true);
  const serveItem = useSignal(renderView);
  const fallback = useSignal(copyFallback);
  const model = useSignal(activeModel);
  return (
    <>
      <DropdownMenu open={popup.open} onOpenChange={popup.onOpenChange}>
        <DropdownMenuTrigger asChild>
          <Button id="export-button" style={nudge(0, 1)} className="[body.no-scene_&]:hidden">
            <Download size={18} strokeWidth={2} />
            Export
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent id="export-panel" align="end" sideOffset={GAP}>
          <DropdownMenuItem onSelect={copyLink}>
            <Copy />
            Copy link
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={run("png", transparent)}>
              <Image />
              PNG
            </DropdownMenuItem>
            <DropdownMenuCheckboxItem checked={transparent} onCheckedChange={setTransparent} {...KEEP_OPEN}>
              Transparent background
            </DropdownMenuCheckboxItem>
            <DropdownMenuItem onSelect={run("svg")}>
              <FileCode />
              SVG
            </DropdownMenuItem>
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuItem onSelect={run("save-toml")}>
              <FileCog />
              Save as TOML
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run("copy-toml")}>
              <Copy />
              Copy as TOML
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run("save-json")}>
              <FileJson />
              Save as JSON
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run("copy-json")}>
              <Copy />
              Copy as JSON
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={run("copy-command")}>
              <Terminal />
              Copy render command
            </DropdownMenuItem>
          </DropdownMenuGroup>
          {model !== null && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Structure</DropdownMenuLabel>
              <DropdownMenuGroup>
                <DropdownMenuItem onSelect={run("save-config-toml")}>
                  <FileCog />
                  Export config (TOML)
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={run("save-config-json")}>
                  <FileJson />
                  Export config (JSON)
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
          {serveItem !== null && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={run("render-view")}>
                <Clapperboard />
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
