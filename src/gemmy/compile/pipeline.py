"""Compile pipeline: structure + config -> SceneDocument. The stages of README "Which atoms are shown" are plain
functions called in a fixed order.

Stages take plain data and return plain data. The only mutable state is `SceneAssembler` (point dedup and primitive
emission order). `compile_structure` writes the order out; `compile_scene` adds file IO.
"""

from __future__ import annotations

import warnings
from pathlib import Path
from typing import NamedTuple

import numpy as np

from ..config import BondRule, SceneConfig, load_scene_config, save_scene
from ..readers import load_structure
from ..readers.record import Structure
from ..scene import (
    AtomPrimitive,
    BondPrimitive,
    CellBox,
    Color,
    DisplacementPrimitive,
    PointRecord,
    PolyhedronPrimitive,
    SceneDocument,
    ScenePrimitives,
    TopologyRecord,
    Vec3,
)
from .bonds import (
    BondSpec,
    NeighborGraph,
    build_neighbor_graph,
    cell_array,
    closing_bonds,
    complete_ligand,
    completion_rules,
    find_bonds,
)
from .clusters import ClusterSpec, find_clusters
from .displacements import ArrowSpec, DisplacementFileError, load_displacement_file, make_displacements
from .labels import apply_labels, load_label_file, run_labeler
from .lattice import cell_box
from .materials import MaterialTable, ghost_color, is_hidden, style_for, visible_sites
from .polyhedra import PolyhedronSpec, find_polyhedra
from .selection import apply_selection, polyhedron_shell, resolve_centre
from .sites import (
    PointKey,
    Site,
    base_box,
    build_sites,
    point_key,
    repeat_structure,
    select_sites,
    site_ref,
    snap_sites,
    wrap_sites,
)

# Mirrored in web/src/compile/pipeline.ts (DISPLACEMENT_RADIUS, DISPLACEMENT_COLOR): change both together.
DISPLACEMENT_RADIUS = 0.022
DISPLACEMENT_COLOR = (0.15, 0.18, 0.22, 1.0)
# Arrows take the bond material style as their base.
ARROW_MATERIAL = "bond"
# The per_frame_topology key of the one frame a topology-locked polyhedron has.
FIRST_FRAME = "0"
# The topology mode of a polyhedron that keeps its faces across frames (config.PolyhedronRule.topology_mode's default).
TOPOLOGY_LOCKED = "topology_locked"
# The neighbour lists are strict (ASE and fastatoms return distances below the cutoff), but the rules match inclusively
# (min <= d <= max). The search radius is wider than the longest max by this relative margin, so a neighbour exactly at
# a rule's max is found; the rules still compare exactly. Mirrored in web/src/compile/pipeline.ts.
NEIGHBOR_CUTOFF_MARGIN = 1e-9
# The element of a computed point (a cluster centroid, which no atom is). Mirrored in web/src/compile/pipeline.ts
# (COMPUTED_ELEMENT), and read by the viewer as an element with no atom.
COMPUTED_ELEMENT = "X"


def compile_scene(
    structure: Structure,
    config: SceneConfig,
    *,
    base_dir: str | Path | None = None,
) -> SceneDocument:
    """Compile a scene. Relative `displacements.data_file` resolves against `base_dir` (default: cwd).

    The config is not modified.
    """
    vectors = load_vectors(config, base_dir)
    labels = load_labels(config, structure, base_dir)
    return compile_structure(structure, config, vectors, labels)


