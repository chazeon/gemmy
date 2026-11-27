// The selection by identity. A picked object has a key made of its points' references (a point's ref, the atom reference the
// user writes, such as "5" or "5+1_0_0"; a point with no ref keeps its id), so a scene built again from the same file finds
// the same object: the primitives' own ids are numbered in the build and change when the atoms do. Keys are made from the
// scene on show, and a key is looked up in the scene on show (ui/stage.ts keeps a file's selection this way).
import type * as THREE from "three";
import { type Target, loaded } from "../state";
import type { AtomPrimitive, BondPrimitive, PolyhedronPrimitive } from "../types";

const pointName = (id: string): string => loaded.value.points.get(id)?.ref ?? id;
const atomKey = (atom: AtomPrimitive): string => `atom ${pointName(atom.point_id)}`;
const bondKey = (bond: BondPrimitive): string => `bond ${pointName(bond.a_point_id)} ${pointName(bond.b_point_id)}`;
const polyhedronKey = (poly: PolyhedronPrimitive): string =>
  `polyhedron ${pointName(poly.center_point_id)} ${poly.name}`;

export function keyOf(target: Target): string {
  switch (target.kind) {
    case "atom":
      return atomKey(target.atom);
    case "bond":
      return bondKey(target.bond);
    case "polyhedron":
      return polyhedronKey(target.poly);
  }
}

// The target of a key in the scene on show, or null when no object has the key (it was removed). An atom or a bond is found in its
// instanced mesh (the same shape picking builds); a polyhedron is its pickable target.
export function targetOfKey(key: string): Target | null {
  const { atomGroup, bondGroup, polyTargets } = loaded.value;
  for (const mesh of atomGroup.children) {
    const atoms: AtomPrimitive[] | undefined = mesh.userData.atoms;
    const index = atoms?.findIndex((atom) => atomKey(atom) === key) ?? -1;
    if (atoms && index >= 0) return { kind: "atom", atom: atoms[index]!, mesh: mesh as THREE.InstancedMesh, index };
  }
  for (const mesh of bondGroup.children) {
    const bonds: (BondPrimitive | undefined)[] | undefined = mesh.userData.bonds;
    const index = bonds?.findIndex((bond) => bond !== undefined && bondKey(bond) === key) ?? -1;
    if (bonds && index >= 0) {
      const bond = bonds[index]!;
      const indices = bonds.flatMap((b, i) => (b === bond ? [i] : [])); // every instance of the bond (a dashed bond's dashes)
      return { kind: "bond", bond, mesh: mesh as THREE.InstancedMesh, indices };
    }
  }
  return polyTargets.find((target) => polyhedronKey(target.poly) === key) ?? null;
}
