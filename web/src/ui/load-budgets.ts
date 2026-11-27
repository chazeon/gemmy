// The budgets of a structure load. A structure is read whole and capped at the scene cap (read.ts). A sidecar is a config,
// label or displacement file: small text, so each one is capped far lower, and the set is capped too. The atoms are
// counted after the supercell: the largest committed example expands to about 2,000 atoms (c60 at 2x2x2), so 200,000
// leaves about a hundredfold margin, and a larger cell stays out of the page, whose neighbour search runs on its main
// thread. Pure, so the node tests cover them.
import { MEGABYTE } from "../scene/read";

export const MAX_SIDECAR_BYTES = 20 * MEGABYTE;
const MAX_SIDECARS_BYTES = 50 * MEGABYTE;
export const MAX_ATOMS_IN_PAGE = 200_000;

export function expandedAtomCount(atoms: number, supercell: readonly number[]): number {
  return supercell.reduce((count, cells) => count * cells, atoms);
}

// The atom budget problem, or null when the input fits.
export function atomBudgetProblem(fileName: string, atoms: number, supercell: readonly number[]): string | null {
  const expanded = expandedAtomCount(atoms, supercell);
  if (expanded <= MAX_ATOMS_IN_PAGE) return null;
  return (
    `${fileName} has ${atoms} atoms, which its cells.supercell [${supercell.join(", ")}] makes ${expanded}; ` +
    `the page compiles at most ${MAX_ATOMS_IN_PAGE}. Use a smaller cells.supercell, or run gemmy compile.`
  );
}

// The base structure's budget, before any cell is repeated: the page refuses a structure this big whatever its supercell.
export function baseAtomBudgetProblem(fileName: string, atoms: number): string | null {
  if (atoms <= MAX_ATOMS_IN_PAGE) return null;
  return `${fileName} has ${atoms} atoms; the page compiles at most ${MAX_ATOMS_IN_PAGE}. Run gemmy compile.`;
}

// The sidecar budget problem, or null when the sidecars fit.
export function sidecarBudgetProblem(sizes: readonly number[]): string | null {
  const total = sizes.reduce((sum, size) => sum + size, 0);
  if (total <= MAX_SIDECARS_BYTES) return null;
  const totalMb = (total / MEGABYTE).toFixed(1);
  return `The dropped config and label files are ${totalMb} MB together; the page reads at most ${MAX_SIDECARS_BYTES / MEGABYTE} MB of them.`;
}
