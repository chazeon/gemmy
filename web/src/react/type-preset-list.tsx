// The saved type maps under the type form: each row is one preset (type-preset-row.tsx). The whole list can be downloaded
// as a presets file, and a file's presets added to it; a file that is refused says why, under the list.
import { type ChangeEvent, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { errorText } from "../errors";
import { downloadPresets, importPresetsFile } from "../ui/type-preset-store";
import { presetKey, type TypePreset } from "../ui/type-presets";
import { TypePresetRow } from "./type-preset-row";

export function TypePresetList({
  presets,
  suggested,
  onUse,
}: {
  presets: TypePreset[];
  // The keys (presetKey) of the presets this file matches.
  suggested: ReadonlySet<string>;
  onUse: (preset: TypePreset) => void;
}) {
  const importer = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const importFile = async (file: File | undefined) => {
    if (file === undefined) return;
    try {
      await importPresetsFile(file);
      setProblem(null);
    } catch (error) {
      setProblem(errorText(error));
    }
  };
  const chooseFile = (event: ChangeEvent<HTMLInputElement>) => {
    void importFile(event.target.files?.[0]);
    event.target.value = "";
  };
  return (
    <section aria-labelledby="type-presets-title" className="grid gap-3">
      <h3 id="type-presets-title" className="text-xs font-medium">
        Saved type maps
      </h3>
      {presets.length === 0 && <p className="text-xs text-muted-foreground">None yet. Applying a map saves it.</p>}
      <ul className="grid gap-3">
        {presets.map((preset) => (
          <TypePresetRow
            key={presetKey(preset)}
            preset={preset}
            inThisFile={suggested.has(presetKey(preset))}
            onUse={onUse}
          />
        ))}
      </ul>
      <div className="flex justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={presets.length === 0}
          onClick={() => downloadPresets()}
        >
          Export presets
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => importer.current?.click()}>
          Import presets
        </Button>
        <input ref={importer} type="file" accept=".json,application/json" hidden onChange={chooseFile} />
      </div>
      {problem !== null && (
        <p role="alert" className="font-mono text-xs break-words whitespace-pre-wrap text-destructive">
          {problem}
        </p>
      )}
    </section>
  );
}