def compile_structure(
    structure: Structure,
    config: SceneConfig,
    displacements: dict[int, Vec3] | None = None,
    labels: dict[int, str] | None = None,
) -> SceneDocument:
    """Compile with already-loaded displacement vectors and label overrides (source index -> label)."""
    atoms = repeat_structure(structure, config.cell.supercell, config.cell.periodic)
    cell = cell_array(atoms)
    labelled = apply_labels(build_sites(structure, atoms), labels or {}, len(structure.atoms))
    base_sites = snap_sites(labelled, cell, config.cell.eps)
    by_index = {site.index: site for site in base_sites}  # unshifted, snapped: origin of every image
    wrapped = wrap_sites(base_sites, cell, config.cell.periodic)
    in_box = select_sites(
        base_box(wrapped, cell, config.cell.box, config.cell.periodic, config.cell.eps),
        config.cell.cartesian_limits,
    )
    graph = build_neighbor_graph(atoms, bond_cutoff(config))
    shown = apply_selection(in_box, config.select, by_index, graph, config.polyhedra, cell)

    marked_centres = [resolve_centre(ref, shown, by_index, cell) for ref in config.highlight.refs()]
    marked = {point_key(c) for c in marked_centres}
    messages: list[str] = []  # the warnings the stages raise, in stage order; emitted at the end
    specs = polyhedra_to_show(shown, marked_centres, by_index, graph, config, cell, messages)
    asm = SceneAssembler(config, {site.index: site.shift for site in wrapped})
    for site in shown:
        asm.add_site(site)
    add_clusters(asm, shown, by_index, graph, config, cell, specs, marked, messages)

    bond_rules = config.bonds
    for bond in find_bonds(shown, by_index, graph, bond_rules, cell, strict=config.select.is_active()):
        asm.add_site(bond.a)
        asm.add_site(bond.b)
        asm.add_bond_spec(bond)

    add_polyhedra(asm, specs, marked, by_index, graph, config, cell)

    if config.displacements.enabled:
        arrows = displacement_arrows(
            asm, config, displacements or {}, len(structure.atoms), shown, by_index, graph, cell
        )
        asm.add_arrows(arrows)

    # Last, once every shown point exists (polyhedron ligands and displacement corners): every bond between
    # two shown points, whatever its `complete` mode. Adds bonds only, never atoms.
    for bond in closing_bonds(list(asm.drawn.values()), by_index, graph, bond_rules, cell):
        asm.add_bond_spec(bond)

    for message in messages:
        warnings.warn(message, UserWarning, stacklevel=2)
    box_origin, box_vectors = cell_box(cell, config.cell.box)
    return SceneDocument(
        source_comment=structure.comment,
        materials=asm.materials.materials,
        points=asm.points.records,
        topologies=asm.topologies,
        primitives=asm.primitives,
        cell=CellBox(origin=box_origin, vectors=box_vectors),
    )


def load_vectors(config: SceneConfig, base_dir: str | Path | None) -> dict[int, Vec3] | None:
    """The displacement vectors the config's data file names, or None when displacements are off."""
    if not config.displacements.enabled:
        return None
    data_file = config.displacements.data_file
    if not data_file:
        raise DisplacementFileError("displacements are enabled but displacements.data_file is not set")
    return load_displacement_file(_resolve(data_file, base_dir))


def load_labels(config: SceneConfig, structure: Structure, base_dir: str | Path | None) -> dict[int, str]:
    """Label overrides from the label file, then from the labeler (a labeler's entries win)."""
    labels: dict[int, str] = {}
    if config.labels.file:
        labels.update(load_label_file(_resolve(config.labels.file, base_dir)))
    if config.labels.labeler:
        labels.update(run_labeler(config.labels.labeler, structure, base_dir))
    return labels


def _resolve(file: str, base_dir: str | Path | None) -> Path:
    path = Path(file)
    return Path(base_dir) / path if not path.is_absolute() and base_dir is not None else path


def bond_cutoff(config: SceneConfig) -> float:
    """The neighbour search radius: the longest visible bond, polyhedron or cluster rule, widened by
    NEIGHBOR_CUTOFF_MARGIN (0.0 when there is none)."""
    bond_reach = max((r.max_distance for r in config.bonds if r.visible), default=0.0)
    polyhedron_reach = max((r.max_distance for r in config.polyhedra if r.visible), default=0.0)
    cluster_reach = max((r.max_distance for r in config.clusters if r.visible), default=0.0)
    return max(bond_reach, polyhedron_reach, cluster_reach) * (1 + NEIGHBOR_CUTOFF_MARGIN)


def polyhedra_to_show(
    shown: list[Site],
    marked_centres: list[Site],
    by_index: dict[int, Site],
    graph: NeighborGraph,
    config: SceneConfig,
    cell: np.ndarray,
    messages: list[str],
) -> list[PolyhedronSpec]:
    """A polyhedron per shown centre, plus one per highlighted centre outside the box. Skipped centres add a message."""
    specs = find_polyhedra(shown, by_index, graph, config.polyhedra, cell, messages)
    found_centre_keys = {point_key(spec.center) for spec in specs}
    # e.g. an image centre outside the box
    missing = [c for c in marked_centres if point_key(c) not in found_centre_keys]
    if missing:
        specs += find_polyhedra(missing, by_index, graph, config.polyhedra, cell, messages)
    return specs


