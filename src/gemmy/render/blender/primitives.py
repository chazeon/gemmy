"""Collection handling and mesh primitives."""

from __future__ import annotations

from ...geom import arrow_parts, cylinder_pose, place_mesh, unit_cone, unit_cylinder, unit_sphere


class PrimitivesMixin:
    def _ensure_collection(self, name: str):
        bpy = self._bpy
        col = bpy.data.collections.get(name)
        if col is None:
            col = bpy.data.collections.new(name)
            bpy.context.scene.collection.children.link(col)
        return col

    def _link(self, obj) -> None:
        self._collection.objects.link(obj)

    def _child_collection(self, name: str):
        bpy = self._bpy
        col = bpy.data.collections.get(name)
        if col is None:
            col = bpy.data.collections.new(name)
            self._collection.children.link(col)
        return col

    def _outline_free_collection(self):
        return self._child_collection("PBB_NoOutline")

    def _ghost_collection(self):
        """See-through polyhedra live here so the outline pass can draw them lighter and thinner."""
        return self._child_collection("PBB_Ghosts")

    def _atom_collection(self):
        """Atoms live here so the outline pass can give them their own line set."""
        return self._child_collection("PBB_Atoms")

    def _exclude_from_outline(self, obj) -> None:
        """Objects in this collection are skipped by the Freestyle outline (arrows stay readable)."""
        self._outline_free_collection().objects.link(obj)

    def remove_default_cube(self) -> None:
        bpy = self._bpy
        cube = bpy.data.objects.get("Cube")
        if cube is not None:
            bpy.data.objects.remove(cube, do_unlink=True)

    def _unit_mesh(self, kind: str):
        """Shared unit mesh (cylinder, cone or dot sphere) with one empty slot; objects scale and rotate it."""
        mesh = self._unit_mesh_cache.get(kind)
        if mesh is not None:
            return mesh
        vertices, faces = {"cylinder": unit_cylinder, "cone": unit_cone, "dot": unit_sphere}[kind]()
        mesh = self._bpy.data.meshes.new(f"PBB_Unit_{kind}")
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        if kind == "dot":
            mesh.shade_smooth()
        mesh.materials.append(None)  # slot only; the material is attached per object
        self._unit_mesh_cache[kind] = mesh
        return mesh

    def _add_unit_object(self, name: str, kind: str, center, rotation, scale, material: str):
        """One object on the shared unit mesh; its material is linked to the object so it recolours alone."""
        bpy = self._bpy
        obj = bpy.data.objects.new(name, self._unit_mesh(kind))
        obj.location = center
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = rotation
        obj.scale = scale
        if material in bpy.data.materials:
            slot = obj.material_slots[0]
            slot.link = "OBJECT"
            slot.material = bpy.data.materials[material]
        self._link(obj)
        return obj

    def add_cylinder(self, name: str, a, b, radius: float, material: str, *, outline: bool) -> None:
        pose = cylinder_pose(a, b)
        if pose is None:
            return
        obj = self._add_unit_object(
            name, "cylinder", pose.center, pose.rotation, (radius, radius, pose.length), material
        )
        if not outline:
            self._exclude_from_outline(obj)

    def add_dot(self, name: str, center, radius: float, material: str) -> None:
        obj = self._add_unit_object(name, "dot", center, (1.0, 0.0, 0.0, 0.0), (radius,) * 3, material)
        self._exclude_from_outline(obj)

    def add_arrow(
        self,
        name: str,
        a,
        b,
        radius: float,
        material: str,
        *,
        head_radius_ratio: float = 2.2,
        head_length_ratio: float = 0.22,
    ) -> None:
        parts = arrow_parts(a, b, radius, head_length_ratio)
        if parts is None:
            return
        shaft = cylinder_pose(a, parts.shaft_end)
        head_radius = radius * head_radius_ratio
        for obj in (
            self._add_unit_object(
                f"{name}_shaft", "cylinder", shaft.center, shaft.rotation, (radius, radius, shaft.length), material
            ),
            self._add_unit_object(
                f"{name}_head",
                "cone",
                parts.head_center,
                parts.rotation,
                (head_radius, head_radius, parts.head_length),
                material,
            ),
        ):
            self._exclude_from_outline(obj)

    def _add_merged(self, name: str, vertices, faces, material: str, *, outline: bool, smooth: bool = False) -> None:
        """One object holding many pieces of one material (large scenes)."""
        if not faces:
            return
        bpy = self._bpy
        mesh = bpy.data.meshes.new(f"{name}_mesh")
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        if smooth:
            mesh.shade_smooth()
        if material in bpy.data.materials:
            mesh.materials.append(bpy.data.materials[material])
        obj = bpy.data.objects.new(name, mesh)
        self._link(obj)
        if not outline:
            self._exclude_from_outline(obj)

    def add_cylinder_batch(self, name: str, pieces, material: str, *, outline: bool) -> None:
        vertices, faces = [], []
        unit = unit_cylinder()
        for a, b, radius in pieces:
            pose = cylinder_pose(a, b)
            if pose is not None:
                place_mesh(unit, pose.center, pose.rotation, (radius, radius, pose.length), vertices, faces)
        self._add_merged(name, vertices, faces, material, outline=outline)

    def add_dot_batch(self, name: str, dots, material: str) -> None:
        vertices, faces = [], []
        unit = unit_sphere()
        for center, radius in dots:
            place_mesh(unit, center, (1.0, 0.0, 0.0, 0.0), (radius,) * 3, vertices, faces)
        self._add_merged(name, vertices, faces, material, outline=False, smooth=True)

    def add_arrow_batch(
        self, name: str, arrows, material: str, *, head_radius_ratio: float, head_length_ratio: float
    ) -> None:
        vertices, faces = [], []
        cylinder, cone = unit_cylinder(), unit_cone()
        for a, b, radius in arrows:
            parts = arrow_parts(a, b, radius, head_length_ratio)
            if parts is None:
                continue
            shaft = cylinder_pose(a, parts.shaft_end)
            place_mesh(cylinder, shaft.center, shaft.rotation, (radius, radius, shaft.length), vertices, faces)
            head = radius * head_radius_ratio
            place_mesh(cone, parts.head_center, parts.rotation, (head, head, parts.head_length), vertices, faces)
        self._add_merged(name, vertices, faces, material, outline=False)

    def add_mesh(
        self,
        name: str,
        vertices,
        faces,
        material: str,
        *,
        edge_material: str | None = None,
        edge_width: float = 0.05,
        ghost: bool = False,
    ) -> None:
        bpy = self._bpy
        mesh = bpy.data.meshes.new(name=f"{name}_mesh")
        mesh.from_pydata(vertices, [], faces)
        mesh.update()
        obj = bpy.data.objects.new(name, mesh)
        if material in bpy.data.materials:
            obj.data.materials.append(bpy.data.materials[material])
        self._link(obj)
        obj.visible_shadow = self._look.polyhedron_shadows and not ghost
        if ghost:  # see-through polyhedron: casts no shadow, faint outline
            self._ghost_collection().objects.link(obj)
            self._exclude_from_outline(obj)  # out of the main line set; the ghost line set draws it
        if edge_material is not None:
            # Wireframe modifier draws the outline with its own material slot.
            obj.data.materials.append(bpy.data.materials[edge_material])
            mod = obj.modifiers.new("PBB_Edges", "WIREFRAME")
            mod.thickness = edge_width
            mod.use_replace = False
            mod.offset = 0.0
            mod.material_offset = 1

    def add_mesh_batch(
        self,
        name: str,
        parts,
        material: str,
        *,
        edge_material: str | None,
        edge_width: float,
        ghost: bool,
    ) -> None:
        """Many polyhedra of one material as one flat-shaded mesh (large scenes), edges drawn the same way."""
        vertices, faces = [], []
        for part_vertices, part_faces in parts:
            base = len(vertices)
            vertices.extend(part_vertices)
            faces.extend(tuple(base + i for i in face) for face in part_faces)
        self.add_mesh(name, vertices, faces, material, edge_material=edge_material, edge_width=edge_width, ghost=ghost)

    def _move_to_collection(self, obj) -> None:
        for col in list(obj.users_collection):
            col.objects.unlink(obj)
        self._link(obj)
