// A structure tab's config, as the style panel edits it (react/style-panel). The shown model's config is a signal: a change
// to it compiles the scene again, and the stage shows the new scene with the camera where it was. What the panel offers
// (the names a rule can use, the distances of each element pair) is read once per model and kept with it.
import { effect, signal } from "@preact/signals-core";
import { pairDistances, presentNames } from "../compile/pair-distances";
import { errorText } from "../errors";
import type { Scene } from "../types";
import { updateScene } from "./stage";
import type { PairDistances } from "./style-panel-model";
import { atomBudgetProblem } from "./load-budgets";
import { activeModel, type StructureModel } from "./structure-model";
import { note } from "./message";

// The pair distances the panel reads reach this far (Å): past the longest distance a bond or polyhedron window offers.
export const PANEL_DISTANCE_CUTOFF = 4;
// The distances are read in one cell: the distinct distances of a pair are the same in any supercell.
const UNIT_CELL = [1, 1, 1] as const;

export interface PanelFacts {
  names: string[];
  distances: PairDistances;
  // True when the distances are partial: a cell too dense to read out to the panel's cutoff (compile/pair-distances.ts).
  partial: boolean;
}

const factsOf = new WeakMap<StructureModel, PanelFacts>();

// What the panel offers a model: one neighbour query over the unit cell, read the first time and kept with the model.
export function panelFacts(model: StructureModel): PanelFacts {
  const known = factsOf.get(model);
  if (known !== undefined) return known;
  const unitCell = model.compiler.neighborSource(model.structure, UNIT_CELL, model.config.peek().cell.periodic);
  const read = pairDistances(unitCell, PANEL_DISTANCE_CUTOFF);
  const facts = { names: presentNames(model.structure), distances: read.distances, partial: read.partial };
  factsOf.set(model, facts);
  return facts;
}

// True while a changed config is waiting for its compile or the compile runs: the panel and the stage show it as busy. A
// large cell can make the compile take a while, so this is the signal that says the page has not frozen.
export const compiling = signal(false);

// The watch of the shown model. Ending it (another tab is shown) stops its recompiles.
let stopWatching: () => void = () => undefined;

// Shows a structure tab's model: its config is the panel's, and a change to it recompiles the scene. `setDoc` is given
// every scene the config compiles to, so the tab shows its current scene when it is shown again.
export function showModel(model: StructureModel, setDoc: (doc: Scene) => void): void {
  stopWatching();
  stopWatching = watchConfig(model, setDoc);
  activeModel.value = model;
}

// Shows a tab with no structure (a scene, or the start screen): the panel is shut and has no model.
export function hideModel(): void {
  stopWatching();
  stopWatching = () => undefined;
  activeModel.value = null;
}

// Watches one model's config. A change is compiled in a task of its own, so a run of changes (a slider's keys, say) that
// lands before that task compiles the latest config once. A compile is synchronous, so no change arrives during one.
function watchConfig(model: StructureModel, setDoc: (doc: Scene) => void): () => void {
  // The config the scene and the neighbour source were last built from.
  let compiled = model.config.peek();
  let builtCell = cellOf(compiled);
  let scheduled: ReturnType<typeof setTimeout> | undefined;

  // Compiles the config on the model. Returns the scene, or null when the config is the compiled one or the compile
  // failed. A failed compile changes nothing: the config goes back to the one that compiled, and the neighbour source,
  // the cell it was built for and the scene stay as they were. The new source is only published with the config and
  // the scene it was compiled for.
  const compileLatest = (): Scene | null => {
    const config = model.config.peek();
    if (config === compiled) return null;
    try {
      const problem = atomBudgetProblem(model.fileName, model.structure.atoms.length, config.cell.supercell);
      if (problem !== null) throw new Error(problem);
      const neighbors =
        cellOf(config) === builtCell
          ? model.neighbors
          : model.compiler.neighborSource(model.structure, config.cell.supercell, config.cell.periodic);
      const warnings: string[] = [];
      const doc = model.compiler.compileScene(model.structure, neighbors, config, model.files, warnings);
      model.neighbors = neighbors;
      builtCell = cellOf(config);
      compiled = config;
      setDoc(doc);
      if (warnings.length > 0) note(warnings.join(" "), { kind: "warning" });
      return doc;
    } catch (error) {
      model.config.value = compiled;
      note(`The change was not applied: ${errorText(error)}`, { kind: "error" });
      return null;
    }
  };

  const stopEffect = effect(() => {
    if (model.config.value === compiled) return;
    compiling.value = true;
    scheduled ??= setTimeout(() => {
      scheduled = undefined;
      try {
        const doc = compileLatest();
        if (doc !== null) updateScene(doc);
      } finally {
        compiling.value = false;
      }
    }, 0);
  });

  return () => {
    stopEffect();
    if (scheduled === undefined) return;
    // The tab is left with a change not yet compiled: the tab keeps the scene of its config, but the stage is not touched.
    clearTimeout(scheduled);
    scheduled = undefined;
    try {
      compileLatest();
    } finally {
      compiling.value = false;
    }
  };
}

// The cell a config's neighbour source is built from: the supercell and the periodic flags. The source is rebuilt only
// when this changes.
function cellOf(config: { cell: { supercell: readonly number[]; periodic: readonly boolean[] } }): string {
  return JSON.stringify([config.cell.supercell, config.cell.periodic]);
}
