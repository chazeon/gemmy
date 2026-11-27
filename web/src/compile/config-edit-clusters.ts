// Part of the config edits: the shared machinery is in config-edit-draft.ts, read it first.
//
// Clusters (rings and molecules), by rule index, and the automatic rings.
import type { ClusterRule, Color, SceneConfig } from "./config";
import { type Row, addRule, changeRow, editDraft, editRule, removeRule } from "./config-edit-draft";
import { automaticRowsOf, keysOwnedAfter, replaceOwnedRows, rowsByKey, withoutRows } from "./config-edit-ownership";

export function setClusterVisible(config: SceneConfig, index: number, visible: boolean): SceneConfig {
  return editRule(config, "clusters", index, { visible });
}

export function setClusterColor(config: SceneConfig, index: number, color: Color): SceneConfig {
  return editRule(config, "clusters", index, { color: [...color] });
}

export function setClusterWindow(config: SceneConfig, index: number, min: number, max: number): SceneConfig {
  return editRule(config, "clusters", index, { min, max });
}

export function setClusterAtoms(config: SceneConfig, index: number, atoms: string[]): SceneConfig {
  return editRule(config, "clusters", index, { atoms: [...atoms] });
}

// A new kind re-resolves the member counts: the kind's fields are dropped, so the schema fills the new kind's defaults. A
// molecule's max_size is null (no limit), and a ring's cannot be, so changing a molecule to a ring gives it 7. Keeping the
// old counts would apply a molecule's limits to a ring (or the reverse). A change to the kind a rule already has keeps
// its counts.
export function setClusterKind(config: SceneConfig, index: number, kind: ClusterRule["kind"]): SceneConfig {
  return editDraft(config, (draft) => ({
    ...draft,
    clusters: changeRow(draft.clusters, "clusters", index, (row) => withKind(row, kind)),
  }));
}

// The member counts are left to the schema, which fills the kind's defaults (CLUSTER_SIZES).
export function addClusterRule(
  config: SceneConfig,
  kind: ClusterRule["kind"],
  atoms: string[],
  min: number,
  max: number,
): SceneConfig {
  return addRule(config, "clusters", { kind, atoms: [...atoms], min, max });
}

export function removeClusterRule(config: SceneConfig, index: number): SceneConfig {
  return removeRule(config, "clusters", index);
}

// ---- Automatic rings: the ring rules detection owns, one per ring pattern ----------------------------------------------
// Detection makes one ring rule per pattern ("C6", "C4N2"), so the page keeps the patterns it owns, as the polyhedra keep
// their centres. The key is the ring's name with its kind (a molecule has no key, so it is never owned). A user's ring of
// the same name is not told apart from the automatic one: a rule the user edits leaves the set (the panel does that).

// The key of a cluster row: "ring C6" for a ring named C6, "" for a molecule.
export function ringKeyOf(rule: Row | ClusterRule): string {
  return rule.kind === "ring" ? `ring ${String(rule.name)}` : "";
}

// The ring patterns detection would place that no user cluster already holds.
export function detectedRingsOwnership(
  config: SceneConfig,
  owned: readonly string[],
  detected: ClusterRule[],
): string[] {
  return keysOwnedAfter(config.clusters, ringKeyOf, owned, detected.map(ringKeyOf));
}

// Re-detection of the automatic rings (see replaceOwnedRows): an owned pattern's ring is replaced in place, a pattern no
// longer found is removed, and a new pattern is added at the end. A user's cluster is left alone.
export function replaceAutomaticRings(
  config: SceneConfig,
  owned: readonly string[],
  detected: ClusterRule[],
): SceneConfig {
  const rows = rowsByKey(detected, ringKeyOf, ringFileRow);
  return editDraft(config, (draft) => ({
    ...draft,
    clusters: replaceOwnedRows(draft.clusters, ringKeyOf, owned, rows),
  }));
}

// Clear automatic: removes the automatic ring of each owned pattern; the user's clusters stay.
export function clearAutomaticRings(config: SceneConfig, owned: readonly string[]): SceneConfig {
  return editDraft(config, (draft) => ({
    ...draft,
    clusters: withoutRows(draft.clusters, automaticRowsOf(draft.clusters, ringKeyOf, owned)),
  }));
}

// A detected ring as the config file writes it (the schema fills the rest).
function ringFileRow(rule: ClusterRule): Row {
  return {
    kind: rule.kind,
    atoms: [...rule.atoms],
    min: rule.min_distance,
    max: rule.max_distance,
    min_size: rule.min_size,
    max_size: rule.max_size,
    flat: rule.flat,
    color: [...rule.color],
    name: rule.name,
  };
}

// The fields a kind's defaults fill in: the member counts, and flat (a ring's only; the schema refuses it on a molecule).
const KIND_FIELDS: readonly string[] = ["min_size", "max_size", "flat"];

// The rule with a new kind. Its kind fields are dropped when the kind changes, so the schema fills that kind's defaults.
function withKind(row: Row, kind: ClusterRule["kind"]): Row {
  if (row.kind === kind) return { ...row, kind };
  const kept = Object.fromEntries(Object.entries(row).filter(([key]) => !KIND_FIELDS.includes(key)));
  return { ...kept, kind };
}
