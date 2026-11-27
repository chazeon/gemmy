"""The style sections' descriptions (web/src/react/style-panel/pane-model.ts) in node: the nodes a section draws for the
rocksalt config, the commit of a control (the edited config it makes), the structure key that tells a rebuild from a
value refresh, and the names a text control reads. The adapter that draws the nodes (tweakpane-adapter.ts) needs a DOM,
so the browser test covers it. The module runs in node, bundled by tests/viewer_bundle.py."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pytest

from viewer_bundle import available, node_json

ROCKSALT = Path(__file__).resolve().parent / "fixtures" / "rocksalt"

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")


def _rocksalt() -> dict[str, Any]:
    return json.loads((ROCKSALT / "config.json").read_text(encoding="utf-8"))


def test_rocksalt_atoms_are_one_folder_per_name_with_show_colour_and_radius() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
const colours = { scheme: "vesta", automatic: new Set(), change: () => config };
const nodes = atomsNodes(config, ["Mg", "O"], () => {}, colours);
result = {
  scheme: { kind: nodes[0].kind, label: nodes[0].label, value: nodes[0].value, options: nodes[0].options },
  folders: nodes.slice(1).map((folder) => ({
    title: folder.title,
    children: folder.children.map((control) => [control.kind, control.label, control.value]),
  })),
};
""",
        _rocksalt(),
    )
    assert result["scheme"] == {
        "kind": "list",
        "label": "Colour scheme",
        "value": "vesta",
        "options": [
            {"text": "Auto", "value": "auto"},
            {"text": "VESTA", "value": "vesta"},
            {"text": "Jmol", "value": "jmol"},
            {"text": "Modern", "value": "modern"},
            {"text": "Tailwind", "value": "tailwind"},
            {"text": "Print", "value": "print"},
            {"text": "Night", "value": "dark"},
            {"text": "Pastel", "value": "pastel"},
            {"text": "Watercolour", "value": "watercolour"},
            {"text": "Mid-century", "value": "midcentury"},
            {"text": "Open Color", "value": "opencolor"},
            {"text": "Colour-blind safe", "value": "cvd"},
            {"text": "Nippon", "value": "nippon"},
            {"text": "Zhongguo", "value": "zhongguo"},
            {"text": "Hokusai", "value": "hokusai"},
            {"text": "Klimt", "value": "klimt"},
            {"text": "Van Gogh", "value": "vangogh"},
            {"text": "Renoir", "value": "renoir"},
        ],
    }
    folders = result["folders"]
    assert [folder["title"] for folder in folders] == ["Mg", "O"]
    mg = folders[0]["children"]
    # The eye on the folder title is the show control: the folder holds the colour and the radius.
    assert [kind for kind, _, _ in mg] == ["color", "number"]
    assert [label for _, label, _ in mg] == ["Colour", "Radius"]
    assert mg[0][2] == {"r": 0.2, "g": 0.7, "b": 0.3, "a": 1}
    assert mg[1][2] == pytest.approx(0.4)


def test_a_control_commits_the_edited_config() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
const edits = [];
const colours = { scheme: "vesta", automatic: new Set(), change: () => config };
const nodes = atomsNodes(config, ["Mg", "O"], (edit) => edits.push(edit()), colours);
const [colour, radius] = nodes[2].children;
nodes[2].visible.commit(false);
radius.commit(0.5);
colour.commit({ r: 0, g: 0, b: 1, a: 1 });
result = {
  hidden: edits[0].elements.O.visible,
  radius: edits[1].elements.O.radius,
  colour: edits[2].elements.O.color,
  untouched: edits[2].elements.Mg.radius,
};
""",
        _rocksalt(),
    )
    assert result["hidden"] is False
    assert result["radius"] == pytest.approx(0.5)
    assert result["colour"] == [0, 0, 1, 1]
    assert result["untouched"] == pytest.approx(0.4)


def test_a_bond_folder_titles_its_pair_and_its_window_is_a_domain_from_zero() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
const distances = new Map([[elementPairKey("O", "Mg"), [1.9, 2.1, 2.2]]]);
const [, bond] = bondsNodes({ config, names: ["Mg", "O"], distances, apply: () => {}, draft: null, onDraft: () => {},
  automatic: new Set(), detection: { tolerance: 0.15, metalPairs: false }, onDetection: () => {}, detect: () => [],
});
const window = bond.children.find((control) => control.kind === "interval");
result = { title: bond.title, min: window.min, max: window.max, step: window.step, value: window.value };
""",
        _rocksalt(),
    )
    assert result["title"] == "Mg–O"
    assert result["min"] == 0
    assert result["max"] == pytest.approx(2.45)
    assert result["step"] == pytest.approx(0.01)
    assert result["value"] == [1.8, 2.4]


