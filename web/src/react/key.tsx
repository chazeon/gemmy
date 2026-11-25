// A key cap: shadcn's Kbd, made square for a key of one character (shadcn pads it to a wider cap); a longer name
// (Shift, Esc) keeps the padding. The help popover and the tooltips draw their keys with it.
import { Kbd } from "@/components/ui/kbd";
import { cn } from "@/lib/utils";

export function Key({ children }: { children: string }) {
  return <Kbd className={cn([...children].length === 1 && "w-5 min-w-0 px-0")}>{children}</Kbd>;
}
