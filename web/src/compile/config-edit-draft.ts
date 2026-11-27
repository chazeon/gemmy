// Edits of a scene config: the style panel's way to change a config (docs/plans/stage6-panel.md, section 1). Each edit is a
// plain function that returns a new config and never changes its input. Its result goes through the schema, so a config
// an edit returns is one Python accepts. A refused edit throws ConfigError with the key path of the problem, which the
// panel shows. Edits work on the config's file form (configToData), so the schema fills the defaults and the key paths
// are the ones the user wrote (`bonds.0.max`, not `bonds.0.max_distance`).
//
// This file is the machinery the concept files share: the file form the edits change (Draft), the rule lists and their
// index checks, and the helpers that write a changed draft back through the schema. The concept files are
// config-edit-elements, -bonds, -polyhedra, -clusters and -cell (and -ownership for the automatic rows).
import type { SceneConfig } from "./config";
import { parseSceneConfig } from "./config";
import { configToData } from "./config-export";
import { ConfigError } from "./config-errors";

// A config in its file form (configToData): plain rows under the names the file uses (min and max, cells). An edit
// changes a copy of it, and the schema reads the copy back, so the defaults are filled and any error names its key.
interface CellDraft {
  supercell: number[];
  periodic: boolean[];
  box: Row;
  [key: string]: unknown;
}

export interface Draft {
  elements: Record<string, Row>;
  cells: CellDraft;
  bonds: Row[];
  polyhedra: Row[];
  clusters: Row[];
  [key: string]: unknown;
}

export type Row = Record<string, unknown>;
export type RuleList = "bonds" | "polyhedra" | "clusters";

export function editDraft(config: SceneConfig, change: (draft: Draft) => Draft): SceneConfig {
  const draft = configToData(config) as Draft;
  return parseSceneConfig(change(draft));
}

export function editRule(config: SceneConfig, list: RuleList, index: number, fields: Row): SceneConfig {
  return editDraft(config, (draft) => ({
    ...draft,
    [list]: changeRow(draft[list], list, index, (row) => ({ ...row, ...fields })),
  }));
}

export function addRule(config: SceneConfig, list: RuleList, row: Row): SceneConfig {
  return editDraft(config, (draft) => ({ ...draft, [list]: [...draft[list], row] }));
}

export function removeRule(config: SceneConfig, list: RuleList, index: number): SceneConfig {
  return editDraft(config, (draft) => {
    checkRuleIndex(draft[list], list, index);
    return { ...draft, [list]: draft[list].filter((_row, position) => position !== index) };
  });
}

// The rows with the one at `index` changed; the others keep their place.
export function changeRow(rows: Row[], list: RuleList, index: number, change: (row: Row) => Row): Row[] {
  checkRuleIndex(rows, list, index);
  return rows.map((row, position) => (position === index ? change(row) : row));
}

function checkRuleIndex(rows: Row[], list: RuleList, index: number): void {
  if (!Number.isInteger(index) || index < 0 || index >= rows.length) {
    throw new ConfigError(
      `${list}.${index}: there is no rule at this index (the config has ${rows.length} in ${list})`,
    );
  }
}

export function ruleFieldPath(list: RuleList, index: number, field: string): string {
  return `${list}.${index}.${field}`;
}

// The schema takes any float radius. A negative one has no meaning, so the edit refuses it with the key of the radius.
export function requireRadius(radius: number, path: string): void {
  if (!Number.isFinite(radius) || radius < 0) {
    throw new ConfigError(`${path}: Input should be a finite number greater than or equal to 0`);
  }
}
