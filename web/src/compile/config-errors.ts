// The config's errors: the ConfigError class, the aliases (min for min_distance) that the schemas and the messages both
// need, and the key path of an issue as the user wrote it. config.ts reads with these; config-export.ts uses isObject.
import type * as z from "zod/mini";

// The config is wrong: the message names the key path, as pydantic's does ("bonds.0.colour: Extra inputs ...").
export class ConfigError extends Error {}

// The JSON names of the fields that have an alias (pydantic's AliasChoices): the first is the name a missing field is
// reported under. Two aliases of one field may not both be given (see renameAliases in config.ts).
export const ALIASES: Readonly<Record<string, readonly string[]>> = {
  min_distance: ["min", "min_distance"],
  max_distance: ["max", "max_distance"],
  cartesian_limits: ["limits", "cartesian_limits"],
  cell: ["cells", "cell"],
};

// The field each alias names (min -> min_distance).
const FIELD_OF_ALIAS: ReadonlyMap<string, string> = new Map(
  Object.entries(ALIASES).flatMap(([field, names]) =>
    names.filter((name) => name !== field).map((name) => [name, field]),
  ),
);

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// Every issue, one line each, with its key path. An unexpected key is reported at the key, not at its object. With an
// alias and its field name both given, pydantic consumes the alias and reports the field name, so an unexpected alias is
// reported as its field name when the object holds that too.
export function configError(error: { issues: z.core.$ZodIssue[] }, raw: unknown): ConfigError {
  return new ConfigError(error.issues.map((issue) => issueLine(issue, raw)).join("\n"));
}

function issueLine(issue: z.core.$ZodIssue, raw: unknown): string {
  const path = userPath(raw, issue.path);
  if (issue.code === "unrecognized_keys") {
    let key = issue.keys[0];
    const parent = nodeAt(raw, path);
    const field = FIELD_OF_ALIAS.get(key);
    if (field !== undefined && isObject(parent) && Object.hasOwn(parent, field)) key = field;
    return `${[...path, key].join(".")}: Extra inputs are not permitted`;
  }
  return `${path.length > 0 ? path.join(".") : "(root)"}: ${issue.message}`;
}

// The key path as the user wrote it. A field given under one of its aliases is named by that alias (`bonds.0.min`, as
// pydantic reports it); a missing aliased field is named by its first alias. Only keys that the input does not hold are
// looked up in ALIASES, so a dictionary key that happens to be a field name (an element called "cell") is kept as it is.
function userPath(raw: unknown, path: readonly PropertyKey[]): string[] {
  const out: string[] = [];
  let node: unknown = raw;
  for (const segment of path) {
    let key = String(segment);
    const parent = node;
    if (isObject(parent) && !Object.hasOwn(parent, key) && Object.hasOwn(ALIASES, key)) {
      const names = ALIASES[key];
      key = names.find((name) => Object.hasOwn(parent, name)) ?? names[0];
    }
    out.push(key);
    if (Array.isArray(parent)) node = parent[Number(key)];
    else node = isObject(parent) ? parent[key] : undefined;
  }
  return out;
}

// The object at a user key path (the keys as the input has them).
function nodeAt(raw: unknown, path: readonly string[]): unknown {
  let node: unknown = raw;
  for (const key of path) node = Array.isArray(node) ? node[Number(key)] : isObject(node) ? node[key] : undefined;
  return node;
}
