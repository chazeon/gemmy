"""RecordingBackend: implements the full backend Protocol and records every call in order."""

from __future__ import annotations


class RecordingBackend:
    def __init__(self) -> None:
        self.calls: list[tuple] = []

    def _rec(self, name: str, *args, **kwargs) -> None:
        self.calls.append((name, args, kwargs))

    def names(self) -> list[str]:
        return [c[0] for c in self.calls]

    def of(self, name: str) -> list[tuple[tuple, dict]]:
        return [(a, k) for n, a, k in self.calls if n == name]

    # Geometry
    def ensure_material(self, name, spec):
        self._rec("ensure_material", name, spec)

    def add_atom(self, name, center, radius, material, *, segments, ring_count):
        self._rec("add_atom", name, center, radius, material, segments=segments, ring_count=ring_count)

    def add_atom_instances(self, name, centers, radius, material, *, segments, ring_count):
        self._rec("add_atom_instances", name, list(centers), radius, material, segments=segments, ring_count=ring_count)

    def add_cylinder(self, name, a, b, radius, material, *, outline):
        self._rec("add_cylinder", name, a, b, radius, material, outline=outline)

    def add_dot(self, name, center, radius, material):
        self._rec("add_dot", name, center, radius, material)

    def add_arrow(self, name, a, b, radius, material, *, head_radius_ratio, head_length_ratio):
        self._rec(
            "add_arrow",
            name,
            a,
            b,
            radius,
            material,
            head_radius_ratio=head_radius_ratio,
            head_length_ratio=head_length_ratio,
        )

    def add_cylinder_batch(self, name, pieces, material, *, outline):
        self._rec("add_cylinder_batch", name, list(pieces), material, outline=outline)

    def add_dot_batch(self, name, dots, material):
        self._rec("add_dot_batch", name, list(dots), material)

    def add_arrow_batch(self, name, arrows, material, *, head_radius_ratio, head_length_ratio):
        self._rec(
            "add_arrow_batch",
            name,
            list(arrows),
            material,
            head_radius_ratio=head_radius_ratio,
            head_length_ratio=head_length_ratio,
        )

    def add_mesh_batch(self, name, parts, material, *, edge_material, edge_width, ghost):
        self._rec(
            "add_mesh_batch",
            name,
            list(parts),
            material,
            edge_material=edge_material,
            edge_width=edge_width,
            ghost=ghost,
        )

    def add_mesh(self, name, vertices, faces, material, *, edge_material, edge_width, ghost):
        self._rec(
            "add_mesh", name, vertices, faces, material, edge_material=edge_material, edge_width=edge_width, ghost=ghost
        )

    # Stage
    def apply_look(self, look):
        self._rec("apply_look", look)

    def remove_default_cube(self):
        self._rec("remove_default_cube")

    def setup_soft_lighting(self, target, extent, enabled):
        self._rec("setup_soft_lighting", target, extent, enabled)

    def setup_backdrop(self, target, extent, enabled):
        self._rec("setup_backdrop", target, extent, enabled)

    def set_camera(self, camera, extent):
        self._rec("set_camera", camera, extent)

    def set_axes_overlay(self, axes):
        self._rec("set_axes_overlay", axes)

    def configure_renderer(self, quality):
        self._rec("configure_renderer", quality)

    def render_still(self, filepath):
        self._rec("render_still", filepath)

    def get_render_settings(self):
        return {}
