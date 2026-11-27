// The details card: the picked object's readout (ui/readout.ts) in plain rows, with its title, a close button and its Center
// and View buttons. It floats over the stage, above the bottom-right island (react/details-button.tsx), and on a phone it is
// a bottom sheet over the page; the card's place and its open state are in style.css and ui/panels.ts. It is drawn in the
// overlay, not in the dock: the dock is for the style sections (react/inspector/inspector.tsx).
import { Check, Copy, Scan, ScanBox, X } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { Card, CardAction, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { DISTORTION_NOTE, type BondEnd, type Readout, SUPERCELL_NOTE, readout, readoutTitle } from "../ui/readout";
import { centreShown, centreShownAlong } from "../ui/readout-centre";
import { chooseDetails, detailsFocus, detailsOpen } from "../ui/panels";
import { AXES, axisColour } from "./axis-view-icon";
import { Group } from "./group";
import { ICON_SMALL, MENU_ICON } from "./icons";
import { TipButton } from "./tip";
import { useSignal } from "./use-signal";

const COPY_FEEDBACK_MS = 1500;

export function SelectionCard() {
  const open = useSignal(detailsOpen);
  const focus = useSignal(detailsFocus);
  const data = useSignal(readout);
  const frame = useRef<HTMLDivElement>(null);
  // Opening the card brings the focus to the card itself: a button would open its tip on the focus.
  useEffect(() => {
    if (focus !== "card") return;
    frame.current?.focus({ preventScroll: true });
    detailsFocus.value = null;
  }, [focus]);
  if (!open) return null;
  return (
    <Card
      ref={frame}
      id="info"
      role="region"
      tabIndex={-1}
      aria-label="Selection details"
      className="gap-3 py-3 outline-none [body.no-scene_&]:hidden"
    >
      <CardHeader className="px-3">
        <CardTitle role="heading" aria-level={2} className="text-[15px]">
          {readoutTitle(data)}
        </CardTitle>
        <CardAction>
          <TipButton
            variant="ghost"
            size="icon-xs"
            aria-label="Hide the selection details"
            tip="Hide the selection details"
            onClick={() => chooseDetails(false)}
          >
            <X {...ICON_SMALL} />
          </TipButton>
        </CardAction>
      </CardHeader>
      <CardContent id="info-body" aria-live="polite" className="grid gap-3 px-3">
        <Body data={data} />
      </CardContent>
    </Card>
  );
}

function Body({ data }: { data: Readout }) {
  if (data.kind === "none") {
    return <p className="text-xs text-muted-foreground">Click an atom, a bond or a polyhedron to see its distances.</p>;
  }
  if (data.kind === "bond") {
    return (
      <Rows>
        <Row label="Length">{data.length} Å</Row>
        <EndRow label="End A" end={data.ends[0]} />
        <EndRow label="End B" end={data.ends[1]} />
        <Row label="View">
          <ViewButtons />
        </Row>
      </Rows>
    );
  }
  if (data.kind === "polyhedron") {
    return (
      <>
        <Rows>
          <Row label="Centre">{data.centre}</Row>
          <Row label="Bonds">{data.bonds} Å</Row>
          <Row label="Mean">{data.mean} Å</Row>
          <Row label="Δ">{data.delta} × 10⁻⁴</Row>
          <Row label="View">
            <ViewButtons />
          </Row>
        </Rows>
        <Separator />
        <p className="text-xs text-muted-foreground">{DISTORTION_NOTE}</p>
      </>
    );
  }
  return (
    <>
      <Rows>
        {data.ref !== null && (
          <Row label="Ref">
            {data.ref}
            <CopyRef text={data.ref} />
          </Row>
        )}
        {data.fractional !== null && <Row label="Fractional">{data.fractional}</Row>}
        <Row label="Cartesian">{data.cartesian} Å</Row>
        {data.host !== null && data.neighbours !== null && <Row label={`${data.host} nbrs`}>{data.neighbours} Å</Row>}
        <Row label="View">
          <ViewButtons />
        </Row>
      </Rows>
      <Separator />
      <p className="text-xs text-muted-foreground">{SUPERCELL_NOTE}</p>
    </>
  );
}

function EndRow({ label, end }: { label: string; end: BondEnd }) {
  return (
    <Row label={label}>
      {end.label}
      {end.ref !== null && (
        <>
          {end.ref}
          <CopyRef text={end.ref} />
        </>
      )}
    </Row>
  );
}

// The labels, then the values (the monospace numbers, and a copy button after a reference).
function Rows({ children }: { children: ReactNode }) {
  return <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2">{children}</dl>;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 items-center justify-end gap-1.5 text-right font-mono text-xs tabular-nums">
        {children}
      </dd>
    </>
  );
}

// Copies a reference; the icon and the tip say so for a moment, then go back to Copy.
function CopyRef({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const copy = () => {
    try {
      navigator.clipboard.writeText(text).then(
        () => setState("copied"),
        () => setState("failed"),
      );
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
  };
  const tip = { idle: "Copy the reference", copied: "Copied", failed: "Copy failed" }[state];
  return (
    <TipButton variant="ghost" size="icon-xs" aria-label="Copy the reference" tip={tip} onClick={copy}>
      {state === "copied" ? <Check {...MENU_ICON} /> : <Copy {...MENU_ICON} />}
    </TipButton>
  );
}

// The view of the shown object: Center frames it; a, b and c also look along that cell axis.
function ViewButtons() {
  return (
    <Group label="View" className="flex items-center rounded-md border border-border">
      <TipButton
        variant="ghost"
        size="icon-sm"
        aria-label="Center and fit this object"
        tip="Center and fit this object"
        onClick={centreShown}
        className="size-7 rounded-none first:rounded-l-md"
      >
        <ScanBox {...ICON_SMALL} />
      </TipButton>
      {AXES.map((axis) => (
        <TipButton
          key={axis}
          variant="ghost"
          size="icon-sm"
          aria-label={`Look along ${axis} at this object`}
          tip={`Look along ${axis} at this object`}
          onClick={() => centreShownAlong(axis)}
          style={{ "--axis": axisColour(axis) } as CSSProperties}
          className="group/view relative size-7 rounded-none border-l border-border last:rounded-r-md"
        >
          <Scan {...ICON_SMALL} />
          <span className="absolute inset-0 flex items-center justify-center pb-px text-[11px] leading-none italic [font-family:var(--label)] group-hover/view:text-(--axis)">
            {axis}
          </span>
        </TipButton>
      ))}
    </Group>
  );
}