def add_polyhedra(
    asm: SceneAssembler,
    specs: list[PolyhedronSpec],
    marked: set[PointKey],
    by_index: dict[int, Site],
    graph: NeighborGraph,
    config: SceneConfig,
    cell: np.ndarray,
) -> None:
    """Each polyhedron, in order: its centre, its ligands, the bonds that complete each ligand, then the polyhedron.
    It is a ghost when some centre is highlighted and this one is not."""
    secondary_rules = completion_rules(config.bonds)
    for spec in specs:
        center_point = asm.add_site(spec.center)
        ligand_points: list[str] = []
        for ligand in spec.ligands:
            ligand_point = asm.add_site(ligand)
            ligand_points.append(ligand_point)
            for done in complete_ligand(ligand, by_index, graph, secondary_rules, cell):
                partner_point = asm.add_site(done.partner)
                asm.add_bond(
                    a_point=ligand_point,
                    b_point=partner_point,
                    rule=done.rule,
                    a_element=ligand.element,
                    b_element=done.partner.element,
                    a_label=ligand.label,
                    b_label=done.partner.label,
                )
        is_ghost = bool(marked) and point_key(spec.center) not in marked
        asm.add_polyhedron(spec, center_point, ligand_points, ghost=is_ghost)


def add_clusters(
    asm: SceneAssembler,
    shown: list[Site],
    by_index: dict[int, Site],
    graph: NeighborGraph,
    config: SceneConfig,
    cell: np.ndarray,
    polyhedra: list[PolyhedronSpec],
    marked: set[PointKey],
    messages: list[str],
) -> None:
    """Each cluster, in order: its members (atoms, as polyhedron ligands are), its centroid as a computed point, then
    the polyhedron. A ring's faces index its members and then the centroid, so the centroid is a ring's last ligand.
    A cluster with no faces adds a message. A cluster whose members are exactly the ligands of a polyhedron is skipped
    with a message: the polyhedron is drawn in its place (its centre is the more specific choice). With highlighted
    centres, a cluster is a ghost unless one of its members is one of them (as a polyhedron is, by its centre)."""
    specs = find_clusters(
        shown, by_index, graph, config.clusters, cell, config.cell.box, config.cell.periodic, config.cell.eps, messages
    )
    polyhedron_by_ligands = {frozenset(point_key(s) for s in p.ligands): p for p in polyhedra}
    for spec in specs:
        twin = polyhedron_by_ligands.get(frozenset(point_key(s) for s in spec.members))
        if twin is not None:
            messages.append(
                f"cluster {spec.name} skipped: its members are exactly the ligands of polyhedron {twin.name}, which is "
                "drawn in their place (the polyhedron wins: its centre is the more specific choice)"
            )
            continue
        members = [asm.add_site(site) for site in spec.members]
        centroid = asm.points.add_computed(spec.centroid, spec.centroid_fractional)
        ligands = [*members, centroid] if spec.rule.kind == "ring" else members
        is_ghost = bool(marked) and not any(point_key(site) in marked for site in spec.members)
        asm.add_cluster(spec, centroid, ligands, ghost=is_ghost)


class SolidStyle(NamedTuple):
    """How a polyhedron or a cluster is drawn: its material name, its colour and its topology mode."""

    material: str
    color: Color
    topology_mode: str


class ArrowGroup(NamedTuple):
    """The sites that get arrows. `inward_from` is one polyhedron's centre when its arrows are tested inward
    (`displacements.inward = "outside"`), else None."""

    sites: list[Site]
    inward_from: Vec3 | None


def displacement_arrows(
    asm: SceneAssembler,
    config: SceneConfig,
    vectors: dict[int, Vec3],
    atom_count: int,
    shown: list[Site],
    by_index: dict[int, Site],
    graph: NeighborGraph,
    cell: np.ndarray,
) -> list[ArrowSpec]:
    """The arrows for the displacement settings. The corners of each ref's polyhedron get their points; with no
    refs, every drawn site gets an arrow."""
    disp = config.displacements
    refs = disp.refs() or config.highlight.refs()
    groups: list[ArrowGroup] = []
    for ref in refs:
        centre, corners = polyhedron_shell(ref, shown, by_index, graph, config.polyhedra, cell)
        for site in corners:
            asm.add_site(site)
        groups.append(ArrowGroup(corners, centre.position if disp.inward == "outside" else None))
    if not refs:
        groups.append(ArrowGroup(list(asm.drawn.values()), None))
    arrows: list[ArrowSpec] = []
    for group in groups:
        sites = group.sites if disp.include_hidden else visible_sites(config, group.sites)
        arrows += make_displacements(sites, vectors, atom_count, disp.scale, disp.style, group.inward_from)
    return arrows


