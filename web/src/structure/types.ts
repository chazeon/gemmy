// A type map comes from the config (strict: it must name every type, and errors are the config's) or from the page
// (lenient: it may name some types, and the page asks for the rest).
//
// The LAMMPS type map. LAMMPS files give atoms a type number, not an element. A map says what each type is, as a label
// such as "Fe1"; fastatoms takes the element from the label. A type the map and the file do not resolve gets the dummy
// element "X" and the type number as its label.
export type TypeMap = Readonly<Record<number, string>>;

// A map with entries. An empty map is no map: a config without a `types` key has one.
export function hasEntries(map: TypeMap | undefined): map is TypeMap {
  return map !== undefined && Object.keys(map).length > 0;
}

// The type numbers of the atoms that stayed unresolved, sorted and without repeats. `labels` are the per-atom labels
// and `types` the per-atom type array of a LAMMPS file. fastatoms labels an unresolved atom with its type number, so an
// atom is unresolved exactly when its label is that number (a type the map names "X" is resolved, its label is "X").
export function unresolvedTypes(labels: readonly string[], types: ArrayLike<number>): number[] {
  const found = new Set<number>();
  labels.forEach((label, k) => {
    if (label === String(types[k])) found.add(types[k]);
  });
  return [...found].sort((a, b) => a - b);
}

// The entries of a map for the types a file leaves unresolved: a saved map may name types this file does not have.
export function restrictMap(map: TypeMap, unresolved: readonly number[]): TypeMap {
  const kept: Record<number, string> = {};
  for (const type of unresolved) {
    if (map[type] !== undefined) kept[type] = map[type];
  }
  return kept;
}

// The type numbers of the atoms that a map leaves out, sorted and without repeats. A config's map must name all of them
// (checkConfigTypes in fastatoms.ts); a page's map may leave some out.
export function unmappedTypes(types: ArrayLike<number>, map: TypeMap): number[] {
  const named = new Set(Object.keys(map).map(Number));
  return [...new Set(Array.from(types))].filter((type) => !named.has(type)).sort((a, b) => a - b);
}

// What a LAMMPS file says about its types, per type id: the ids the file uses (sorted, distinct), each id's mass
// (`masses`: null when the file has no Masses) and each id's label (`labels`: a null entry for a type with no name, whose
// label is its number; null overall when no type has a name). A preset of a type map is kept against this signature
// (ui/type-presets.ts), so a file with the same ids and metadata gets the map.
export interface TypeSignature {
  types: number[];
  masses: number[] | null;
  labels: (string | null)[] | null;
}

// Whether a signature says more than the ids: a file with masses or named types is informative, one with only its ids is not.
export function isInformative(signature: TypeSignature): boolean {
  return signature.masses !== null || signature.labels !== null;
}

// The signature of a file's types: `labels` and `types` are per atom (fastatoms's labels and the "type" array), and
// `masses` the per-atom "masses" array when the file has one. Each id is described by its first atom.
export function typeSignatureOf(
  labels: readonly string[],
  types: ArrayLike<number>,
  masses: ArrayLike<number> | null,
): TypeSignature {
  const firstAtom = new Map<number, number>();
  for (let k = 0; k < types.length; k++) {
    if (!firstAtom.has(types[k])) firstAtom.set(types[k], k);
  }
  const ids = [...firstAtom.keys()].sort((a, b) => a - b);
  const atomOf = (id: number) => firstAtom.get(id) ?? 0;
  const namedLabels = ids.map((id) => (labels[atomOf(id)] === String(id) ? null : labels[atomOf(id)]));
  const named = namedLabels.some((label) => label !== null);
  return {
    types: ids,
    masses: masses === null ? null : ids.map((id) => masses[atomOf(id)]),
    labels: named ? namedLabels : null,
  };
}
