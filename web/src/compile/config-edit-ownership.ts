// Part of the config edits: the shared machinery is in config-edit-draft.ts, read it first.
//
// Automatic rows: the rows detection owns, each under its owned key (a bond's element pair, a polyhedron's centre element,
// a ring's pattern). The page keeps the keys it owns (ui/structure-model.ts), so a re-detection can replace those rows and
// leave the user's rows alone. A key a user row holds is the user's: detection does not place it again. The bonds,
// polyhedra and clusters files use these helpers with their own key functions.
import type { Row } from "./config-edit-draft";

// The keys that the user's rows hold: those that no owned key names.
function userKeysOf<T>(rows: readonly T[], keyOf: (row: T) => string, owned: readonly string[]): Set<string> {
  const ownedNow = new Set(owned);
  return new Set(rows.map(keyOf).filter((key) => !ownedNow.has(key)));
}

// The keys detection would place that no user row holds: the ones owned after re-detection runs.
export function keysOwnedAfter<T>(
  rows: readonly T[],
  keyOf: (row: T) => string,
  owned: readonly string[],
  detected: readonly string[],
): string[] {
  const userKeys = userKeysOf(rows, keyOf, owned);
  return detected.filter((key) => !userKeys.has(key));
}

// The automatic row of each owned key: the first row of that key. Any further row of the key is the user's.
export function automaticRowsOf(rows: Row[], keyOf: (row: Row) => string, owned: readonly string[]): Row[] {
  const ownedNow = new Set(owned);
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = keyOf(row);
    if (!ownedNow.has(key) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// The rows without the removed ones (by identity).
export function withoutRows(rows: Row[], removed: Row[]): Row[] {
  const gone = new Set(removed);
  return rows.filter((row) => !gone.has(row));
}

// Re-detection in one list: each owned key's automatic row is replaced in place by its detected row (its window may change,
// and it keeps the visibility it had), an owned key detection no longer finds is removed, and a detected key no row holds
// is added at the end. A key a user row holds is not detected again.
export function replaceOwnedRows(
  rows: Row[],
  keyOf: (row: Row) => string,
  owned: readonly string[],
  detected: Map<string, Row>,
): Row[] {
  const userKeys = userKeysOf(rows, keyOf, owned);
  const automatic = new Set(automaticRowsOf(rows, keyOf, owned));
  const placed = new Set<string>();
  const out: Row[] = [];
  for (const row of rows) {
    if (!automatic.has(row)) {
      out.push(row);
      continue;
    }
    const key = keyOf(row);
    const replacement = detected.get(key);
    if (replacement !== undefined) out.push({ ...replacement, visible: row.visible });
    placed.add(key);
  }
  for (const [key, replacement] of detected) {
    if (placed.has(key) || userKeys.has(key)) continue;
    out.push(replacement);
    placed.add(key);
  }
  return out;
}

// The detected rows that re-detection places: those whose key no user row holds.
export function placedRows(
  rows: Row[],
  keyOf: (row: Row) => string,
  owned: readonly string[],
  detected: Map<string, Row>,
): Row[] {
  const userKeys = userKeysOf(rows, keyOf, owned);
  return [...detected].filter(([key]) => !userKeys.has(key)).map(([, row]) => row);
}

// The detected rules by key, each as the config row it is written as.
export function rowsByKey<T>(
  rules: readonly T[],
  keyOf: (rule: T) => string,
  toRow: (rule: T) => Row,
): Map<string, Row> {
  return new Map(rules.map((rule) => [keyOf(rule), toRow(rule)] as const));
}
