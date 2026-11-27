// A popup's open state, read from its row of the panel table (ui/panels.ts): open is true while the popup is open, and
// onOpenChange opens or shuts it (opening it shuts the other popup, and the rules there apply).
import { type PanelId, PANELS, setPanel } from "../ui/panels";
import { useSignal } from "./use-signal";

export function usePopup(id: PanelId): { open: boolean; onOpenChange: (open: boolean) => void } {
  const open = useSignal(PANELS[id].open);
  return { open, onOpenChange: (next) => setPanel(id, next) };
}
