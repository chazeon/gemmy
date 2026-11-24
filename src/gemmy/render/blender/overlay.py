"""Axis indicator: three arrows and their labels (a/b/c or x/y/z), fixed to a corner of the frame and
oriented like the world as seen from the camera. The flat layout comes from `geom.triad_layout`."""

from __future__ import annotations

from ...geom import triad_layout
from ..looks import (
    AXES_ARROW_RADIUS,
    AXES_HEAD_LENGTH_RATIO,
    AXES_HEAD_RADIUS_RATIO,
    AXES_LABEL_PAD,
    AXES_LABEL_REACH,
    AXES_LABEL_SIZE,
)


class AxesOverlayMixin:
    def set_axes_overlay(self, axes) -> None:
        """Build (or, for None, remove) the indicator. `axes` is a `runner.AxesSpec`, validated upstream."""
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
        # Nearer axes lie a hair in front of farther ones (the plane is flat, depth only decides overlap).
        order = sorted(range(len(layout)), key=lambda i: layout[i].depth)
        for rank, index in enumerate(order):
            z = (rank + 1) * 0.002 * length
            for part, shape in (("shaft", layout[index].shaft), ("head", layout[index].head)):
                mesh = bpy.data.objects[f"PBB_Axis_{index}_{part}"].data
                mesh.clear_geometry()
                if shape:
                    mesh.from_pydata([(x, y, z) for x, y in shape], [], [tuple(range(len(shape)))])
            label = bpy.data.objects[f"PBB_AxisLabel_{index}"]
            label.location = (layout[index].label[0], layout[index].label[1], z)
            label.data.size = AXES_LABEL_SIZE * length
            label.rotation_euler = (0.0, 0.0, 0.0)