class PointTable:
    def __init__(self, wrap_shifts: dict[int, tuple[int, int, int]] | None = None) -> None:
        self._wrap_shifts = wrap_shifts or {}  # atom index -> shift that wrapped it into the cell
        self.records: list[PointRecord] = []
        self._ids: dict[PointKey, str] = {}  # atom points, keyed by (index, shift)

    def add_computed(self, position: Vec3, fractional: Vec3) -> str:
        """A point that is no atom (a cluster centroid): never shown, no reference, and no key (nothing looks it up)."""
        point_id = f"p{len(self.records)}"
        self.records.append(
            PointRecord(
                id=point_id,
                element=COMPUTED_ELEMENT,
                label=COMPUTED_ELEMENT,
                position=position,
                fractional=fractional,
                ref=None,
            )
        )
        return point_id

    def id_for(self, site: Site) -> str:
        key = point_key(site)
        found = self._ids.get(key)
        if found is not None:
            return found
        point_id = f"p{len(self.records)}"
        self.records.append(
            PointRecord(
                id=point_id,
                element=site.element,
                label=site.label,
                position=site.position,
                fractional=site.fractional,
                ref=site_ref(site, self._wrap_shifts.get(site.index, (0, 0, 0))),
            )
        )
        self._ids[key] = point_id
        return point_id


