"""Axis indicator: three arrows and their labels (a/b/c or x/y/z), fixed to a corner of the frame and
oriented like the world as seen from the camera. The flat layout comes from `geom.triad_layout`."""

from __future__ import annotations

from dataclasses import replace

from ...geom import disc, lerp, triad_draw, triad_layout
from ..looks import (
    AXES_ARROW_RADIUS,
    AXES_DOT_RADIUS,
    AXES_HEAD_LENGTH_RATIO,
    AXES_HEAD_RADIUS_RATIO,
    AXES_LABEL_PAD,
    AXES_LABEL_REACH,
    AXES_LABEL_SIZE,
    DEPTH_FADE_MAX,
)

AXES_DOT_SIDES = 32  # the origin ball's outline: smooth at the triad's size
HUB_OBJECT = "PBB_AxisHub"  # the origin ball; the name starts with PBB_Axis, so a rebuild removes it


class AxesOverlayMixin:
    def set_axes_overlay(self, axes) -> None:
        """Build (or, for None, remove) the indicator. `axes` is a `protocols.AxesSpec`, validated upstream."""
        bpy = self._bpy
        for obj in [o for o in bpy.data.objects if o.name.startswith(("PBB_Axes_", "PBB_Axis"))]:
            bpy.data.objects.remove(obj, do_unlink=True)
        self._axes = axes
        if axes is None:
            return
        anchor = bpy.data.objects.new("PBB_Axes_Anchor", None)
        anchor.empty_display_size = 0.2
        self._link(anchor)
        for index, (label, material) in enumerate(zip(axes.labels, axes.materials, strict=True)):
            for part in ("shaft", "head"):
                mesh = bpy.data.meshes.new(f"PBB_Axis_{index}_{part}")
                mesh.materials.append(bpy.data.materials[material])
                arrow = bpy.data.objects.new(f"PBB_Axis_{index}_{part}", mesh)
                self._link(arrow)
                self._exclude_from_outline(arrow)
                arrow.parent = anchor
                arrow.visible_shadow = False
            self._add_label(index, label, material, anchor, axes.font)
        hub = bpy.data.meshes.new("PBB_Axis_hub")
        hub.materials.append(bpy.data.materials[axes.hub])
        ball = bpy.data.objects.new(HUB_OBJECT, hub)
        self._link(ball)
        self._exclude_from_outline(ball)
        ball.parent = anchor
        ball.visible_shadow = False
        self._update_axes_overlay_transform()

    def _add_label(self, index: int, text: str, material: str, anchor, font: str | None) -> None:
        bpy = self._bpy
        curve = bpy.data.curves.new(f"PBB_AxisLabel_{index}", type="FONT")
        curve.body = text
        curve.align_x = "CENTER"
        curve.align_y = "CENTER"
        if font:  # else Blender's built-in font
            curve.font = bpy.data.fonts.load(font, check_existing=True)
        curve.materials.append(bpy.data.materials[material])
        obj = bpy.data.objects.new(f"PBB_AxisLabel_{index}", curve)
        self._link(obj)
        obj.parent = anchor
        obj.visible_shadow = False
        self._exclude_from_outline(obj)

    def _update_axes_overlay_transform(self) -> None:
        axes = self._axes
        if axes is None:
            return
        bpy = self._bpy
        camera = bpy.context.scene.camera
        if camera is None or camera.type != "CAMERA":
            return
        anchor = bpy.data.objects["PBB_Axes_Anchor"]
        if anchor.parent is not camera:
            anchor.parent = camera
            anchor.matrix_parent_inverse = self._mathutils.Matrix.Identity(4)

        frame = camera.data.view_frame(scene=bpy.context.scene)
        xs = [float(v.x) for v in frame]
        ys = [float(v.y) for v in frame]
        z_ref = sum(float(v.z) for v in frame) / len(frame)
        width = max(max(xs) - min(xs), 1e-6)
        height = max(max(ys) - min(ys), 1e-6)
        size = max(min(width, height) * axes.size, 1e-4)
        # The triad is flat, in a plane parallel to the image plane, so a perspective camera only scales it:
        # the frame at depth d is the reference frame times d / |z_ref|, and everything is scaled by the same k.
        # The plane sits in front of the near clip plane; an orthographic frame does not depend on depth.
        depth = abs(z_ref) + 3.0 * size
        k = depth / abs(z_ref) if camera.data.type == "PERSP" else 1.0
        anchor.location = ((min(xs) + axes.margin * width) * k, (min(ys) + axes.margin * height) * k, -depth)
        anchor.rotation_euler = (0.0, 0.0, 0.0)
        length = size * k
        layout = triad_layout(
            axes.directions,
            tuple(camera.rotation_quaternion),
            length,
            arrow_radius=AXES_ARROW_RADIUS,
            head_length_ratio=AXES_HEAD_LENGTH_RATIO,
            head_radius_ratio=AXES_HEAD_RADIUS_RATIO,
            label_reach=AXES_LABEL_REACH,
            label_pad=AXES_LABEL_PAD,
        )
        # Back to front, as the page draws them: the origin ball lies between the axes pointing away (they go under
        # it, so it covers their roots) and the rest. Nearer items lie a hair in front of farther ones (the plane is
        # flat, depth only decides overlap). None stands for the ball.
        draw = triad_draw([item.depth for item in layout], DEPTH_FADE_MAX)
        stack = (*draw.order[: draw.behind], None, *draw.order[draw.behind :])
        for rank, index in enumerate(stack):
            z = (rank + 1) * 0.002 * length
            if index is None:
                self._set_flat_shape(bpy.data.objects[HUB_OBJECT], disc(AXES_DOT_RADIUS * length, AXES_DOT_SIDES), z)
                continue
            for part, shape in (("shaft", layout[index].shaft), ("head", layout[index].head)):
                self._set_flat_shape(bpy.data.objects[f"PBB_Axis_{index}_{part}"], shape, z)
            label = bpy.data.objects[f"PBB_AxisLabel_{index}"]
            label.location = (layout[index].label[0], layout[index].label[1], z)
            label.data.size = AXES_LABEL_SIZE * length
            label.rotation_euler = (0.0, 0.0, 0.0)
        # An axis fades (its shaft, head and label share its material) toward the background by how far it points away.
        for index, shader in enumerate(axes.shaders):
            base = shader.base_color
            mixed = (*lerp(base[:3], axes.background, draw.fades[index]), base[3])
            self.ensure_material(axes.materials[index], replace(shader, base_color=mixed))

    @staticmethod
    def _set_flat_shape(obj, shape, z: float) -> None:
        """Replace the mesh of `obj` with the polygon `shape` (image-plane points), at depth `z`; empty for no shape."""
        mesh = obj.data
        mesh.clear_geometry()
        if shape:
            mesh.from_pydata([(x, y, z) for x, y in shape], [], [tuple(range(len(shape)))])
