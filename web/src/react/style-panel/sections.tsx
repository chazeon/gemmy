// The inspector's Atoms, Bonds and Shapes sections. Each draws its own DockSection frame (the header, its count and its +
// button) over a Tweakpane pane built from the config (pane-model.ts). The + button opens the Add row, whose picks are the
// section's state; everything else is the config. A section that throws shows its own message (the dock's boundary).
import { useState } from "react";
import { DEFAULT_DETECTION, type DetectionOptions, defaultBondRules } from "../../compile/default-rules";
import { elementTableOf } from "../../compile/colour-schemes";
import { detectShapes } from "../../compile/default-kind";
import { labelsOf } from "../../compile/default-rules";
import { schemeFor } from "../../compile/structure-kind";
import { colourScheme } from "../../ui/colour-scheme";
import { switchColourScheme } from "../../ui/colour-switch";
import {
  activeModel,
  automaticBondsOf,
  automaticColoursOf,
  automaticPolyhedraOf,
  automaticRingsOf,
  detectedValuesOf,
} from "../../ui/structure-model";
import { DockSection } from "../inspector/dock-section";
import { useSignal } from "../use-signal";
import { type AtomColours, atomsNodes } from "./atoms-nodes";
import { type BondDraft, bondsNodes, newBondDraft } from "./bonds-nodes";
import { type ShapeDraft, newShapeDraft, shapesNodes } from "./shapes-nodes";
import type { SectionProps } from "./props";
import { StylePane, useEdits } from "./pane";
import { DOCK_NOTE } from "../inspector/contract";

export function AtomsSection(props: SectionProps) {
  const apply = useEdits(props);
  // The scheme list and the elements' colours: the page keeps which elements hold their scheme colour, per model.
  const scheme = useSignal(colourScheme);
  const model = activeModel.value;
  // The scheme's style of each label's element: the defaults its colour and radius reset to.
  const elementOf = new Map(
    model === null ? [] : labelsOf(model.structure).map((entry) => [entry.label, entry.element]),
  );
  const table = model === null ? null : elementTableOf(schemeFor(model.structure, scheme));
  const colours: AtomColours = {
    scheme,
    automatic: automaticColoursOf(model),
    change: (next) => switchColourScheme(model, props.config, next),
    defaultOf: (name) => {
      const element = elementOf.get(name);
      return element !== undefined && table !== null && Object.hasOwn(table, element) ? table[element] : null;
    },
  };
  return (
    <DockSection id="atoms" title="Atoms" count={props.names.length}>
      {props.names.length === 0 ? (
        <p className={DOCK_NOTE}>No atoms in this structure.</p>
      ) : (
        <StylePane section="atoms" nodes={atomsNodes(props.config, props.names, apply, colours)} />
      )}
    </DockSection>
  );
}

export function BondsSection(props: SectionProps) {
  const apply = useEdits(props);
  const [draft, setDraft] = useState<BondDraft | null>(null);
  const [detection, setDetection] = useState<DetectionOptions>(DEFAULT_DETECTION);
  const { config, names, distances, partial } = props;
  // The shown structure: detection reads its structure and cell, and the page keeps which rules it made.
  const model = activeModel.value;
  const automatic = automaticBondsOf(model);
  const detect = (options: DetectionOptions) =>
    model === null ? [] : defaultBondRules(model.structure, model.neighbors, options);
  // A shut section opens with its add row shown (the row is drawn only while the section is open); an open one toggles it.
  const toggleAdd = (sectionShut: boolean) =>
    setDraft((draft) => (sectionShut || draft === null ? newBondDraft(distances, names) : null));
  return (
    <DockSection
      id="bonds"
      title="Bonds"
      count={config.bonds.length}
      add={names.length === 0 ? undefined : { label: "Add a bond", onAdd: toggleAdd }}
    >
      {partial && <p className={DOCK_NOTE}>Distances sampled (structure too dense)</p>}
      {config.bonds.length === 0 && draft === null && <p className={DOCK_NOTE}>No bond rules yet.</p>}
      <StylePane
        section="bonds"
        nodes={bondsNodes({
          config,
          names,
          distances,
          apply,
          draft,
          onDraft: setDraft,
          automatic,
          detected: detectedValuesOf(model),
          detection,
          onDetection: setDetection,
          detect,
        })}
      />
    </DockSection>
  );
}

export function ShapesSection(props: SectionProps) {
  const apply = useEdits(props);
  const [draft, setDraft] = useState<ShapeDraft | null>(null);
  const { config, names, distances } = props;
  const count = config.polyhedra.length + config.clusters.length;
  const toggleAdd = (sectionShut: boolean) =>
    setDraft((draft) => (sectionShut || draft === null ? newShapeDraft(distances, names) : null));
  // The shown structure: detection reads its structure and cell, and the page keeps which polyhedra and rings it made.
  const model = activeModel.value;
  const automatic = automaticPolyhedraOf(model);
  const automaticRings = automaticRingsOf(model);
  const detect = () =>
    model === null
      ? { polyhedra: [], rings: [], emitted: [] }
      : detectShapes(model.structure, model.neighbors, config, schemeFor(model.structure, colourScheme.peek()));
  return (
    <DockSection
      id="shapes"
      title="Shapes"
      count={count}
      add={names.length === 0 ? undefined : { label: "Add a shape", onAdd: toggleAdd }}
    >
      {count === 0 && draft === null && <p className={DOCK_NOTE}>No polyhedra or clusters yet.</p>}
      <StylePane
        section="shapes"
        nodes={shapesNodes({
          config,
          names,
          distances,
          apply,
          draft,
          onDraft: setDraft,
          automatic,
          automaticRings,
          detected: detectedValuesOf(model),
          detect,
        })}
      />
    </DockSection>
  );
}