def test_the_key_keeps_its_shape_when_only_values_change_and_moves_when_a_rule_is_added() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
const distances = new Map([[elementPairKey("Mg", "O"), [2.1]], [elementPairKey("O", "O"), [2.9]]]);
const nodesFor = (cfg, draft = null) =>
  bondsNodes({ config: cfg, names: ["Mg", "O"], distances, apply: () => {}, draft, onDraft: () => {},
  automatic: new Set(), detection: { tolerance: 0.15, metalPairs: false }, onDetection: () => {}, detect: () => [],
});
const before = structureKey(nodesFor(config));
const thinner = { ...args[0], bonds: [{ ...args[0].bonds[0], radius: 0.2 }] };
const recoloured = structureKey(nodesFor(parseSceneConfig(thinner)));
const withDraft = structureKey(nodesFor(config, ["Mg", "O"]));
result = { same: before === recoloured, draft: before === withDraft };
""",
        _rocksalt(),
    )
    assert result == {"same": True, "draft": False}


def test_a_colour_is_hex_with_eight_digits_when_its_row_takes_alpha() -> None:
    result = node_json(
        """
let result;
const half = { r: 0.5, g: 0.5, b: 1, a: 0.5 };
const solid = { r: 0.5, g: 0.5, b: 1, a: 1 };
result = {
  solidWithAlpha: toHex(solid, true),
  solidNoAlpha: toHex(solid, false),
  translucentWithAlpha: toHex(half, true),
  translucentNoAlpha: toHex(half, false),
  sixDigitKeepsAlpha: fromHex("#8080ff", half),
  eightDigitSameAlpha: fromHex("#8080ff80", half),
  eightDigitNewAlpha: fromHex("#8080ff40", half),
  notHex: fromHex("red", half),
};
""",
    )
    assert result["solidWithAlpha"] == "#8080ffff"
    assert result["solidNoAlpha"] == "#8080ff"
    assert result["translucentWithAlpha"] == "#8080ff80"
    assert result["translucentNoAlpha"] == "#8080ff"
    assert result["sixDigitKeepsAlpha"] == {"r": 128 / 255, "g": 128 / 255, "b": 1, "a": 0.5}
    assert result["eightDigitSameAlpha"] == {"r": 128 / 255, "g": 128 / 255, "b": 1, "a": 0.5}
    assert result["eightDigitNewAlpha"]["a"] == pytest.approx(64 / 255)
    assert result["notHex"] is None


def test_a_colour_row_takes_alpha_while_it_is_solid() -> None:
    # The flag is the colour's kind, not its value: a solid polyhedron offers alpha, and so do the atoms, whose config
    # colour takes alpha too (ElementStyle, like every colour field of the config).
    result = node_json(
        """
