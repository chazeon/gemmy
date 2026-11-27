"""The selection readout (web/src/ui/readout.ts) on a small scene: a benzene ring of six C_dna atoms, a cluster whose
centre is a computed centroid (ring6), a He-centred polyhedron over the same six atoms (He6), and a C_dna–O bond. The
readout names each object by its species label, never by its element. The readout of the ring counts its six real
members and no zero-length bond to the centroid; a ring atom's host is He, never the cluster's centroid. The module runs
in node, bundled by tests/viewer_bundle.py."""

from __future__ import annotations

import json
import math
import subprocess
from pathlib import Path
from typing import Any

import pytest

from viewer_bundle import available, header

pytestmark = pytest.mark.skipif(not available(), reason="node or web/node_modules is missing (cd web && npm ci)")
RING_RADIUS = 1.4  # angstroms: a C-C distance of a benzene ring
MEMBERS = 6


def _scene() -> dict[str, Any]:
    points: list[dict[str, Any]] = []
    for k in range(MEMBERS):
        angle = 2 * math.pi * k / MEMBERS
        position = [RING_RADIUS * math.cos(angle), RING_RADIUS * math.sin(angle), 0.0]
        points.append(
            {"id": f"p{k}", "element": "C", "label": "C_dna", "position": position, "fractional": None, "ref": str(k)}
        )
    # The cluster's centroid: a computed point (no reference, no atom draws it), at the ring's centre.
    points.append(
        {"id": "p6", "element": "X", "label": "X", "position": [0.0, 0.0, 0.0], "fractional": None, "ref": None}
    )
    points.append(
        {"id": "p7", "element": "He", "label": "He", "position": [0.0, 0.0, 0.0], "fractional": None, "ref": "6"}
    )
    # An oxygen bonded to the first ring atom: the bond's ends name C_dna and O.
    points.append(
        {
            "id": "p8",
            "element": "O",
            "label": "O",
            "position": [RING_RADIUS + 1.0, 0.0, 0.0],
            "fractional": None,
            "ref": "7",
        }
    )
    atoms = [
        {"id": f"atom_{k}", "element": "C", "label": "C_dna", "point_id": f"p{k}", "radius": 0.5, "material_id": "m"}
        for k in range(MEMBERS)
    ]
    atoms.append({"id": "atom_8", "element": "O", "label": "O", "point_id": "p8", "radius": 0.5, "material_id": "m"})
    atoms.append({"id": "atom_6", "element": "He", "label": "He", "point_id": "p7", "radius": 0.5, "material_id": "m"})
    members = [f"p{k}" for k in range(MEMBERS)]
    polyhedra = [
        {
            "id": "poly_0_ring6",
            "name": "ring6",
            "center_point_id": "p6",
            "ligand_point_ids": [*members, "p6"],
            "topology_id": "topo_0",
            "topology_mode": "topology_locked",
            "material_id": "m",
            "per_frame_topology": None,
        },
        {
            "id": "poly_1_He6",
            "name": "He6",
            "center_point_id": "p7",
            "ligand_point_ids": members,
            "topology_id": "topo_1",
            "topology_mode": "fixed",
            "material_id": "m",
            "per_frame_topology": None,
        },
    ]
    bonds = [
        {
            "id": "bond_0_C_dna_O",
            "a_point_id": "p0",
            "b_point_id": "p8",
            "a_element": "C",
            "b_element": "O",
            "a_label": "C_dna",
            "b_label": "O",
            "rule_id": "rule_0",
            "material_id": "m",
        }
    ]
    return {"points": points, "atoms": atoms, "polyhedra": polyhedra, "bonds": bonds}


def _run(body: str, args: Any, tmp_path: Path) -> Any:
    script = tmp_path / "readout.mjs"
    script.write_text(header() + "\nconst args = JSON.parse(process.argv[2]);\n" + body, encoding="utf-8")
    result = subprocess.run(["node", str(script), json.dumps(args)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


# The page's loaded scene is set from the arguments; each readout is read back as data.
SETUP = """
loaded.value = {
  ...loaded.value,
  data: { primitives: { atoms: args.atoms, bonds: args.bonds } },
  points: new Map(args.points.map((point) => [point.id, point])),
  polyhedra: args.polyhedra,
};
const [ring, he] = args.polyhedra;
const readouts = {};
describe({ kind: "polyhedron", poly: ring });
readouts.ring = readout.value;
describe({ kind: "polyhedron", poly: he });
readouts.he = readout.value;
describe({ kind: "atom", atom: args.atoms[0] });
readouts.atom = readout.value;
describe({ kind: "bond", bond: args.bonds[0] });
readouts.bond = readout.value;
"""


@pytest.fixture(scope="module")
def readouts(tmp_path_factory: pytest.TempPathFactory) -> dict[str, Any]:
    tmp_path = tmp_path_factory.mktemp("readout")
    return _run(SETUP + "console.log(JSON.stringify(readouts));", _scene(), tmp_path)


def test_a_ring_counts_its_six_members_and_no_centroid_bond(readouts: dict[str, Any]) -> None:
    ring = readouts["ring"]
    assert ring["kind"] == "polyhedron"
    # The title subscripts the digits of the polyhedron name, as the readout always has.
    assert ring["name"] == "ring₆"
    assert ring["bonds"] == f"6 × {RING_RADIUS:.3f}"
    assert ring["mean"] == f"{RING_RADIUS:.3f}"
    assert ring["delta"] == "0.00"


def test_a_cluster_centre_is_named_a_centroid_not_an_element(readouts: dict[str, Any]) -> None:
    assert readouts["ring"]["centre"] == "centroid"


def test_a_polyhedron_centred_on_an_atom_names_the_atom(readouts: dict[str, Any]) -> None:
    he = readouts["he"]
    assert he["name"] == "He₆"
    assert he["centre"] == "He"
    assert he["bonds"] == f"6 × {RING_RADIUS:.3f}"


def test_an_atom_names_its_label_not_its_element(readouts: dict[str, Any]) -> None:
    atom = readouts["atom"]
    assert atom["kind"] == "atom"
    assert atom["label"] == "C_dna"
    assert "element" not in atom


def test_a_corner_atoms_host_is_the_real_centre_not_the_centroid(readouts: dict[str, Any]) -> None:
    atom = readouts["atom"]
    assert atom["host"] == "He"
    assert atom["neighbours"] == f"{RING_RADIUS:.3f}"


def test_a_bond_names_its_two_labels(readouts: dict[str, Any]) -> None:
    bond = readouts["bond"]
    assert bond["kind"] == "bond"
    assert bond["name"] == "C_dna–O bond"
    assert [end["label"] for end in bond["ends"]] == ["C_dna", "O"]
    assert [end["ref"] for end in bond["ends"]] == ["0", "7"]
    assert bond["length"] == f"{1.0:.3f}"
