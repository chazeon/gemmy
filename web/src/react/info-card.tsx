// The selection card: the readout of the picked atom, bond or polyhedron (ui/readout.ts), its copy buttons and its view buttons,
// in a shadcn Card at the bottom right, above the corner buttons. The open state is ui/panels.ts's (infoOpen), so a
// pick, the keys and the user's choice all reach the card the same way.
import { Check, Copy, Scan, ScanBox, X } from "lucide-react";
import { type CSSProperties, type ReactNode, useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { type BondEnd, centreShown, centreShownAlong, type Readout, readout } from "../ui/readout";
import { SHORTCUT } from "../ui/keyboard";
import { infoFocus, infoOpen, toggleInfo } from "../ui/panels";
import { AXES, axisColour } from "./axis-view-icon";
import { Group } from "./group";
import { ICON_SMALL, MENU_ICON } from "./icons";
import { TipButton } from "./tip";
import { useSignal } from "./use-signal";
import { PANEL_MOTION, usePresence } from "./presence";

const COPY_FEEDBACK_MS = 1500;

// The card while the details are open (the (i) button in the corner island, react/corner-buttons.tsx, is hidden then).
export function InfoCard() {
  const { shown, state } = usePresence(useSignal(infoOpen));
  return shown ? <SelectionCard state={state} /> : null;
}

function SelectionCard({ state }: { state: "open" | "closed" }) {
  const data = useSignal(readout);
  const focus = useSignal(infoFocus);
  const close = useRef<HTMLButtonElement>(null);
  // Opening the card by its (i) button brings the focus to the close button (ui/panels.ts toggleInfo); a pick does not.
  useEffect(() => {
    if (focus !== "close") return;
    close.current?.focus({ preventScroll: true });
    infoFocus.value = null;
  }, [focus]);
  return (
    <Card
      id="info"
      data-state={state}
      role="region"
      aria-label="Selection details"
      className={`${PANEL_MOTION} origin-bottom-right data-[state=closed]:slide-out-to-bottom-2 data-[state=open]:slide-in-from-bottom-2 gap-3 rounded-[var(--radius)] border-0 bg-[var(--panel)] px-4 py-3.5 text-[13px] shadow-[var(--shadow)] backdrop-blur-[6px] supports-[backdrop-filter]:bg-[var(--panel)]`}
    >
      <div className="flex items-start justify-between gap-2">
        <h2 className="m-0 pt-0.5 pr-6 text-[15px] leading-snug font-semibold">{title(data)}</h2>
        <TipButton
          ref={close}
          variant="ghost"
          size="icon-sm"
          aria-label="Hide the selection details"
          tip="Hide the selection details"
          shortcut={SHORTCUT.info}
          className="-mt-1 -mr-1"
          onClick={toggleInfo}
        >
          <X size={18} strokeWidth={1.75} />
        </TipButton>
      </div>
      <div id="info-body" aria-live="polite" className="grid gap-3">
        <Body data={data} />
      </div>
    </Card>
  );
}

function title(data: Readout): string {
  if (data.kind === "none") return "Nothing selected";
  if (data.kind === "polyhedron" || data.kind === "bond") return data.name;
  return `${data.element} atom`;
}

function Body({ data }: { data: Readout }) {
  if (data.kind === "none") {
    return (
      <p className="m-0 text-xs text-muted-foreground">Click an atom, a bond or a polyhedron to see its distances.</p>
    );
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
        <p className="m-0 text-xs text-muted-foreground">
          Δ is the bond-length distortion, the mean of ((d − d̄)/d̄)². Fractional coordinates are in the supercell.
        </p>
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
      <p className="m-0 text-xs text-muted-foreground">Fractional coordinates are in the supercell.</p>
    </>
  );
}

// One end of a bond: its element, then its reference with a copy button when it has one.
function EndRow({ label, end }: { label: string; end: BondEnd }) {
  return (
    <Row label={label}>
      {end.element}
      {end.ref !== null && (
        <>
          {end.ref}
          <CopyRef text={end.ref} />
        </>
      )}
    </Row>
  );
}

// The two columns: the labels, then the values (the monospace numbers, and a copy button after a reference).
function Rows({ children }: { children: ReactNode }) {
  return <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-4 gap-y-2">{children}</dl>;
}
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="m-0 flex min-w-0 flex-wrap items-center gap-1 font-mono text-[12.5px] tabular-nums break-words">
        {children}
      </dd>
    </>
  );
}

// Copies a reference (an atom's, or a bond end's); the icon and the tip say so for a moment, then go back to Copy.
function CopyRef({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), COPY_FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [state]);
  // writeText can throw synchronously (no clipboard in this context) as well as reject: both say failed
  const copy = () => {
    try {
      navigator.clipboard.writeText(text).then(
        () => setState("copied"),
        () => setState("failed"),
      );
    } catch {
      setState("failed");
    }
  };
  const tip = { idle: "Copy the reference", copied: "Copied", failed: "Copy failed" }[state];
  return (
    <TipButton variant="ghost" size="icon-xs" aria-label="Copy the reference" tip={tip} onClick={copy}>
      {state === "copied" ? <Check {...MENU_ICON} /> : <Copy {...MENU_ICON} />}
    </TipButton>
  );
}

// The view of the shown object, one group of icon buttons: Center (the framed box) frames it from where the camera
// looks; a, b and c (the frame with the axis's letter in it) also turn to look along that cell axis (ui/readout.ts),
// each with a short glide. The letters are the axis font's, in the triad's colours on hover.
function ViewButtons() {
  return (
    <Group label="View" className="flex items-center rounded-md border border-border">
      <TipButton
        variant="ghost"
        size="icon-sm"
        data-center
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
