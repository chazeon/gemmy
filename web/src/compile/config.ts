// The compile config, the user's config file as zod/mini schemas: the models, their JSON aliases (min, max, cells,
// limits), RGB coercion, defaults and validators. Field names are the config's keys in snake_case. Input takes the
// aliases, and error paths name the key the user wrote. Unset optional keys are null here. Errors live in
// config-errors.ts; writing a config back out lives in config-export.ts. The `types` schema is in config-types.ts.
import * as z from "zod/mini";
import { readData } from "./datafile";
import { ALIASES, ConfigError, configError, isObject } from "./config-errors";
import { lammpsTypes } from "./config-types";

export type Color = [number, number, number, number];
export type BondStyle = "solid" | "dashed" | "dotted";
export type Axis = "x" | "y" | "z";
export type Range = [number, number];
export type AxisRanges = Partial<Record<Axis, Range>>;
// An atom reference: a supercell index, or "5+1_0_0" for an image (selection.parse_site_ref).
export type AtomRef = number | string;

const AXES: readonly string[] = ["x", "y", "z"];

// Defaults that more than one schema uses.
const DEFAULT_GREY: Color = [0.8, 0.8, 0.8, 1];
const DEFAULT_BOND_COLOUR: Color = [0.7, 0.7, 0.7, 1];
const DEFAULT_POLYHEDRON_COLOUR: Color = [0.2, 0.6, 1.0, 1];
const POLYHEDRON_MATERIAL = "polyhedron";
// Tolerance, in fractional units, for wrapping and for the inclusive display box.
const DEFAULT_EPS = 1e-4;
// The most members a ring may have: a bigger ring is a macrocycle, better drawn as a molecule.
const MAX_RING_SIZE = 12;

// RGB gets alpha 1.0.
function coerceColor(value: unknown): unknown {
  return Array.isArray(value) && value.length === 3 ? [...value, 1] : value;
}

// A float: any JS number, Infinity and NaN included (zod's number() refuses both). The bounds are checks on it, so NaN
// fails them.
const float = z.custom<number>((value) => typeof value === "number", { error: "Input should be a valid number" });
// A finite float. An infinite box or limit would make the image loop of lattice.ts run forever, so infinity and NaN are
// refused.
const finite = z.custom<number>((value) => typeof value === "number" && Number.isFinite(value), {
  error: "Input should be a finite number",
});
// A distance of a rule: finite and not negative.
const distance = finite.check(z.gte(0, { error: "Input should be greater than or equal to 0" }));
// A radius of an element or a bond: not negative. Zero is allowed.
const radius = float.check(z.gte(0, { error: "Input should be greater than or equal to 0" }));
const unit = float.check(z.gte(0), z.lte(1));
const range = z.tuple([finite, finite]);
const rgb = z.pipe(z.transform(coerceColor), z.tuple([float, float, float, float]));
const ref = z.union([z.int(), z.string()]);
const refOrList = z.union([ref, z.array(ref)]);

// Axis ranges (cell.box, cell.cartesian_limits). The box also needs low <= high; the limits do not.
function axisRanges(field: "box" | "limits", checkOrder: boolean) {
  return z.record(z.string(), range).check((ctx) => {
    const value = ctx.value;
    const bad = Object.keys(value)
      .filter((axis) => !AXES.includes(axis))
      .sort();
    if (bad.length > 0) {
      ctx.issues.push({
        code: "custom",
        message: `${field} axes must be x, y or z; got ${JSON.stringify(bad)}.`,
        input: value,
      });
    }
    if (checkOrder && Object.values(value).some(([low, high]) => low > high)) {
      ctx.issues.push({
        code: "custom",
        message: "box ranges must be [low, high] with low <= high.",
        input: value,
      });
    }
  });
}

// A set of names (a cluster's atoms, a polyhedron's ligands): sorted, duplicates dropped, and at least one left.
const nameSet = z
  .pipe(
    z.array(z.string()),
    z.transform((names) => [...new Set(names)].sort()),
  )
  .check((ctx) => {
    if (ctx.value.length === 0) {
      ctx.issues.push({
        code: "custom",
        message: "Set should have at least 1 item after validation, not 0",
        input: ctx.value,
      });
    }
  });

// A rule's distance window, inclusive on both ends: min <= max, reported at max_distance .
interface DistanceWindow {
  min_distance: number;
  max_distance: number;
}
function checkWindow<T extends DistanceWindow>(ctx: z.core.ParsePayload<T>): void {
  if (ctx.value.min_distance > ctx.value.max_distance) {
    ctx.issues.push({ code: "custom", message: "min must be <= max.", input: ctx.value, path: ["max_distance"] });
  }
}