let result;
// The rocksalt polyhedron is see-through (alpha 0.2): made solid here, the row must still take alpha.
const solid = structuredClone(args[0]);
solid.polyhedra[0].color = [0.2, 0.6, 1.0, 1.0];
const config = parseSceneConfig(solid);
const shapes = shapesNodes({
  config, names: ["Mg", "O"], distances: new Map(), apply: () => {},
  draft: null, onDraft: () => {}, automatic: new Set(), detect: () => [],
});
const colourOf = (folder) => folder.children.find((control) => control.kind === "color");
// The polyhedron folder is the one with the Image centres control (only polyhedra have it).
const polyhedron = shapes.find((node) => node.children?.some((control) => control.label === "Image centres"));
const colours = { scheme: "vesta", automatic: new Set(), change: () => config };
const atoms = atomsNodes(config, ["Mg", "O"], () => {}, colours);
result = {
  polyhedronValue: colourOf(polyhedron).value,
  polyhedronTitle: polyhedron.title,
  polyhedronAlpha: colourOf(polyhedron).alpha,
  atomAlpha: colourOf(atoms[1]).alpha,
  polyhedronHex: toHex(colourOf(polyhedron).value, colourOf(polyhedron).alpha),
};
""",
        _rocksalt(),
    )
    assert result["polyhedronTitle"] == "Mg (O)"
    assert result["polyhedronValue"]["a"] == 1
    assert result["polyhedronAlpha"] is True
    assert result["atomAlpha"] is True
    assert len(result["polyhedronHex"]) == len("#rrggbbaa")


def test_flatten_walks_a_folder_before_its_children() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
const colours = { scheme: "vesta", automatic: new Set(), change: () => config };
const flat = flattenPane(atomsNodes(config, ["Mg"], () => {}, colours));
result = flat.map((node) => node.label ?? node.title);
""",
        _rocksalt(),
    )
    assert result == ["Colour scheme", "Mg", "Colour", "Radius"]


def test_a_name_the_structure_lacks_is_refused_with_its_name() -> None:
    result = node_json(
        """
let result;
let message = null;
try {
  namesFromText("O, Fe", ["Mg", "O"]);
} catch (error) {
  message = error.message;
}
result = { picked: namesFromText(" O ,, Mg ", ["Mg", "O"]), message };
""",
    )
    assert result == {"picked": ["O", "Mg"], "message": '"Fe" is not an atom of this structure.'}


def test_the_cell_folders_commit_a_supercell_count_and_clear_a_box_only_when_boxed() -> None:
    # The Cell section's folders (pane-model.ts, cellNodes): the count is a three-number row, and Reset box only edits a
    # boxed cell.
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
const edits = [];
const nodes = cellNodes(config, (edit) => edits.push(edit()));
nodes[0].children[0].commit([2, 1, 1]);
nodes[2].children[2].commit();
result = {
  titles: nodes.map((node) => node.title),
  summaries: nodes.map((node) => node.summary),
  supercell: edits[0].cell.supercell,
  edits: edits.length,
};
""",
        _rocksalt(),
    )
    assert result["titles"] == ["Supercell", "Periodic", "Display box"]
    assert result["summaries"][1] == "a b c"
    assert result["supercell"][0] == 2
    assert result["edits"] == 1  # the count; the reset of an unboxed cell is no edit


def test_a_polyhedron_folder_has_image_centres_and_show_centre_atom() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
const edits = [];
const shapes = shapesNodes({
  config, names: ["Mg", "O"], distances: new Map(), apply: (edit) => edits.push(edit()),
  draft: null, onDraft: () => {}, automatic: new Set(), detect: () => [],
});
const [, polyhedron] = shapes;
const labels = polyhedron.children.map((control) => control.label);
const imageCentres = polyhedron.children.find((control) => control.label === "Image centres");
const centreAtom = polyhedron.children.find((control) => control.label === "Show centre atom");
imageCentres.commit(true);
centreAtom.commit(false);
result = {
  labels,
  imageCentresValue: imageCentres.value,
  centreAtomValue: centreAtom.value,
  imageCentres: edits[0].polyhedra[0].image_centers,
  centreHidden: edits[1].elements[polyhedron.title.split(" ")[0]].visible,
  centreName: polyhedron.title,
};
""",
        _rocksalt(),
    )
    assert "Image centres" in result["labels"]
    assert "Show centre atom" in result["labels"]
    assert result["imageCentres"] is True
    assert result["centreHidden"] is False
    assert result["centreAtomValue"] is True


