"""Bounds, lighting, world and backdrop."""

from __future__ import annotations

from math import pi, radians

from ...geom import look_at, screen_direction
from ...settings import Camera
from ..looks import SENSOR_WIDTH, camera_distance, ortho_scale


class WorldMixin:
    def setup_soft_lighting(self, target, extent: float, enabled: bool = True) -> None:
        bpy = self._bpy
        self._lighting_enabled = enabled
        if not enabled:
            return
        distance = max(3.8 * extent, 8.0)

        light_specs = self._look.lights

        for name, direction, energy, size in light_specs:
            obj = bpy.data.objects.get(name)
            if obj is None:
                light_data = bpy.data.lights.new(name=name, type="AREA")
                obj = bpy.data.objects.new(name=name, object_data=light_data)
                self._link(obj)
            light_data = obj.data
            light_data.energy = energy
            light_data.shape = "DISK"
            light_data.size = size
            obj.location, quat = look_at(target, direction, distance)
            obj.rotation_mode = "QUATERNION"
            obj.rotation_quaternion = quat

    def _place_suns(self, view_direction, up=None) -> None:
        """Sun lamps (parallel light) placed relative to the current view (`Look.suns` is screen-relative)."""
        bpy = self._bpy
        look = self._look
        wanted = {name for name, *_ in look.suns} if self._lighting_enabled else set()
        for obj in bpy.data.objects:
            if obj.type == "LIGHT" and obj.data.type == "SUN" and obj.name.startswith("PBB_"):
                obj.hide_render = obj.name not in wanted
        if not wanted:
            return
        for name, weights, strength, shadow in look.suns:
            obj = bpy.data.objects.get(name)
            if obj is None or obj.type != "LIGHT" or obj.data.type != "SUN":
                obj = bpy.data.objects.new(name, bpy.data.lights.new(name, type="SUN"))
                self._link(obj)
            obj.hide_render = False
            data = obj.data
            data.energy = strength
            data.angle = radians(look.shadow_softness)
            data.use_shadow = shadow
            _, quat = look_at((0.0, 0.0, 0.0), screen_direction(view_direction, weights, up), 1.0)
            obj.rotation_mode = "QUATERNION"
            obj.rotation_quaternion = quat

    def _apply_world(self) -> None:
        bpy = self._bpy
        world = bpy.context.scene.world
        if world is None:
            world = bpy.data.worlds.new("World")
            bpy.context.scene.world = world
        world.use_nodes = True
        nodes, links = world.node_tree.nodes, world.node_tree.links
        bg = nodes.get("Background")
        if bg is None:
            return
        r, g, b = self._look.world_color
        bg.inputs["Color"].default_value = (r, g, b, 1.0)
        bg.inputs["Strength"].default_value = self._look.world_strength
        for node in [n for n in nodes if n.name.startswith("PBB_")]:
            nodes.remove(node)
        output = nodes.get("World Output")
        if self._look.toon_bands and output is not None:
            # Toon bands need dim ambient light, but the picture background should stay the world colour:
            # camera rays see the full-strength world, everything else the dim one.
            seen = nodes.new("ShaderNodeBackground")
            seen.name = "PBB_WorldSeen"
            seen.inputs["Color"].default_value = (r, g, b, 1.0)
            seen.inputs["Strength"].default_value = 1.0
            path = nodes.new("ShaderNodeLightPath")
            path.name = "PBB_WorldPath"
            mix = nodes.new("ShaderNodeMixShader")
            mix.name = "PBB_WorldMix"
            links.new(path.outputs["Is Camera Ray"], mix.inputs["Fac"])
            links.new(bg.outputs["Background"], mix.inputs[1])
            links.new(seen.outputs["Background"], mix.inputs[2])
            links.new(mix.outputs["Shader"], output.inputs["Surface"])

    def setup_backdrop(self, target, extent: float, enabled: bool = True) -> None:
        bpy = self._bpy
        if not enabled:
            return
        size = max(14.0 * extent, 60.0)

        backdrop_material_name = "PBB_Backdrop_Mat"
        if backdrop_material_name not in bpy.data.materials:
            mat = bpy.data.materials.new(backdrop_material_name)
            mat.use_nodes = True
            principled = mat.node_tree.nodes.get("Principled BSDF")
            if principled is not None:
                principled.inputs["Base Color"].default_value = (0.985, 0.985, 0.99, 1.0)
                principled.inputs["Roughness"].default_value = 0.92
        else:
            mat = bpy.data.materials[backdrop_material_name]

        def ensure_plane(name: str):
            obj = bpy.data.objects.get(name)
            if obj is None:
                bpy.ops.mesh.primitive_plane_add(size=1.0, location=target)
                obj = bpy.context.object
                obj.name = name
                self._move_to_collection(obj)
            obj.scale = (size, size, 1.0)
            obj.data.materials.clear()
            obj.data.materials.append(mat)
            return obj

        floor = ensure_plane("PBB_Backdrop_Floor")
        floor.location = (target[0], target[1], target[2] - 4.0 * extent)
        floor.rotation_euler = (0.0, 0.0, 0.0)

        back = ensure_plane("PBB_Backdrop_Wall")
        back.location = (target[0], target[1] + 8.5 * extent, target[2])
        back.rotation_euler = (pi / 2.0, 0.0, 0.0)

        if self._transparent_background:
            for obj in (floor, back):
                if hasattr(obj, "visible_camera"):
                    obj.visible_camera = False
                if hasattr(obj, "cycles_visibility") and hasattr(obj.cycles_visibility, "camera"):
                    obj.cycles_visibility.camera = False
            if hasattr(floor, "is_shadow_catcher"):
                floor.is_shadow_catcher = True
        else:
            for obj in (floor, back):
                if hasattr(obj, "visible_camera"):
                    obj.visible_camera = True
                if hasattr(obj, "cycles_visibility") and hasattr(obj.cycles_visibility, "camera"):
                    obj.cycles_visibility.camera = True
            if hasattr(floor, "is_shadow_catcher"):
                floor.is_shadow_catcher = False

    def set_camera(self, camera: Camera, extent: float) -> None:
        """Place the single scene camera. `camera.target` is in the runner's recentred coordinates."""
        bpy = self._bpy
        location, quat = look_at(camera.target, camera.direction, camera_distance(extent, camera.zoom), camera.up)
        obj = bpy.data.objects.get("PBB_Camera")
        if obj is None or obj.type != "CAMERA":
            obj = bpy.data.objects.new("PBB_Camera", bpy.data.cameras.new("PBB_Camera"))
            bpy.context.scene.collection.objects.link(obj)
        data = obj.data
        data.sensor_width = SENSOR_WIDTH
        data.sensor_fit = "AUTO"
        data.clip_end = max(data.clip_end, 10.0 * (camera_distance(extent, camera.zoom) + extent))
        if camera.projection == "ortho":
            data.type = "ORTHO"
            data.ortho_scale = ortho_scale(extent, camera.zoom)
        else:
            data.type = "PERSP"
            data.lens = camera.lens
        obj.location = location
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = quat
        bpy.context.scene.camera = obj
        self._place_suns(camera.direction, camera.up)
        self._update_axes_overlay_transform()
