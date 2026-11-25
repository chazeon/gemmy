// The overlay's tooltip: the shadcn tooltip, with the control's shortcut as key caps (shadcn Kbd, as in the help popover).
// Every tip in the overlay is this one component: Tip wraps any trigger, TipButton is a button with its tip.
import { type ComponentProps, type ReactElement, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Key } from "./key";

type Side = "top" | "right" | "bottom" | "left";

// The tip shows below its trigger on hover and on keyboard focus, unless another side is given. `shortcut` is the key's
// caps from SHORTCUT (ui/keyboard.ts), one cap per key of the chord. Radix opens a tip on any focus; a focus the page
// moves after a click (the selection card's close button, when (i) opens the card) is not a keyboard one, so the tip
// opens only while the pointer is on the trigger or its focus is :focus-visible.
export function Tip({
  text,
  shortcut,
  side = "bottom",
  children,
}: {
  text: string;
  shortcut?: readonly string[];
  side?: Side;
  children: ReactElement;
}) {
  const [open, setOpen] = useState(false);
  const hovered = useRef(false);
  const choose = (next: boolean) => {
    const focused = document.activeElement;
    setOpen(next && (hovered.current || (focused instanceof HTMLElement && focused.matches(":focus-visible"))));
  };
  return (
    <Tooltip open={open} onOpenChange={choose}>
      <TooltipTrigger
        asChild
        onPointerEnter={() => {
          hovered.current = true;
        }}
        onPointerLeave={() => {
          hovered.current = false;
        }}
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side={side}>
        {shortcut ? (
          <span className="inline-flex items-center gap-2">
            {text}
            <span className="inline-flex items-center gap-1">
              {shortcut.map((key) => (
                <Key key={key}>{key}</Key>
              ))}
            </span>
          </span>
        ) : (
          text
        )}
      </TooltipContent>
    </Tooltip>
  );
}

export function TipButton({
  tip,
  shortcut,
  side,
  ...props
}: ComponentProps<typeof Button> & { tip: string; shortcut?: readonly string[]; side?: Side }) {
  return (
    <Tip text={tip} shortcut={shortcut} side={side}>
      <Button {...props} />
    </Tip>
  );
}
