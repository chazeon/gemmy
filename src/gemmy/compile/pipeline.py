"""Compile pipeline: structure + config -> SceneDocument. The stages of README "Which atoms are shown" are plain
functions called in a fixed order.

Stages take plain data and return plain data. The only mutable state is `SceneAssembler` (point
dedup and primitive emission order). `compile_structure` writes the order out; `compile_scene` adds file IO.
"""

from __future__ import annotations

from pathlib import Path

from ..config import BondRule, SceneConfig, load_scene_config, save_scene
from ..scene import (
    AtomPrimitive,
    BondPrimitive,
    CellBox,
    DisplacementPrimitive,
    PointRecord,
    PolyhedronPrimitive,
    SceneDocument,
    ScenePrimitives,
    TopologyRecord,
    Vec3,
)
from ..structure import Structure, load_structure
from .bonds import (
    BondSpec,
    build_neighbor_graph,
    cell_array,
    closing_bonds,
    complete_ligand,
    completion_rules,
    find_bonds,
)
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

DISPLACEMENT_RADIUS = 0.022
DISPLACEMENT_COLOR = (0.15, 0.18, 0.22, 1.0)


class PointTable:
    def __init__(self, wrap_shifts: dict[int, tuple[int, int, int]] | None = None) -> None:
        self._wrap_shifts = wrap_shifts or {}  # atom index -> shift that wrapped it into the cell
        self.records: list[PointRecord] = []
        self._ids: dict[PointKey, str] = {}

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
        self._atom_points: set[str] = set()
        self._bond_pairs: set[tuple[str, str]] = set()
        self._topology_ids: dict[tuple[tuple[str, ...], tuple[tuple[int, int, int], ...]], str] = {}

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
                point_id=point_id,
                radius=style.radius,
                material_id=self.materials.resolve(style.material, style.color),
            )
        )
        self._atom_points.add(point_id)
        return point_id

    def add_bond(self, a_point: str, b_point: str, rule: BondRule, a_element: str, b_element: str) -> None:
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
                style=rule.style,
            )
        )
        self._bond_pairs.add(key)  # type: ignore[arg-type]

    def add_bond_spec(self, bond: BondSpec) -> None:
        self.add_bond(self.points.id_for(bond.a), self.points.id_for(bond.b), bond.rule, bond.a.element, bond.b.element)

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
        """A ghost keeps the rule's colour, lightened, at the highlight's opacity."""
        topology_id = self.add_topology(ligand_points, spec.faces)
        rule = spec.rule
        color = rule.color
        if ghost:
            hl = self.config.highlight
            color = ghost_color(color, hl.ghost_opacity, hl.ghost_saturation, hl.ghost_value)
        self.primitives.polyhedra.append(
            PolyhedronPrimitive(
                id=f"poly_{len(self.primitives.polyhedra)}_{spec.name}",
                name=spec.name,
                center_point_id=center_point,
                ligand_point_ids=ligand_points,
                topology_id=topology_id,
                topology_mode=rule.topology_mode,
                material_id=self.materials.resolve(rule.material, color),
                per_frame_topology={"0": topology_id} if rule.topology_mode == "topology_locked" else None,
            )
        )

    def add_arrows(self, arrows: list[ArrowSpec]) -> None:
        """Arrows share one material, created only when there is something to draw or enabled."""
        material_id = self.materials.resolve("bond", DISPLACEMENT_COLOR)
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

    bond_rules = config.bonds
    cutoff = max(
        max((r.max_distance for r in bond_rules if r.visible), default=0.0),
        max((r.max_distance for r in config.polyhedra if r.visible), default=0.0),
    )
    graph = build_neighbor_graph(atoms, cutoff)
    shown = apply_selection(in_box, config.select, by_index, graph, config.polyhedra, cell)

    asm = SceneAssembler(config, {site.index: site.shift for site in wrapped})
    drawn: dict[str, Site] = {}  # every site that gets a point, in first-seen order (arrows follow images)

    def add(site: Site) -> str:
        point = asm.add_atom(site)
        drawn.setdefault(point, site)
        return point

    for site in shown:
        add(site)

    for bond in find_bonds(shown, by_index, graph, bond_rules, cell, strict=config.select.is_active()):
        add(bond.a)
        add(bond.b)
        asm.add_bond_spec(bond)

    secondary_rules = completion_rules(bond_rules)
    marked_centres = [resolve_centre(ref, shown, by_index, cell) for ref in config.highlight.refs()]
    marked = {point_key(c) for c in marked_centres}
    specs = find_polyhedra(shown, by_index, graph, config.polyhedra, cell)
    have = {point_key(spec.center) for spec in specs}
    missing = [c for c in marked_centres if point_key(c) not in have]  # e.g. an image centre outside the box
    if missing:
        specs += find_polyhedra(missing, by_index, graph, config.polyhedra, cell)
    for spec in specs:
        center_point = add(spec.center)
        ligand_points: list[str] = []
        for ligand in spec.ligands:
            ligand_point = add(ligand)
            ligand_points.append(ligand_point)
            for done in complete_ligand(ligand, by_index, graph, secondary_rules, cell):
                partner_point = add(done.partner)
                asm.add_bond(ligand_point, partner_point, done.rule, ligand.element, done.partner.element)
        asm.add_polyhedron(
            spec, center_point, ligand_points, ghost=bool(marked) and point_key(spec.center) not in marked
        )

    if config.displacements.enabled:
        disp = config.displacements
        refs = disp.refs() or config.highlight.refs()
        # Each group: the sites that get arrows and, for one polyhedron's corners, its centre (inward test).
        groups: list[tuple[list[Site], Vec3 | None]] = []
        for ref in refs:
            centre, corners = polyhedron_shell(ref, shown, by_index, graph, config.polyhedra, cell)
            for site in corners:
                add(site)
            groups.append((corners, centre.position if disp.inward == "outside" else None))
        if not refs:
            groups.append((list(drawn.values()), None))
        arrows = []
        for sites, inward_from in groups:
            arrows += make_displacements(
                sites if disp.include_hidden else visible_sites(config, sites),
                displacements or {},
                len(structure.atoms),
                disp.scale,
                disp.style,
                inward_from,
            )
        asm.add_arrows(arrows)

    # Last, once every shown point exists (polyhedron ligands and displacement corners): every bond between
    # two shown points, whatever its `complete` mode. Adds bonds only, never atoms.
    for bond in closing_bonds(list(drawn.values()), by_index, graph, bond_rules, cell):
        asm.add_bond_spec(bond)

    box_origin, box_vectors = cell_box(cell, config.cell.box)
    return SceneDocument(
        source_comment=structure.comment,
        materials=asm.materials.materials,
        points=asm.points.records,
        topologies=asm.topologies,
        primitives=asm.primitives,
        cell=CellBox(origin=box_origin, vectors=box_vectors),
    )


