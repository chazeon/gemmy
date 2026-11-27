// The kind of a structure, by the owner's rule: "rings for a molecule, polyhedra for a crystal", and the colour scheme Auto
// gives it: a crystal is drawn in VESTA colours, a molecule in Jmol. The kind is read from the file's periodicity (its pbc),
// so the page and the defaults agree. Pure, so the page loader can resolve the scheme without the detection modules.
import type { ColourScheme, ColourSchemeChoice } from "./colour-schemes";
import type { Structure } from "../structure/structure";

export type StructureKind = "crystal" | "molecule";

// "rings for a molecule, polyhedra for a crystal": a structure is a crystal when its file makes any axis periodic, and a
// molecule when it makes none (a POSCAR is periodic on all three axes, an extxyz with pbc "F F F" is a molecule).
export function structureKindOf(structure: Structure): StructureKind {
  return structure.pbc.some((periodic) => periodic) ? "crystal" : "molecule";
}

// The scheme Auto gives each kind of structure.
const AUTO_SCHEME: Record<StructureKind, ColourScheme> = { crystal: "vesta", molecule: "jmol" };

// The scheme a structure's atoms take under a choice: Auto resolves by the structure's kind, a scheme is that scheme for
// every structure.
export function schemeFor(structure: Structure, choice: ColourSchemeChoice): ColourScheme {
  return choice === "auto" ? AUTO_SCHEME[structureKindOf(structure)] : choice;
}