// The input with each listed field under its field name. A field whose aliases the input gives once is renamed to its
// field name; when it gives two, it is left alone, so the name that is not the field's is an unexpected key, as
// the schema reports it.
function renameAliases(raw: unknown, fields: readonly string[]): unknown {
  if (!isObject(raw)) return raw;
  let out: Record<string, unknown> = raw;
  for (const field of fields) {
    const given = ALIASES[field].filter((name) => Object.hasOwn(raw, name));
    if (given.length !== 1) continue;
    const { [given[0]]: value, ...rest } = out;
    out = { ...rest, [field]: value };
  }
  return out;
}

function acceptAliases<T extends z.ZodMiniType>(schema: T, fields: readonly string[]) {
  return z.pipe(
    z.transform((raw: unknown) => renameAliases(raw, fields)),
    schema,
  );
}

const materialStyle = z.strictObject({
  type: z._default(z.string(), "principled"),
  base_color: z._default(rgb, DEFAULT_GREY),
  roughness: z._default(float, 0.4),
  metallic: z._default(float, 0),
  alpha: z._default(float, 1),
});

const elementStyle = z.strictObject({
  visible: z._default(z.boolean(), true),
  representation: z._default(z.string(), "sphere"),
  radius: z._default(radius, 0.35),
  color: z._default(rgb, DEFAULT_GREY),
  material: z._default(z.string(), "matte"),
});

const bondRule = acceptAliases(
  z
    .strictObject({
      a: z.string(),
      b: z.string(),
      min_distance: distance,
      max_distance: distance,
      radius: z._default(radius, 0.08),
      color: z._default(rgb, DEFAULT_BOND_COLOUR),
      material: z._default(z.string(), "bond"),
      visible: z._default(z.boolean(), true),
      // dashed or dotted, e.g. for hydrogen bonds
      style: z._default(z.enum(["solid", "dashed", "dotted"]), "solid"),
      // none: add no atom for this bond. ends: also show an end outside the box (one hop). polyhedra: ends, plus
      // complete this bond for atoms pulled in as polyhedron ligands (one more hop).
      complete: z._default(z.enum(["none", "ends", "polyhedra"]), "ends"),
    })
    .check(checkWindow),
  ["min_distance", "max_distance"],
);

const polyhedronRule = acceptAliases(
  z
    .strictObject({
      center: z.string(),
      // A set of names, stored sorted and unique.
      ligands: nameSet,
      min_distance: distance,
      max_distance: distance,
      min_coordination: z._default(z.int(), 4),
      max_coordination: z._default(z.nullable(z.int()), null),
      visible: z._default(z.boolean(), true),
      color: z._default(rgb, DEFAULT_POLYHEDRON_COLOUR),
      material: z._default(z.string(), POLYHEDRON_MATERIAL),
      name: z._default(z.nullable(z.string()), null),
      // Reserved for animation; both modes give the same scene today.
      topology_mode: z._default(
        z.pipe(
          z.transform((value: unknown) => String(value).toLowerCase()),
          z.enum(["topology_locked", "topology_adaptive"], {
            error: "topology_mode must be topology_locked or topology_adaptive.",
          }),
        ),
        "topology_locked",
      ),
      // Also build this polyhedron for centres that are boundary images (e.g. the 8 corner copies).
      image_centers: z._default(z.boolean(), false),
    })
    .check(checkWindow),
  ["min_distance", "max_distance"],
);

// The member counts of a cluster kind, used when its rule leaves them out. max_size null: no limit.
interface SizeWindow {
  min_size: number;
  max_size: number | null;
}

// The size window of each cluster kind.
const CLUSTER_SIZES: Readonly<Record<string, SizeWindow>> = {
  molecule: { min_size: 4, max_size: null },
  ring: { min_size: 5, max_size: 7 },
};

// The kind's sizes for each size key the rule leaves out. It runs before the fields are read.
function clusterSizeDefaults(raw: unknown): unknown {
  if (!isObject(raw) || typeof raw.kind !== "string" || !Object.hasOwn(CLUSTER_SIZES, raw.kind)) return raw;
  const { min_size, max_size } = CLUSTER_SIZES[raw.kind];
  return { min_size, max_size, ...raw };
}