def test_the_add_polyhedron_flow_hides_the_bonds_it_replaces() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
const edits = [];
const draft = { kind: "polyhedron", centre: "O", ligands: "Mg", clusterKind: "molecule", atoms: "" };
const [, addFolder] = shapesNodes({
  config, names: ["Mg", "O"], distances: new Map([[elementPairKey("O", "Mg"), [2.1]]]),
  apply: (edit) => edits.push(edit()), draft, onDraft: () => {}, automatic: new Set(), detect: () => [],
});
const [add] = addFolder.children.slice(-1);
add.commit();
const edited = edits[0];
result = {
  polyhedra: edited.polyhedra.length,
  added: edited.polyhedra[edited.polyhedra.length - 1].image_centers,
  bondsHidden: edited.bonds.map((rule) => rule.visible),
};
""",
        _rocksalt(),
    )
    assert result["polyhedra"] == 2
    assert result["added"] is True
    assert result["bondsHidden"] == [False] * len(result["bondsHidden"])


def test_the_detect_group_leads_the_bonds_and_its_actions_are_labelled() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
const nodes = bondsNodes({
  config, names: ["Mg", "O"], distances: new Map(), apply: () => {}, draft: null, onDraft: () => {},
  automatic: new Set(), detection: { tolerance: 0.15, metalPairs: false }, onDetection: () => {}, detect: () => [],
});
result = { title: nodes[0].title, labels: nodes[0].children.map((control) => control.label ?? control.title) };
""",
        _rocksalt(),
    )
    assert result["title"] == "Detect from radii"
    assert result["labels"] == ["Tolerance", "Metal pairs", "Re-detect", "Clear automatic"]


def test_an_automatic_rule_is_tagged_and_its_first_edit_ends_the_tag() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
const identity = pairOf({ a: "Mg", b: "O" });  // the automatic set holds element pairs
const automatic = new Set([identity]);
const edits = [];
const [, bond] = bondsNodes({
  config, names: ["Mg", "O"], distances: new Map(), apply: (edit) => edits.push(edit()), draft: null, onDraft: () => {},
  automatic, detection: { tolerance: 0.15, metalPairs: false }, onDetection: () => {}, detect: () => [],
});
const tagged = bond.origin;
bond.visible.commit(false);
result = { tagged, stillAutomatic: automatic.has(identity), hidden: edits[0].bonds[0].visible };
""",
        _rocksalt(),
    )
    assert result["tagged"] == "automatic"
    assert result["stillAutomatic"] is False
    assert result["hidden"] is False


def test_re_detect_replaces_the_automatic_rules_and_marks_the_detected_ones() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
const identity = pairOf({ a: "Mg", b: "O" });  // the automatic set holds element pairs
const automatic = new Set([identity]);
const detected = parseSceneConfig({ bonds: [{ a: "O", b: "O", min: 2.5, max: 3.0 }] }).bonds;
const edits = [];
const nodes = bondsNodes({
  config, names: ["Mg", "O"], distances: new Map(), apply: (edit) => edits.push(edit()), draft: null, onDraft: () => {},
  automatic, detection: { tolerance: 0.15, metalPairs: false }, onDetection: () => {}, detect: () => detected,
});
nodes[0].children.find((control) => control.title === "Re-detect").commit();
result = {
  bonds: edits[0].bonds.map((rule) => [rule.a, rule.b]),
  marked: [...automatic],
};
""",
        _rocksalt(),
    )
    assert result["bonds"] == [["O", "O"]]  # the Mg-O automatic rule is replaced; nothing else was in the config
    assert result["marked"] == ['["O","O"]']


# The Re-detect and Clear buttons call the same commit functions the page does; each press here builds the section again
# from the config the last press made, as the page does.
PRESS_HELPERS = """
const press = (current, automatic, detected, detection, title) => {
  let next = null;
  const nodes = bondsNodes({
    config: current, names: ["Mg", "O"], distances: new Map(), apply: (edit) => { next = edit(); }, draft: null,
    onDraft: () => {}, automatic, detection, onDetection: () => {}, detect: () => detected,
  });
  nodes[0].children.find((control) => control.title === title).commit();
  return next;
};
const detectOf = (min, max) => parseSceneConfig({ bonds: [{ a: "Mg", b: "O", min, max }] }).bonds;
"""


def test_re_detect_twice_gives_equal_configs_and_the_same_owned_pairs() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
"""
        + PRESS_HELPERS
        + """
