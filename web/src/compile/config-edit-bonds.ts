// Part of the config edits: the shared machinery is in config-edit-draft.ts, read it first.
//
// Bonds, by rule index, and the automatic bonds.
import type { BondRule, Color, SceneConfig } from "./config";
import { type Row, addRule, editDraft, editRule, removeRule, requireRadius, ruleFieldPath } from "./config-edit-draft";
import { automaticRowsOf, keysOwnedAfter, replaceOwnedRows, rowsByKey, withoutRows } from "./config-edit-ownership";

export function setBondWindow(config: SceneConfig, index: number, min: number, max: number): SceneConfig {
  return editRule(config, "bonds", index, { min, max });
}

export function setBondVisible(config: SceneConfig, index: number, visible: boolean): SceneConfig {
  return editRule(config, "bonds", index, { visible });
}

export function setBondColor(config: SceneConfig, index: number, color: Color): SceneConfig {
  return editRule(config, "bonds", index, { color: [...color] });
}

export function setBondRadius(config: SceneConfig, index: number, radius: number): SceneConfig {
  requireRadius(radius, ruleFieldPath("bonds", index, "radius"));
  return editRule(config, "bonds", index, { radius });
}

export function setBondStyle(config: SceneConfig, index: number, style: BondRule["style"]): SceneConfig {
  return editRule(config, "bonds", index, { style });
}

export function addBondRule(config: SceneConfig, a: string, b: string, min: number, max: number): SceneConfig {
  return addRule(config, "bonds", { a, b, min, max });
}

export function removeBondRule(config: SceneConfig, index: number): SceneConfig {
  return removeRule(config, "bonds", index);
}

// ---- Automatic bonds: the rules detection owns, one per label pair ----------------------------------------------------
// Detection makes one rule per label pair, so the page keeps the pairs it owns (ui/structure-model.ts), not the windows:
// a window can change (a new tolerance) and the pair stays. A pair whose rule the user edits leaves the set, and the user's
// rule is then left alone. The config has no field for ownership, so it stays Python-valid.

// The label pair of a rule, in either order: '["Mg","O"]' for Mg-O and O-Mg (JSON, so a label cannot collide with another pair).
export function pairOf(rule: { a: string; b: string }): string {
  return JSON.stringify([rule.a, rule.b].sort());
}

// The pairs detection would place that no user rule already holds: the ones re-detection owns after it runs.
export function detectedOwnership(config: SceneConfig, owned: readonly string[], detected: BondRule[]): string[] {
  return keysOwnedAfter(config.bonds, pairOf, owned, detected.map(pairOf));
}

// Re-detection of the automatic bonds (see replaceOwnedRows). Pressing it twice with the same settings gives the same config.
export function replaceAutomaticBonds(
  config: SceneConfig,
  owned: readonly string[],
  detected: BondRule[],
): SceneConfig {
  const rows = rowsByKey(detected, pairOf, fileRow);
  return editDraft(config, (draft) => ({ ...draft, bonds: replaceOwnedRows(draft.bonds, rowPair, owned, rows) }));
}

// Clear automatic: removes the automatic bond of each owned pair; the user's bonds stay.
export function clearAutomaticBonds(config: SceneConfig, owned: readonly string[]): SceneConfig {
  return editDraft(config, (draft) => ({
    ...draft,
    bonds: withoutRows(draft.bonds, automaticRowsOf(draft.bonds, rowPair, owned)),
  }));
}

function rowPair(row: Row): string {
  return pairOf({ a: String(row.a), b: String(row.b) });
}

// A detected rule as the config file writes it (min and max; the schema fills the rest).
function fileRow(rule: BondRule): Row {
  return { a: rule.a, b: rule.b, min: rule.min_distance, max: rule.max_distance, complete: rule.complete };
}