// A cluster's sizes: min_size at least 3, and max_size from min_size up. A ring's max_size is a
// number up to MAX_RING_SIZE, so null (no limit) is refused for it.
function checkSizes<T extends { kind: string; min_size: number; max_size: number | null }>(
  ctx: z.core.ParsePayload<T>,
): void {
  const { kind, min_size: low, max_size: high } = ctx.value;
  if (kind === "ring" && (high === null || high > MAX_RING_SIZE)) {
    ctx.issues.push({
      code: "custom",
      message:
        `a ring's max_size is a number from 3 to ${MAX_RING_SIZE}: null (no upper limit) and bigger rings are refused, ` +
        "since a macrocycle is better drawn as a molecule.",
      input: ctx.value,
      path: ["max_size"],
    });
  }
  if (high !== null && low > high) {
    ctx.issues.push({ code: "custom", message: "min_size must be <= max_size.", input: ctx.value, path: ["max_size"] });
  }
}

const clusterSize = z.int().check(z.gte(3, { error: "Input should be greater than or equal to 3" }));

// A ring only: flat keeps a ring only when every atom lies within RING_FLAT_TOLERANCE of its plane (compile/clusters.ts).
function checkFlat<T extends { kind: string; flat: boolean }>(ctx: z.core.ParsePayload<T>): void {
  if (ctx.value.flat && ctx.value.kind !== "ring") {
    ctx.issues.push({ code: "custom", message: "flat applies to a ring only.", input: ctx.value, path: ["flat"] });
  }
}

const clusterRule = acceptAliases(
  z.pipe(
    z.transform(clusterSizeDefaults),
    z
      .strictObject({
        kind: z.enum(["molecule", "ring"]),
        // A set: sorted, duplicates dropped, and at least one left.
        atoms: nameSet,
        min_distance: distance,
        max_distance: distance,
        min_size: clusterSize,
        max_size: z.nullable(clusterSize),
        flat: z._default(z.boolean(), false),
        visible: z._default(z.boolean(), true),
        color: z._default(rgb, DEFAULT_POLYHEDRON_COLOUR),
        material: z._default(z.string(), POLYHEDRON_MATERIAL),
        name: z._default(z.nullable(z.string()), null),
      })
      .check(checkWindow, checkSizes, checkFlat),
  ),
  ["min_distance", "max_distance"],
);

const cellConfig = acceptAliases(
  z.strictObject({
    supercell: z._default(z.tuple([z.int(), z.int(), z.int()]), [1, 1, 1]),
    periodic: z._default(z.tuple([z.boolean(), z.boolean(), z.boolean()]), [false, false, false]),
    cartesian_limits: z._default(z.nullable(axisRanges("limits", false)), null),
    // A fractional tolerance: finite, and below half a cell.
    eps: z._default(
      finite.check(
        z.gte(0, { error: "Input should be greater than or equal to 0" }),
        z.lt(0.5, { error: "Input should be less than 0.5" }),
      ),
      DEFAULT_EPS,
    ),
    // Display box in fractional coordinates of the supercell, per axis; missing axes default to [0, 1].
    box: z._default(axisRanges("box", true), {}),
  }),
  ["cartesian_limits"],
);

const displacementConfig = z.strictObject({
  enabled: z._default(z.boolean(), false),
  style: z._default(z.string(), "arrow"),
  scale: z._default(float, 1),
  // An empty string means no file.
  data_file: z._default(
    z.pipe(
      z.transform((value: unknown) => value || null),
      z.nullable(z.string()),
    ),
    null,
  ),
  // Draw arrows on hidden atoms too, e.g. O hidden behind polyhedron corners.
  include_hidden: z._default(z.boolean(), false),
  // Only the corners of these polyhedra; default: highlight.shell_of.
  shell_of: z._default(z.nullable(refOrList), null),
  inward: z._default(z.enum(["outside", "inside"]), "outside"),
});

const labelsConfig = z.strictObject({
  file: z._default(z.nullable(z.string()), null),
  labeler: z._default(z.nullable(z.string()), null),
});

const selectConfig = z.strictObject({
  labels: z._default(z.array(z.string()), []),
  indices: z._default(z.array(z.int()), []),
  shell_of: z._default(z.nullable(ref), null),
});

const highlightConfig = z.strictObject({
  shell_of: z._default(z.nullable(refOrList), null),
  ghost_opacity: z._default(unit, 0.35),
  ghost_saturation: z._default(unit, 0.3),
  ghost_value: z._default(unit, 0.95),
});

