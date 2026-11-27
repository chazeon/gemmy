// Part of the config edits: the shared machinery is in config-edit-draft.ts, read it first.
//
// Elements, by key: a key is a species label, looked up as styleFor looks it up.
import type { Color, SceneConfig } from "./config";
import { DEFAULT_ELEMENT_KEY } from "./colour-schemes";
import { type Draft, type Row, editDraft, requireRadius } from "./config-edit-draft";

export function setElementVisible(config: SceneConfig, key: string, visible: boolean): SceneConfig {
  return editElement(config, key, { visible });
}

export function setElementColor(config: SceneConfig, key: string, color: Color): SceneConfig {
  return editElement(config, key, { color: [...color] });
}

export function setElementRadius(config: SceneConfig, key: string, radius: number): SceneConfig {
  requireRadius(radius, `elements.${key}.radius`);
  return editElement(config, key, { radius });
}

// A key's style starts from the entry styleFor would use for it: its own entry, else "default", else nothing (so the
// schema's defaults fill it in). An edit that sets one field of a new entry therefore changes only that field.
function editElement(config: SceneConfig, key: string, fields: Row): SceneConfig {
  return editDraft(config, (draft) => ({
    ...draft,
    elements: { ...draft.elements, [key]: { ...elementBase(draft, key), ...fields } },
  }));
}

// The style entry a key starts from: its own entry, else the "default" entry, else nothing.
export function elementBase(draft: Draft, key: string): Row {
  if (Object.hasOwn(draft.elements, key)) return draft.elements[key];
  return Object.hasOwn(draft.elements, DEFAULT_ELEMENT_KEY) ? draft.elements[DEFAULT_ELEMENT_KEY] : {};
}