const automatic = new Set([pairOf({ a: "Mg", b: "O" })]);
const detected = detectOf(1.8, 2.4);
const once = press(config, automatic, detected, { tolerance: 0.15, metalPairs: false }, "Re-detect");
const twice = press(once, automatic, detected, { tolerance: 0.15, metalPairs: false }, "Re-detect");
result = { equal: JSON.stringify(once) === JSON.stringify(twice), owned: [...automatic] };
""",
        _rocksalt(),
    )
    assert result == {"equal": True, "owned": ['["Mg","O"]']}


def test_re_detect_after_a_tolerance_change_replaces_the_window_in_place() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
"""
        + PRESS_HELPERS
        + """
const automatic = new Set([pairOf({ a: "Mg", b: "O" })]);
const wider = press(config, automatic, detectOf(1.8, 2.7), { tolerance: 0.3, metalPairs: false }, "Re-detect");
result = { count: wider.bonds.length, max: wider.bonds[0].max_distance };
""",
        _rocksalt(),
    )
    assert result == {"count": 1, "max": pytest.approx(2.7)}


def test_a_user_edited_pair_is_not_detected_again() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
"""
        + PRESS_HELPERS
        + """
const automatic = new Set([pairOf({ a: "Mg", b: "O" })]);
let edited = null;
const bond = bondsNodes({
  config, names: ["Mg", "O"], distances: new Map(), apply: (edit) => { edited = edit(); }, draft: null,
  onDraft: () => {}, automatic, detection: { tolerance: 0.15, metalPairs: false }, onDetection: () => {},
  detect: () => [],
})[1];
(bond.visible ?? bond.children.find((control) => control.label === "Show")).commit(false);
const again = press(edited, automatic, detectOf(1.8, 2.4), { tolerance: 0.15, metalPairs: false }, "Re-detect");
result = { count: again.bonds.length, hidden: again.bonds[0].visible === false, owned: [...automatic] };
""",
        _rocksalt(),
    )
    assert result == {"count": 1, "hidden": True, "owned": []}


def test_clear_then_re_detect_restores_the_same_pairs() -> None:
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
"""
        + PRESS_HELPERS
        + """
const automatic = new Set([pairOf({ a: "Mg", b: "O" })]);
const detected = detectOf(1.8, 2.4);
const cleared = press(config, automatic, detected, { tolerance: 0.15, metalPairs: false }, "Clear automatic");
const cleared_owned = [...automatic];
const restored = press(cleared, automatic, detected, { tolerance: 0.15, metalPairs: false }, "Re-detect");
result = {
  cleared: cleared.bonds.length,
  clearedOwned: cleared_owned,
  pairs: restored.bonds.map((r) => [r.a, r.b]),
  owned: [...automatic],
};
""",
        _rocksalt(),
    )
    assert result == {"cleared": 0, "clearedOwned": [], "pairs": [["Mg", "O"]], "owned": ['["Mg","O"]']}


def test_a_pick_names_the_style_it_uses_an_atom_a_bond_a_polyhedron_or_none() -> None:
    # style-target.ts: the folder a click shows for each kind of object: the Atoms folder of its label; the Bonds
    # folder of the first rule of its label pair whose window covers its length; the Shapes folder of its centre's rule.
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
const rule = config.bonds[0];
const middle = (rule.min_distance + rule.max_distance) / 2;
const pair = [{ label: rule.a, ref: null }, { label: rule.b, ref: null }];
result = {
  atom: styleTargetOf(
    { kind: "atom", label: "Mg", ref: null, fractional: null, cartesian: "0", host: null, neighbours: null },
    config,
  ),
  bond: styleTargetOf({ kind: "bond", name: "bond", length: String(middle), ends: pair }, config),
  outside: styleTargetOf(
    { kind: "bond", name: "bond", length: String(rule.max_distance + 1), ends: pair },
    config,
  ),
  none: styleTargetOf({ kind: "none" }, config),
};
""",
        _rocksalt(),
    )
    assert result["atom"] == {"section": "atoms", "key": "Mg"}
    assert result["bond"]["section"] == "bonds"
    assert result["outside"] is None
    assert result["none"] is None


def test_a_pick_of_a_c_dna_atom_reveals_the_c_dna_folder_and_the_rules_that_name_it() -> None:
    # The species label is the identity: a C_dna atom is styled by the C_dna folder, its bond by the C_dna–O rule, and
    # its polyhedron by the rule centred on C_dna. A rule centred on the element C does not match the label C_dna.
    result = node_json(
        """
