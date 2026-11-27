// The message line: one line of text under the toolbar island, attached to it (style.css, .tools-stack). It shows the
// most important message (ui/message.ts `line`): its sign first (Info, a warning, or an error), the text on one line with an
// ellipsis (the whole text in its title), and the note's action (Undo, say) at the end. The island layer (#ui) lets no
// pointer through, so the line takes the pointer itself. Only the timed note fades (ui/message.ts `fadingNote`).
import { CircleAlert, Info, type LucideIcon, TriangleAlert } from "lucide-react";
import { useLayoutEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { fadingNote, type Kind, line, type NoteAction, runNoteAction } from "../ui/message";
import { useSignal } from "./use-signal";

const SIGN: Record<Kind, LucideIcon> = { info: Info, warning: TriangleAlert, error: CircleAlert };

// The note's action button. When it is removed while it has the focus (the note expired or was replaced), the focus goes to the
// toolbar's first button, not to the body. The flag is kept by focus and blur; React runs the cleanup before the button
// leaves the page, so the focus is still known there.
function NoteButton({ action }: { action: NoteAction }) {
  const focused = useRef(false);
  useLayoutEffect(
    () => () => {
      if (focused.current) document.querySelector<HTMLElement>("#tools button")?.focus();
    },
    [],
  );
  return (
    <Button
      type="button"
      size="sm"
      variant="ghost"
      className="message-action"
      onClick={runNoteAction}
      onFocus={() => (focused.current = true)}
      onBlur={() => (focused.current = false)}
    >
      {action.label}
    </Button>
  );
}

export function MessageLine() {
  const message = useSignal(line);
  const fading = useSignal(fadingNote);
  if (message === null) return null;
  const Sign = SIGN[message.kind];
  // Only the note on show fades: a standing message is never the faded one.
  const isFading = fading === message;
  // An error is an alert (it asks for attention at once); the other messages are status, read when the page is idle.
  return (
    <div
      id="message"
      role={message.kind === "error" ? "alert" : "status"}
      data-kind={message.kind}
      title={message.text}
      className={cn("message-line", isFading && "fade")}
    >
      <Sign className="message-sign" aria-hidden="true" />
      <span className="message-text">{message.text}</span>
      {message.action && <NoteButton action={message.action} />}
    </div>
  );
}
