"""Material creation from a resolved ShaderSpec (no name-based special cases)."""

from __future__ import annotations

from ..materials import ShaderSpec


class MaterialsMixin:
    def ensure_material(self, name: str, spec: ShaderSpec) -> None:
        bpy = self._bpy
        mat = bpy.data.materials.get(name)
        if mat is None:
            mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        principled = nodes.get("Principled BSDF")
        output = nodes.get("Material Output")
        if principled is not None:
            inputs = principled.inputs
            inputs["Base Color"].default_value = spec.base_color
            inputs["Roughness"].default_value = spec.roughness
            inputs["Metallic"].default_value = spec.metallic
            inputs["Alpha"].default_value = spec.alpha
            for key in ("Transmission Weight", "Transmission"):
                if key in inputs:
                    inputs[key].default_value = spec.transmission
            if "IOR" in inputs:
                inputs["IOR"].default_value = spec.ior
            if spec.emission > 0.0:
                for key in ("Emission Color", "Emission"):
                    if key in inputs:
                        inputs[key].default_value = spec.base_color
                if "Emission Strength" in inputs:
                    inputs["Emission Strength"].default_value = spec.emission
                inputs["Base Color"].default_value = (0.0, 0.0, 0.0, spec.base_color[3])
            if spec.specular is not None:
                for key in ("Specular IOR Level", "Specular"):
                    if key in inputs:
                        inputs[key].default_value = spec.specular

        self._toon_chain(mat, spec)

        volume_name = "PBB_Poly_VolumeAbsorption"
        volume = nodes.get(volume_name)
        if spec.absorption_density > 0.0 and output is not None:
            if volume is None:
                volume = nodes.new("ShaderNodeVolumeAbsorption")
                volume.name = volume_name
            volume.inputs["Color"].default_value = spec.base_color
            volume.inputs["Density"].default_value = spec.absorption_density
            links.new(volume.outputs[0], output.inputs["Volume"])
        elif volume is not None:
            nodes.remove(volume)

        # blend_method / shadow_method were removed in newer Blender; set them only if present.
        blend = "HASHED" if spec.hashed else "OPAQUE"
        if hasattr(mat, "blend_method"):
            mat.blend_method = blend
        if hasattr(mat, "shadow_method"):
            mat.shadow_method = blend
        if spec.blended:
            mat.use_backface_culling = True  # one layer per polyhedron, so stacked ghosts stay see-through
            if hasattr(mat, "surface_render_method"):  # Blender 4.2+: EEVEE Next
                mat.surface_render_method = "BLENDED"
            elif hasattr(mat, "blend_method"):
                mat.blend_method = "BLEND"
        if hasattr(mat, "use_screen_refraction"):
            mat.use_screen_refraction = spec.hashed or spec.transmission > 0.0

    def _toon_chain(self, mat, spec: ShaderSpec) -> None:
        """Diffuse -> Shader to RGB -> constant ColorRamp -> Emission -> output (EEVEE; shadows band naturally)."""
        nodes = mat.node_tree.nodes
        links = mat.node_tree.links
        for node in [n for n in nodes if n.name.startswith("PBB_Toon")]:
            nodes.remove(node)
        output = nodes.get("Material Output")
        if not spec.bands or output is None:
            principled = nodes.get("Principled BSDF")
            if principled is not None and output is not None and not output.inputs["Surface"].links:
                links.new(principled.outputs["BSDF"], output.inputs["Surface"])
            return
        diffuse = nodes.new("ShaderNodeBsdfDiffuse")
        to_rgb = nodes.new("ShaderNodeShaderToRGB")
        ramp = nodes.new("ShaderNodeValToRGB")
        emission = nodes.new("ShaderNodeEmission")
        for node, suffix in ((diffuse, "Diffuse"), (to_rgb, "ToRGB"), (ramp, "Ramp"), (emission, "Emission")):
            node.name = f"PBB_Toon_{suffix}"
        diffuse.inputs["Color"].default_value = (1.0, 1.0, 1.0, 1.0)
        elements = ramp.color_ramp.elements
        while len(elements) > 1:
            elements.remove(elements[-1])
        ramp.color_ramp.interpolation = "CONSTANT"
        r, g, b, a = spec.base_color
        for index, (threshold, brightness) in enumerate(spec.bands):
            element = elements[0] if index == 0 else elements.new(threshold)
            element.position = threshold
            element.color = (r * brightness, g * brightness, b * brightness, a)
        links.new(diffuse.outputs["BSDF"], to_rgb.inputs["Shader"])
        links.new(to_rgb.outputs["Color"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], emission.inputs["Color"])
        if not spec.blended:
            links.new(emission.outputs["Emission"], output.inputs["Surface"])
            return
        transparent = nodes.new("ShaderNodeBsdfTransparent")
        mix = nodes.new("ShaderNodeMixShader")
        transparent.name, mix.name = "PBB_Toon_Transparent", "PBB_Toon_Mix"
        mix.inputs["Fac"].default_value = spec.alpha  # 0 = fully transparent, 1 = the toon fill
        links.new(transparent.outputs["BSDF"], mix.inputs[1])
        links.new(emission.outputs["Emission"], mix.inputs[2])
        links.new(mix.outputs["Shader"], output.inputs["Surface"])
