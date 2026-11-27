// The top bar: the file island (the name of the open file, or its dropdown of the open files: react/file-island.tsx), at
// the top left, with the toolbar island beside it. Each island is a grid item's child (style.css), so the islands share one centre line.
import { tabBar } from "../ui/tab-bar";
import { FileIsland } from "./file-island";
import { ToolBar } from "./toolbar";
import { useSignal } from "./use-signal";

export function TopBar() {
  const bar = useSignal(tabBar);
  return (
    <>
      <div className="flex min-w-0 max-w-full items-center gap-[var(--gap)] justify-self-start [grid-area:left]">
        <FileIsland bar={bar} />
      </div>
      <ToolBar />
    </>
  );
}