def compile_scene(
    structure: Structure,
    config: SceneConfig,
    *,
    base_dir: str | Path | None = None,
) -> SceneDocument:
    """Compile a scene. Relative `displacements.data_file` resolves against `base_dir` (default: cwd).

    The config is not modified.
    """
    vectors = None
    if config.displacements.enabled:
        data_file = config.displacements.data_file
        if not data_file:
            raise DisplacementFileError("displacements are enabled but displacements.data_file is not set")
        vectors = load_displacement_file(_resolve(data_file, base_dir))
    labels: dict[int, str] = {}
    if config.labels.file:
        labels.update(load_label_file(_resolve(config.labels.file, base_dir)))
    if config.labels.labeler:
        labels.update(run_labeler(config.labels.labeler, structure, base_dir))
    return compile_structure(structure, config, vectors, labels)


def _resolve(file: str, base_dir: str | Path | None) -> Path:
    path = Path(file)
    return Path(base_dir) / path if not path.is_absolute() and base_dir is not None else path


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
    atoms = load_structure(structure_path(config_path, structure))
    return compile_scene(atoms, config, base_dir=Path(config_path).resolve().parent)


def compile_to_json(
    config_path: str | Path, output_json_path: str | Path, structure: str | Path | None = None
) -> SceneDocument:
    scene = compile_scene_from_files(config_path, structure)
    save_scene(scene, output_json_path)
    return scene
