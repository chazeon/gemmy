// One saved type map in the form's list: its name and size (marked when it is this file's) on one line, and its actions
// at the right end (on the line below on a narrow card). Use is the outline button; Rename and Delete are ghost buttons of
// the same size. The row owns its editing state, so a rename in progress is kept in this row and the list around it is
// not drawn again.
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteStoredPreset, renameStoredPreset } from "../ui/type-preset-store";
import { presetKey, type TypePreset } from "../ui/type-presets";

// "1 type", "3 types"; the file's own map says so after the count.
const sizeNote = (count: number, inThisFile: boolean): string =>
  `${count} ${count === 1 ? "type" : "types"}${inThisFile ? ", this file" : ""}`;

export function TypePresetRow({
  preset,
  inThisFile,
  onUse,
}: {
  preset: TypePreset;
  inThisFile: boolean;
  onUse: (preset: TypePreset) => void;
}) {
  const key = presetKey(preset);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(preset.name);

  if (renaming) {
    return (
      <li className="grid gap-2 text-xs" data-testid="type-preset">
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim() === "") return;
            renameStoredPreset(key, draft.trim());
            setRenaming(false);
          }}
        >
          <Input
            aria-label={`New name for ${preset.name}`}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button type="submit" variant="outline" disabled={draft.trim() === ""}>
            Save
          </Button>
        </form>
      </li>
    );
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs" data-testid="type-preset">
      <span className="min-w-0 max-w-full truncate">
        {preset.name}
        <span className="text-muted-foreground"> ({sizeNote(preset.signature.types.length, inThisFile)})</span>
      </span>
      <div className="ml-auto flex shrink-0 gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-label={`Use ${preset.name}`}
          onClick={() => onUse(preset)}
        >
          Use
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Rename ${preset.name}`}
          onClick={() => {
            setDraft(preset.name);
            setRenaming(true);
          }}
        >
          Rename
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          aria-label={`Delete ${preset.name}`}
          onClick={() => deleteStoredPreset(key)}
        >
          Delete
        </Button>
      </div>
    </li>
  );
}
