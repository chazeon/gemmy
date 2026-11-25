// A labelled run of controls, and the rule between two runs: the toolbar, the lens row, the selection card and the menu
// draw them the same way. Group is a div with role group (its layout is the caller's), so a screen reader reads its
// buttons as one set. A fieldset would be a form control, and these are not.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Group({
  label,
  id,
  className,
  children,
}: {
  label: string;
  id?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a div keeps the caller's layout; a fieldset is a form control
    <div id={id} role="group" aria-label={label} className={className}>
      {children}
    </div>
  );
}

// The vertical rule between two runs of controls, drawn as a div; the caller sets its margin.
export function Divider({ className }: { className?: string }) {
  // biome-ignore lint/a11y/useSemanticElements: a vertical rule between two runs of controls, drawn as a div
  return <div role="separator" aria-orientation="vertical" className={cn("w-px self-stretch bg-border", className)} />;
}
