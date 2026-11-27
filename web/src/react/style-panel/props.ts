// What every section of the style panel takes: the config it shows, the names and distances it offers, and the two
// callbacks an edit reports to. The panel keeps no state of its own (docs/plans/stage6-panel.md, section 3).
import type { SceneConfig } from "../../compile/config";
import type { PairDistances } from "../../ui/style-panel-model";

export interface SectionProps {
  config: SceneConfig;
  // presentNames(structure): the labels and elements a rule can name.
  names: string[];
  // pairDistances(...): the sorted distances of each element pair, keyed by elementPairKey (A <= B).
  distances: PairDistances;
  // True when the distances are sampled: the structure is too dense to read them all (ui/structure-config.ts partial).
  partial: boolean;
  onChange(next: SceneConfig): void;
  onError(message: string): void;
}