const sceneConfig = acceptAliases(
  z.strictObject({
    // The structure file, relative to the config file. A structure given to the page or the CLI overrides it.
    structure: z._default(z.nullable(z.string()), null),
    // LAMMPS type number -> species label, for LAMMPS data and dump files (structure/fastatoms.ts readStructure).
    types: z._default(lammpsTypes, {}),
    elements: z._default(z.record(z.string(), elementStyle), {}),
    materials: z._default(z.record(z.string(), materialStyle), {}),
    cell: z.prefault(cellConfig, {}),
    bonds: z._default(z.array(bondRule), []),
    polyhedra: z._default(z.array(polyhedronRule), []),
    clusters: z._default(z.array(clusterRule), []),
    displacements: z.prefault(displacementConfig, {}),
    labels: z.prefault(labelsConfig, {}),
    select: z.prefault(selectConfig, {}),
    highlight: z.prefault(highlightConfig, {}),
  }),
  ["cell"],
);

export type MaterialStyle = z.output<typeof materialStyle>;
export type ElementStyle = z.output<typeof elementStyle>;
export type BondRule = z.output<typeof bondRule>;
export type PolyhedronRule = z.output<typeof polyhedronRule>;
export type ClusterRule = z.output<typeof clusterRule>;
export type CellConfig = Omit<z.output<typeof cellConfig>, "box" | "cartesian_limits"> & {
  box: AxisRanges;
  cartesian_limits: AxisRanges | null;
};
export type DisplacementConfig = z.output<typeof displacementConfig>;
export type LabelsConfig = z.output<typeof labelsConfig>;
export type SelectConfig = z.output<typeof selectConfig>;
export type HighlightConfig = z.output<typeof highlightConfig>;
export type SceneConfig = Omit<z.output<typeof sceneConfig>, "cell" | "materials"> & {
  cell: CellConfig;
  materials: Record<string, MaterialStyle>;
};

// The default materials. The page and the compile merge these under the user's materials (a user material of the same
// name replaces the whole entry, it does not merge into it).
export const DEFAULT_MATERIALS: Readonly<Record<string, MaterialStyle>> = Object.fromEntries(
  Object.entries({
    matte: { roughness: 0.6 },
    bond: { base_color: DEFAULT_BOND_COLOUR },
    polyhedron: { base_color: DEFAULT_POLYHEDRON_COLOUR, roughness: 0.2, alpha: 1 },
    metal: { roughness: 0.15, metallic: 0.9 },
    glass: { roughness: 0.05, alpha: 0.2 },
  } as Record<string, Partial<MaterialStyle>>).map(([name, style]) => [name, z.parse(materialStyle, style)]),
);

export function defaultElementStyle(): ElementStyle {
  return z.parse(elementStyle, {});
}

export function defaultMaterialStyle(): MaterialStyle {
  return z.parse(materialStyle, {});
}

// Validates a config, then merges the default materials under the user's. The materials keep their order: the defaults,
// then the user's names in file order. Known gap: a JS object keeps integer-like keys first, and the parsed file has
// already lost the order, so a material named "1" lands before the others. Names that are not integers keep their order
// (test_ts_config pins it). An ordered JSON parser would be needed for the rest; none is built.
export function parseSceneConfig(raw: unknown): SceneConfig {
  const parsed = z.safeParse(sceneConfig, raw);
  if (!parsed.success) throw configError(parsed.error, raw);
  return {
    ...parsed.data,
    materials: { ...structuredClone(DEFAULT_MATERIALS), ...parsed.data.materials },
  };
}

// A JSON or TOML file, by its name, that holds an object, validated as a config.
export function loadSceneConfig(name: string, text: string): SceneConfig {
  const raw = readData(name, text);
  if (!isObject(raw)) {
    throw new ConfigError(`config file ${name} must contain an object (a JSON object or a TOML table).`);
  }
  return parseSceneConfig(raw);
}

// Whether a selection restricts the atoms shown: a label, an index or a shell.
export function selectIsActive(select: SelectConfig): boolean {
  return select.labels.length > 0 || select.indices.length > 0 || select.shell_of !== null;
}

// The refs a `shell_of` value names: none is no refs, a list is its items, one value is a list of one.
function asRefs(value: AtomRef | AtomRef[] | null): AtomRef[] {
  if (value === null) return [];
  return Array.isArray(value) ? [...value] : [value];
}

// The atom refs a displacement's `shell_of` names.
export function displacementRefs(displacements: DisplacementConfig): AtomRef[] {
  return asRefs(displacements.shell_of);
}

// The atom refs a highlight's `shell_of` names.
export function highlightRefs(highlight: HighlightConfig): AtomRef[] {
  return asRefs(highlight.shell_of);
}
