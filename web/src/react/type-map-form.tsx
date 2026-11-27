// The type map form: the home card's prompt for a LAMMPS file whose types have no element (ui/types-needed.ts). It asks
// for one label per unresolved type, checks each label as it is typed, and lists the saved presets under them
// (type-preset-list.tsx). Apply and Cancel are the prompt's. The labels start from the prompt's draft, so a retry of a
// failed apply keeps what was typed, and a new prompt is a new form (home.tsx gives each one its own key).
import { type FormEvent, Fragment, type RefObject, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { isElementLabel } from "../structure/elements";
import { presetList } from "../ui/type-preset-store";
import { presetKey, type TypePreset } from "../ui/type-presets";
import type { TypePrompt } from "../ui/types-needed";
import { HomeCard } from "./home-card";
import { TypePresetList } from "./type-preset-list";
import { useSignal } from "./use-signal";

type Labels = Record<number, string>;

// The preflight (tailwind.css) makes every element border-box, so an input's padding and border stay inside its column.
//
// The rows are one grid: the type number's column (wide enough for "Type 10" at the card's text size) and the input's
// column, which may shrink to the card's content width (minmax(0, 1fr): an input's own width never pushes it out). Each
// label sits in its input's row, so it is centred on the input; a message is a row of its own under the input.
const ROWS = "grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-3 gap-y-3";

// The label typed for a type, trimmed; "" while none is typed.
const labelOf = (labels: Labels, type: number): string => (labels[type] ?? "").trim();

// A preset's labels for the unresolved types it names. The other types keep what was typed.
function labelsFromPreset(preset: TypePreset, unresolved: readonly number[]): Labels {
  const labels: Labels = {};
  for (const type of unresolved) {
    const label = preset.types[type];
    if (label !== undefined) labels[type] = label;
  }
  return labels;
}

// Focus moves to the form's first input when the form is drawn, and back to what had it when the form goes.
function useFocusFirstInput(first: RefObject<HTMLInputElement | null>): void {
  useEffect(() => {
    const returnTo = document.activeElement;
    first.current?.focus();
    return () => {
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, [first]);
}

export function TypeMapForm({ prompt }: { prompt: TypePrompt }) {
  const presets = useSignal(presetList);
  const [labels, setLabels] = useState<Labels>(prompt.draft ?? {});
  const firstInput = useRef<HTMLInputElement>(null);
  const reasonId = useId();
  useFocusFirstInput(firstInput);
  const ready = prompt.unresolved.every((type) => isElementLabel(labelOf(labels, type)));
  const suggested = new Set(prompt.suggested.map(presetKey));

  const apply = (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    const map: Record<number, string> = {};
    for (const type of prompt.unresolved) map[type] = labelOf(labels, type);
    prompt.apply(map);
  };
  const choose = (preset: TypePreset) =>
    setLabels((current) => ({ ...current, ...labelsFromPreset(preset, prompt.unresolved) }));

  return (
    <HomeCard
      testId="type-map"
      title="Name the LAMMPS types"
      description={`${prompt.fileName} gives atoms type numbers, not elements. Give each type its element, such as Fe or Fe1.`}
    >
      <form className="grid gap-4" onSubmit={apply}>
        <div className="grid gap-2">
          <div className={ROWS}>
            {prompt.unresolved.map((type, k) => {
              const id = `type-input-${type}`;
              const message = `${id}-error`;
              const typed = labelOf(labels, type);
              const invalid = typed !== "" && !isElementLabel(typed);
              return (
                <Fragment key={type}>
                  <Label htmlFor={id}>Type {type}</Label>
                  <Input
                    id={id}
                    ref={k === 0 ? firstInput : undefined}
                    data-testid={id}
                    value={labels[type] ?? ""}
                    placeholder="e.g. Fe1"
                    autoComplete="off"
                    aria-invalid={invalid || undefined}
                    aria-describedby={invalid ? message : undefined}
                    onChange={(event) => {
                      const value = event.target.value;
                      setLabels((current) => ({ ...current, [type]: value }));
                    }}
                  />
                  {invalid && (
                    <p id={message} className="col-start-2 -mt-2 text-xs text-destructive">
                      {typed} does not name an element, such as Fe or Fe1.
                    </p>
                  )}
                </Fragment>
              );
            })}
          </div>
          {!ready && (
            <p id={reasonId} className="text-xs text-muted-foreground">
              Name every type to apply
            </p>
          )}
        </div>
        {prompt.error !== undefined && (
          <p role="alert" className="font-mono text-xs break-words whitespace-pre-wrap text-destructive">
            {prompt.error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" data-testid="type-cancel" onClick={() => prompt.cancel()}>
            Cancel
          </Button>
          <Button
            type="submit"
            data-testid="type-apply"
            disabled={!ready}
            aria-describedby={ready ? undefined : reasonId}
          >
            Apply
          </Button>
        </div>
      </form>
      <Separator />
      <TypePresetList presets={presets} suggested={suggested} onUse={choose} />
    </HomeCard>
  );
}