class SceneAssembler:
    def __init__(self, config: SceneConfig, wrap_shifts: dict[int, tuple[int, int, int]] | None = None) -> None:
        self.config = config
        self.points = PointTable(wrap_shifts)
        self.materials = MaterialTable(config.materials)
        self.primitives = ScenePrimitives()
        self.topologies: list[TopologyRecord] = []
        self.drawn: dict[str, Site] = {}  # every site that gets a point, in first-seen order (arrows follow images)
        self._atom_points: set[str] = set()
        self._bond_pairs: set[tuple[str, str]] = set()
        self._topology_ids: dict[tuple[tuple[str, ...], tuple[tuple[int, int, int], ...]], str] = {}

    def add_site(self, site: Site) -> str:
        """add_atom, and remember the site as drawn."""
        point = self.add_atom(site)
        self.drawn.setdefault(point, site)
        return point

    def add_atom(self, site: Site) -> str:
        """Register the point and (unless hidden or already emitted) its atom primitive."""
        point_id = self.points.id_for(site)
        style = style_for(self.config, site)
        if point_id in self._atom_points or is_hidden(style):
            return point_id
        self.primitives.atoms.append(
            AtomPrimitive(
                id=f"atom_{len(self.primitives.atoms)}_{site.element}",
                element=site.element,
                label=site.label,
                point_id=point_id,
                radius=style.radius,
                material_id=self.materials.resolve(style.material, style.color),
            )
        )
        self._atom_points.add(point_id)
        return point_id

    def add_bond(
        self,
        *,
        a_point: str,
        b_point: str,
        rule: BondRule,
        a_element: str,
        b_element: str,
        a_label: str,
        b_label: str,
    ) -> None:
        key = tuple(sorted((a_point, b_point)))
        if key in self._bond_pairs:
            return
        self.primitives.bonds.append(
            BondPrimitive(
                id=f"bond_{len(self.primitives.bonds)}_{rule.a}_{rule.b}",
                a_point_id=a_point,
                b_point_id=b_point,
                radius=rule.radius,
                material_id=self.materials.resolve(rule.material, rule.color),
                a_element=a_element,
                b_element=b_element,
                a_label=a_label,
                b_label=b_label,
                style=rule.style,
            )
        )
        self._bond_pairs.add(key)  # type: ignore[arg-type]

    def add_bond_spec(self, bond: BondSpec) -> None:
        a_point = self.points.id_for(bond.a)
        b_point = self.points.id_for(bond.b)
        self.add_bond(
            a_point=a_point,
            b_point=b_point,
            rule=bond.rule,
            a_element=bond.a.element,
            b_element=bond.b.element,
            a_label=bond.a.label,
            b_label=bond.b.label,
        )

    def add_topology(self, point_ids: list[str], faces: list[tuple[int, int, int]]) -> str:
        key = (tuple(point_ids), tuple(faces))
        found = self._topology_ids.get(key)
        if found is None:
            found = f"topo_{len(self.topologies)}"
            self.topologies.append(TopologyRecord(id=found, point_ids=list(point_ids), faces=faces))
            self._topology_ids[key] = found
        return found

    def add_polyhedron(
        self, spec: PolyhedronSpec, center_point: str, ligand_points: list[str], *, ghost: bool = False
    ) -> None:
        rule = spec.rule
        style = SolidStyle(rule.material, rule.color, rule.topology_mode)
        self._add_solid(spec.name, spec.faces, style, center_point, ligand_points, ghost=ghost)

    def add_cluster(
        self, spec: ClusterSpec, center_point: str, ligand_points: list[str], *, ghost: bool = False
    ) -> None:
        """A cluster is drawn as a polyhedron, locked to its one topology: its faces index its members (a ring's
        centroid comes last)."""
        style = SolidStyle(spec.rule.material, spec.rule.color, TOPOLOGY_LOCKED)
        self._add_solid(spec.name, spec.faces, style, center_point, ligand_points, ghost=ghost)

    def _add_solid(
        self,
        name: str,
        faces: list[tuple[int, int, int]],
        style: SolidStyle,
        center_point: str,
        ligand_points: list[str],
        *,
        ghost: bool,
    ) -> None:
        topology_id = self.add_topology(ligand_points, faces)
        self.primitives.polyhedra.append(
            PolyhedronPrimitive(
                id=f"poly_{len(self.primitives.polyhedra)}_{name}",
                name=name,
                center_point_id=center_point,
                ligand_point_ids=ligand_points,
                topology_id=topology_id,
                topology_mode=style.topology_mode,
                material_id=self.materials.resolve(style.material, self.polyhedron_color(style.color, ghost)),
                per_frame_topology={FIRST_FRAME: topology_id} if style.topology_mode == TOPOLOGY_LOCKED else None,
            )
        )

    def polyhedron_color(self, color: Color, ghost: bool) -> Color:
        """The colour. A ghost keeps it, lightened, at the highlight's opacity."""
        if not ghost:
            return color
        hl = self.config.highlight
        return ghost_color(color, hl.ghost_opacity, hl.ghost_saturation, hl.ghost_value)

    def add_arrows(self, arrows: list[ArrowSpec]) -> None:
        """Arrows share one material. It is resolved even with no arrows, so the material table lists it."""
        material_id = self.materials.resolve(ARROW_MATERIAL, DISPLACEMENT_COLOR)
        for arrow in arrows:
            self.primitives.displacements.append(
                DisplacementPrimitive(
                    id=f"disp_{len(self.primitives.displacements)}",
                    start_point_id=self.points.id_for(arrow.site),
                    vector=arrow.vector,
                    mode=arrow.mode,
                    anchor=arrow.anchor,
                    radius=DISPLACEMENT_RADIUS,
                    material_id=material_id,
                )
            )


def structure_path(config_path: str | Path, structure: str | Path | None = None) -> Path:
    """The structure file to compile: `structure` if given, else the config's `structure` key (relative to the
    config's folder). ValueError when neither names one."""
    if structure is not None:
        return Path(structure)
    name = load_scene_config(config_path).structure
    if not name:
        raise ValueError(f'{config_path} names no structure: add structure = "POSCAR" to it, or pass --poscar.')
    return Path(config_path).resolve().parent / name


def compile_scene_from_files(config_path: str | Path, structure: str | Path | None = None) -> SceneDocument:
    """Config (TOML or JSON) -> SceneDocument. The structure comes from the config unless `structure` overrides it;
    relative file names in the config resolve against the config's folder."""
    config = load_scene_config(config_path)
    atoms = load_structure(structure_path(config_path, structure), config.types)
    return compile_scene(atoms, config, base_dir=Path(config_path).resolve().parent)


def compile_to_json(
    config_path: str | Path, output_json_path: str | Path, structure: str | Path | None = None
) -> SceneDocument:
    scene = compile_scene_from_files(config_path, structure)
    save_scene(scene, output_json_path)
    return scene
