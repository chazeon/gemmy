// The file island, the top bar's first island: the name of the open file, and a narrow "+" for a new tab. With the
// open-other-files flag on, or with more than one file or a server's page link, the name is one dropdown (a shadcn
// DropdownMenu): its trigger shows the current file's name, and the menu lists the open files (a check on the current one,
// each with a × to close it when it can be closed) and the server's page links under their own label. The start screen (the
// new tab) is a file too: its row and the trigger show the New tab name and the file-plus-corner icon. The "+" (shown with
// the flag on, and hidden while a start tab exists, since it would only open a second one) opens it. Otherwise the island is
// the file's name as text. Closing the current file goes to its right neighbour, else its left one, and the focus returns to
// the trigger. The menu's keys are shadcn's.
import { Check, ChevronDown, FileBox, Plus, FilePlusCorner, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { pageName } from "../ui/dom";
import { allowOpen } from "../ui/open-files";
import type { FileTab, TabBarView } from "../ui/tab-bar";
import { Divider } from "./group";
import { ICON, MENU_ICON } from "./icons";
import { ISLAND_MENU } from "./placement";
import { TipButton } from "./tip";
import { usePopup } from "./use-popup";
import { useSignal } from "./use-signal";

const ITEM_ICON = { ...MENU_ICON, className: "text-muted-foreground" };
// The island's name is cut past this width (240 px); the full name is in the trigger's title.
const NAME_WIDTH = "max-w-60";

export function FileIsland({ bar }: { bar: TabBarView }) {
  const openFiles = useSignal(allowOpen);
  const page = useSignal(pageName);
  const menu = openFiles || bar.tabs.length > 1 || bar.links.length > 0;
  // The "+" is hidden while a start tab exists anywhere: it would only open a second one.
  const startOpen = bar.tabs.some((tab) => tab.home);
  return (
    <div id="file-island" className="island min-w-0 max-w-full" data-files={bar.tabs.length} data-menu={menu}>
      {menu ? <FileMenu bar={bar} /> : <PageName name={page.name} from={page.from} />}
      {menu && openFiles && !startOpen && <Divider className="my-1.5 mr-1 ml-0 flex-none" />}
      {menu && openFiles && !startOpen && (
        <TipButton
          data-testid="new-tab-button"
          variant="ghost"
          aria-label="New tab"
          tip="New tab"
          className="mr-0.5 h-9 w-5 min-w-0 rounded-full px-0 has-[>svg]:px-0"
          onClick={() => bar.handlers.add()}
        >
          <Plus size={14} strokeWidth={2} />
        </TipButton>
      )}
    </div>
  );
}

// The file's name as text, when the island shows no menu: the same box as the dropdown's trigger (h-9, the file icon, the
// name), so the island is the same height and padding as the menu island beside it. The page's subtitle is in the title.
function PageName({ name, from }: { name: string; from: string }) {
  return (
    <div
      data-testid="page-title"
      title={from ? `${name} (${from})` : name}
      className={`flex h-9 min-w-0 items-center gap-2 px-3 text-sm font-medium whitespace-nowrap ${NAME_WIDTH}`}
    >
      <FileBox {...ITEM_ICON} className="shrink-0" />
      <span className="min-w-0 truncate">{name}</span>
    </div>
  );
}

// A file's icon: the start tab's is the file-plus-corner (New tab), a scene's is a file-box.
function FileIconOf({ tab }: { tab: FileTab }) {
  return tab.home ? (
    <FilePlusCorner {...ITEM_ICON} className="shrink-0" />
  ) : (
    <FileBox {...ITEM_ICON} className="shrink-0" />
  );
}

function FileMenu({ bar }: { bar: TabBarView }) {
  const popup = usePopup("file-menu");
  const { handlers } = bar;
  const current = bar.tabs[bar.current];
  // The page's own link is tab 0 and is listed with the links, so the files skip it. The New tab (the start screen) is not
  // a file to list: while it is the current view, no row is checked.
  const firstFile = bar.hasOwnLink ? 1 : 0;
  const files = bar.tabs.map((tab, k) => ({ tab, k })).filter(({ tab, k }) => k >= firstFile && !tab.home);
  // Closes a file from its row, by the × or by Delete or Backspace on the highlighted row: the menu shuts, and the file
  // goes. Radix returns the focus to the trigger when the menu shuts, so the focus stays on a control that is there.
  const closeFile = (k: number) => {
    popup.onOpenChange(false);
    handlers.close(k);
  };
  return (
    <DropdownMenu open={popup.open} onOpenChange={popup.onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          data-testid="file-trigger"
          variant="ghost"
          className={`${NAME_WIDTH} min-w-0 !pr-1.5`}
          title={current?.label ?? ""}
        >
          {current && <FileIconOf tab={current} />}
          <span className="min-w-0 truncate">{current?.label ?? ""}</span>
          <ChevronDown {...ICON} className="shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        id="file-panel"
        align="start"
        sideOffset={ISLAND_MENU.sideOffset}
        alignOffset={ISLAND_MENU.alignOffset}
        aria-label="Open files"
        className="w-48"
      >
        {files.map(({ tab, k }) => (
          // A row is a plain menu item with its check in the flow (a fixed slot, so the row's centre line holds the check and
          // the name alike). The current file's row is aria-current; the other rows keep the slot empty.
          <DropdownMenuItem
            key={`${k}-${tab.label}`}
            data-testid="file-item"
            data-label={tab.label}
            aria-current={k === bar.current ? "true" : undefined}
            onSelect={() => handlers.choose(k)}
            onKeyDown={(event) => {
              // The × is out of the tab order, so a keyboard user closes the highlighted file with Delete or Backspace.
              if (tab.closable && (event.key === "Delete" || event.key === "Backspace")) {
                event.preventDefault();
                closeFile(k);
              }
            }}
            className="gap-2 pr-7"
          >
            <Check {...ITEM_ICON} className={k === bar.current ? "shrink-0" : "shrink-0 invisible"} />
            <span className={`min-w-0 ${NAME_WIDTH} truncate`}>{tab.label}</span>
            {tab.closable && (
              <Button
                variant="ghost"
                size="icon-xs"
                tabIndex={-1}
                aria-label={`Close ${tab.label}`}
                className="absolute top-1/2 right-0.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                onClick={(event) => {
                  // The × closes the file and not the item: the click stops here, so the item does not choose it.
                  event.stopPropagation();
                  closeFile(k);
                }}
              >
                <X className="size-3.5" />
              </Button>
            )}
          </DropdownMenuItem>
        ))}
        {bar.links.length > 0 && (
          <>
            {files.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel>Pages</DropdownMenuLabel>
            {bar.links.map((link) =>
              link.own ? (
                <DropdownMenuItem key={link.href} onSelect={handlers.own}>
                  {link.current && <Check {...ITEM_ICON} />}
                  {link.label}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem key={link.href} asChild>
                  <a href={link.href}>{link.label}</a>
                </DropdownMenuItem>
              ),
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
