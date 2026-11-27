// Writing a config back out: TOML and JSON text of a SceneConfig, the data both are made of (configToData), and the JSON
// writer. Export writes the names the file is read with, so configToData output validates in Python. Unset keys are
// dropped, since TOML has no null and every null default is None in Python too.
import { stringify as stringifyToml } from "smol-toml";
import type { SceneConfig } from "./config";
import { ConfigError, isObject } from "./config-errors";

export function configToToml(config: SceneConfig): string {
  return stringifyToml(configToData(config));
}

// JSON has no Infinity or NaN, and the page's own reader (JSON.parse) refuses them, so a config with one is not
// exported as JSON: the error names the key, and TOML, which keeps inf and nan, is the export for it.
export function configToJson(config: SceneConfig): string {
  const data = configToData(config);
  const found = firstNonFinite(data, []);
  if (found !== null) {
    const [key, value] = found;
    throw new ConfigError(
      `${key}: ${writeJson(value, "")} cannot be written as JSON (JSON has no Infinity or NaN). ` +
        "Export the config as TOML instead, which keeps inf and nan.",
    );
  }
  return jsonText(data);
}

// The config as the file Python reads (scene_config_from_dict validates it back to the same model).
export function configToData(config: SceneConfig): Record<string, unknown> {
  const { cell, bonds, polyhedra, clusters, ...rest } = config;
  return {
    ...(dropUnset(rest) as Record<string, unknown>),
    cells: renameKeys(dropUnset(cell) as Record<string, unknown>, { cartesian_limits: "limits" }),
    bonds: bonds.map((rule) => renameKeys(dropUnset(rule) as Record<string, unknown>, DISTANCE_NAMES)),
    polyhedra: polyhedra.map((rule) => renameKeys(dropUnset(rule) as Record<string, unknown>, DISTANCE_NAMES)),
    clusters: clusters.map((rule) => renameKeys(dropUnset(rule) as Record<string, unknown>, DISTANCE_NAMES)),
  };
}

// JSON.stringify(value, null, 2) with one difference: a non-finite number is written as Infinity, -Infinity or NaN.
// JSON.stringify would write null, which Python would then refuse for a float. Python's json reads these tokens, but
// configToJson refuses to write them for a user. Only the test bridge (web/test/compile-entry.ts) writes them.
export function jsonText(value: unknown): string {
  return `${writeJson(value, "")}\n`;
}

// Export names, at the positions where a field has an alias and nowhere else: the rule keys (min_distance, max_distance)
// and the cell's cartesian_limits, and the scene's cell (written as `cells`). A key of the same name anywhere else (an
// element called "cell", a material called "min_distance") keeps its name.
const DISTANCE_NAMES: Readonly<Record<string, string>> = { min_distance: "min", max_distance: "max" };

// The key path (as the export names it) and value of the first non-finite number in the data, or null.
function firstNonFinite(value: unknown, path: string[]): [string, number] | null {
  if (typeof value === "number") return Number.isFinite(value) ? null : [path.join("."), value];
  const children: [string, unknown][] = Array.isArray(value)
    ? value.map((item, index) => [String(index), item])
    : isObject(value)
      ? Object.entries(value)
      : [];
  for (const [key, item] of children) {
    const found = firstNonFinite(item, [...path, key]);
    if (found !== null) return found;
  }
  return null;
}

// Drops the unset keys (null and undefined) at any depth. Keys are not renamed.
function dropUnset(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(dropUnset);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined)
      .map(([key, item]) => [key, dropUnset(item)]),
  );
}

// Renames the keys in `names` at this one level.
function renameKeys(value: Record<string, unknown>, names: Readonly<Record<string, string>>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [Object.hasOwn(names, key) ? names[key] : key, item]),
  );
}

function writeJson(value: unknown, indent: string): string {
  if (typeof value === "number" && !Number.isFinite(value)) {
    if (Number.isNaN(value)) return "NaN";
    return value > 0 ? "Infinity" : "-Infinity";
  }
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return `[\n${value.map((item) => inner + writeJson(item, inner)).join(",\n")}\n${indent}]`;
  }
  if (isObject(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) return "{}";
    const lines = entries.map(([key, item]) => `${inner}${JSON.stringify(key)}: ${writeJson(item, inner)}`);
    return `{\n${lines.join(",\n")}\n${indent}}`;
  }
  return JSON.stringify(value) ?? "null";
}
