// A popup's open state, read from the one open-popup signal (ui/popup.ts): open is true while this popup is the open one,
// and onOpenChange opens or shuts it (opening it closes the other popup).
import { openPopup, setPopupOpen } from "../ui/popup";
import { useSignal } from "./use-signal";

export function usePopup(id: string): { open: boolean; onOpenChange: (open: boolean) => void } {
  const current = useSignal(openPopup);
  return { open: current === id, onOpenChange: (open) => setPopupOpen(id, open) };
}