let result;
const config = parseSceneConfig(args[0]);
const bond = { ...config.bonds[0], a: "C_dna", b: "O" };
const middle = (bond.min_distance + bond.max_distance) / 2;
const polyhedron = { ...config.polyhedra[0], center: "C_dna" };
const withBond = { ...config, bonds: [bond], polyhedra: [polyhedron] };
const ends = [{ label: "C_dna", ref: "1" }, { label: "O", ref: "2" }];
const onElement = { ...withBond, polyhedra: [{ ...polyhedron, center: "C" }] };
const centre = "C_dna at (0.0, 0.0, 0.0)";
const polyhedronPick = { kind: "polyhedron", name: "C6", centre, bonds: "", mean: "", delta: "" };
result = {
  atom: styleTargetOf(
    { kind: "atom", label: "C_dna", ref: "1", fractional: null, cartesian: "0", host: null, neighbours: null },
    withBond,
  ),
  bond: styleTargetOf({ kind: "bond", name: "C_dna–O bond", length: String(middle), ends }, withBond),
  polyhedron: styleTargetOf(polyhedronPick, withBond),
  polyhedronOnElement: styleTargetOf(polyhedronPick, onElement),
  bondOnElement: styleTargetOf(
    { kind: "bond", name: "C–O bond", length: String(middle), ends: [{ label: "C", ref: null }, ends[1]] },
    withBond,
  ),
};
""",
        _rocksalt(),
    )
    assert result["atom"] == {"section": "atoms", "key": "C_dna"}
    assert result["bond"] == {"section": "bonds", "key": "C_dna–O"}
    assert result["polyhedron"]["section"] == "shapes"
    assert result["polyhedronOnElement"] is None
    assert result["bondOnElement"] is None


def test_a_write_is_not_a_commit_and_a_same_value_is_not_an_edit() -> None:
    # tweakpane-commit.ts: the adapter's own writes (and its refresh) run inside WriteGate.run, so the changes Tweakpane
    # reports from them are not commits; the gate opens again after a write that throws. sameValue compares committed
    # values by their entries, so a commit that sets a node's own value is skipped.
    result = node_json(
        """
let result;
const gate = new WriteGate();
const seen = [];
gate.run(() => seen.push(gate.accepts()));
seen.push(gate.accepts());
try {
  gate.run(() => {
    throw new Error("a failed write");
  });
} catch {}
seen.push(gate.accepts());
result = {
  during: seen[0],
  after: seen[1],
  afterThrow: seen[2],
  sameRgba: sameValue({ r: 1, g: 0, b: 0.5, a: 1 }, { r: 1, g: 0, b: 0.5, a: 1 }),
  differentRgba: sameValue({ r: 1, g: 0, b: 0.5, a: 1 }, { r: 1, g: 0, b: 0.5, a: 0.5 }),
  sameWindow: sameValue([0.5, 2], [0.5, 2]),
  differentWindow: sameValue([0.5, 2], [0.5, 2.5]),
  arrayAndObject: sameValue([], {}),
  primitives: [sameValue(3, 3), sameValue(3, "3"), sameValue(false, 0)],
};
""",
    )
    assert result["during"] is False
    assert result["after"] is True
    assert result["afterThrow"] is True
    assert result["sameRgba"] is True
    assert result["differentRgba"] is False
    assert result["sameWindow"] is True
    assert result["differentWindow"] is False
    assert result["arrayAndObject"] is False
    assert result["primitives"] == [True, False, False]


def test_a_new_pick_of_the_same_shape_retitles_the_selection_folder() -> None:
    # The structure key keeps a folder's title: an Si atom picked after an O atom has the same rows, and only a rebuild
    # shows the new heading, where a value-only refresh would keep "O atom".
    result = node_json(
        """
let result;
const actions = { centre() {}, along() {}, copy() {} };
const atom = (label) => ({
  kind: "atom", label, ref: "1", fractional: "0, 0, 0", cartesian: "1, 2, 3", host: null, neighbours: null,
});
const oxygen = selectionNodes(atom("O"), actions);
const silicon = selectionNodes(atom("Si"), actions);
result = {
  titles: [oxygen[0].title, silicon[0].title],
  sameShape: structureKey(oxygen) === structureKey(silicon),
};
""",
        _rocksalt(),
    )
    assert result == {"titles": ["O atom", "Si atom"], "sameShape": False}
