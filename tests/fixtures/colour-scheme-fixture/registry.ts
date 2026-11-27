// The registry with one theme beyond the shipped ones, for tests/test_ts_colour_schemes.py: the shipped VESTA and Jmol
// files, then the fixture theme, listed the way web/src/compile/schemes/registry.ts lists them. The test bundle uses it
// in place of the shipped registry (tests/ts_bundle.py, `registry`).
import type { SchemeFile } from "../../../web/src/compile/schemes/registry";
import fixture from "./fixture-theme.json";
import jmol from "../../../web/src/compile/schemes/jmol.json";
import vesta from "../../../web/src/compile/schemes/vesta.json";

export const SCHEMES: readonly SchemeFile[] = [vesta, jmol, fixture];
