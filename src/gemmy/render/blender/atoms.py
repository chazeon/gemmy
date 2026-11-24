"""Atoms: linked duplicates sharing one mesh per size (object-linked materials), and Geometry Nodes
sphere instancing (automatic above quality.instancing_threshold atoms)."""

from __future__ import annotations


class AtomsMixin:
    def _shared_sphere_mesh(self, radius: float, segments: int, ring_count: int):
        """Sphere mesh shared by every atom of this size. Carries one empty slot, no material."""
        key = (float(radius), max(3, int(segments)), max(3, int(ring_count)))
        mesh = self._atom_mesh_cache.get(key)
        if mesh is not None:
            return mesh
        bpy = self._bpy
        bpy.ops.mesh.primitive_uv_sphere_add(radius=key[0], segments=key[1], ring_count=key[2])
        proto = bpy.context.object
        mesh = proto.data.copy()
        mesh.name = f"PBB_Atom_{len(self._atom_mesh_cache)}"
        mesh.shade_smooth()
        mesh.materials.clear()
        mesh.materials.append(None)  # slot only; the material is attached per object
        bpy.data.objects.remove(proto, do_unlink=True)
        self._atom_mesh_cache[key] = mesh
        return mesh

    def add_atom(
        self,
        name: str,
        center,
        radius: float,
        material: str,
        *,
        segments: int,
        ring_count: int,
    ) -> None:
        """One object per atom, `obj.data` shared, material linked to the object.

        Recolouring one atom in the GUI (object material slot) changes only that atom.
        """
        bpy = self._bpy
        obj = bpy.data.objects.new(name, self._shared_sphere_mesh(radius, segments, ring_count))
        obj.location = center
        slot = obj.material_slots[0]
        slot.link = "OBJECT"
        slot.material = bpy.data.materials[material]
        obj.visible_shadow = self._look.atom_shadows
        self._atom_collection().objects.link(obj)

    def _sphere_cache_key(
        self,
        radius: float,
        segments: int,
        ring_count: int,
        material: str,
    ) -> tuple[float, int, int, str]:
        return (float(radius), max(3, int(segments)), max(3, int(ring_count)), material)

    def _sphere_mesh_for_key(self, key: tuple[float, int, int, str]):
        bpy = self._bpy
        mesh = self._sphere_mesh_cache.get(key)
        if mesh is not None:
            return mesh

        radius, seg, rings, material = key
        bpy.ops.mesh.primitive_uv_sphere_add(
            radius=radius,
            location=(0.0, 0.0, 0.0),
            segments=seg,
            ring_count=rings,
        )
        proto = bpy.context.object
        mesh = proto.data.copy()
        mesh.name = f"PBB_Sphere_{len(self._sphere_mesh_cache)}"
        mesh.shade_smooth()
        mesh.materials.clear()
        if material in bpy.data.materials:
            mesh.materials.append(bpy.data.materials[material])
        bpy.data.objects.remove(proto, do_unlink=True)
        self._sphere_mesh_cache[key] = mesh
        return mesh

    def _ensure_sphere_prototype(self, key: tuple[float, int, int, str]):
        bpy = self._bpy
        proto = self._sphere_prototype_cache.get(key)
        if proto is not None and getattr(proto, "name", "") in bpy.data.objects:
            return proto

        mesh = self._sphere_mesh_for_key(key)
        proto = bpy.data.objects.new(f"PBB_SphereProto_{len(self._sphere_prototype_cache)}", mesh)
        proto.location = (0.0, 0.0, 0.0)
        self._link(proto)  # must be in the view layer before it can be hidden
        proto.hide_render = True
        proto.hide_set(True)
        proto.hide_viewport = True
        self._sphere_prototype_cache[key] = proto
        return proto

    def _set_node_group_geometry_io(self, node_group) -> None:
        if hasattr(node_group, "interface"):
            node_group.interface.new_socket(
                name="Geometry",
                in_out="INPUT",
                socket_type="NodeSocketGeometry",
            )
            node_group.interface.new_socket(
                name="Geometry",
                in_out="OUTPUT",
                socket_type="NodeSocketGeometry",
            )
            return
        node_group.inputs.new("NodeSocketGeometry", "Geometry")
        node_group.outputs.new("NodeSocketGeometry", "Geometry")

    def _socket(self, sockets, *names):
        for name in names:
            socket = sockets.get(name)
            if socket is not None:
                return socket
        if len(sockets) <= 0:
            raise RuntimeError("Expected node socket not found.")
        return sockets[0]

    def _ensure_sphere_instancer_group(self, key: tuple[float, int, int, str]):
        bpy = self._bpy
        group = self._sphere_instancer_group_cache.get(key)
        if group is not None and getattr(group, "name", "") in bpy.data.node_groups:
            return group

        prototype = self._ensure_sphere_prototype(key)
        group = bpy.data.node_groups.new(
            name=f"PBB_SphereInstancer_{len(self._sphere_instancer_group_cache)}",
            type="GeometryNodeTree",
        )
        self._set_node_group_geometry_io(group)

        nodes = group.nodes
        links = group.links
        group_input = nodes.new("NodeGroupInput")
        mesh_to_points = nodes.new("GeometryNodeMeshToPoints")
        object_info = nodes.new("GeometryNodeObjectInfo")
        instance_on_points = nodes.new("GeometryNodeInstanceOnPoints")
        group_output = nodes.new("NodeGroupOutput")

        object_input = object_info.inputs.get("Object")
        if object_input is not None:
            object_input.default_value = prototype
        as_instance_input = object_info.inputs.get("As Instance")
        if as_instance_input is not None:
            as_instance_input.default_value = True

        links.new(
            self._socket(group_input.outputs, "Geometry"),
            self._socket(mesh_to_points.inputs, "Mesh", "Geometry"),
        )
        links.new(
            self._socket(mesh_to_points.outputs, "Points"),
            self._socket(instance_on_points.inputs, "Points"),
        )
        links.new(
            self._socket(object_info.outputs, "Geometry"),
            self._socket(instance_on_points.inputs, "Instance"),
        )
        links.new(
            self._socket(instance_on_points.outputs, "Instances", "Geometry"),
            self._socket(group_output.inputs, "Geometry"),
        )

        self._sphere_instancer_group_cache[key] = group
        return group

    def add_atom_instances(
        self,
        name: str,
        centers,
        radius: float,
        material: str,
        *,
        segments: int,
        ring_count: int,
    ) -> None:
        """Geometry Nodes instancing (large structures). Raises if GN cannot be built.

        Instances share the prototype mesh and its material, so per-atom hand-painting is not
        supported on this path; use linked duplicates (below the threshold) for that.
        """
        if not centers:
            return
        bpy = self._bpy
        key = self._sphere_cache_key(radius, segments, ring_count, material)
        try:
            node_group = self._ensure_sphere_instancer_group(key)
            instancer_mesh = bpy.data.meshes.new(name=f"{name}_points")
            instancer_mesh.from_pydata(centers, [], [])
            instancer_mesh.update()
            instancer = bpy.data.objects.new(name, instancer_mesh)
            instancer.visible_shadow = self._look.atom_shadows
            self._atom_collection().objects.link(instancer)
            modifier = instancer.modifiers.new(name="PBB_InstanceOnPoints", type="NODES")
            modifier.node_group = node_group
            if hasattr(instancer, "display_type"):
                instancer.display_type = "WIRE"
        except Exception as exc:
            raise RuntimeError(
                f"Geometry Nodes instancing failed for {len(centers)} atoms ({name}). "
                "Raise quality.instancing_threshold to use linked duplicates instead."
            ) from exc
