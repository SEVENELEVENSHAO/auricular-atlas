import argparse
import json
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--object", default="_gltfNode_10")
    parser.add_argument("--cut-x", type=float, default=-34.0)
    parser.add_argument("--preview", required=True)
    blender_args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    args = parser.parse_args(blender_args)

    source = Path(args.source)
    output = Path(args.output)
    preview = Path(args.preview)
    bpy.ops.wm.open_mainfile(filepath=str(source))

    obj = bpy.data.objects.get(args.object)
    if obj is None or obj.type != "MESH":
        raise RuntimeError(f"Mesh object not found: {args.object}")

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.verts.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    bm.faces.ensure_lookup_table()

    cut = Vector((args.cut_x, 0, 0))
    cut_result = bmesh.ops.bisect_plane(
        bm,
        geom=list(bm.verts) + list(bm.edges) + list(bm.faces),
        plane_co=cut,
        plane_no=Vector((1, 0, 0)),
        dist=1e-5,
        clear_inner=False,
        clear_outer=False,
    )
    faces_to_remove = [f for f in bm.faces if f.calc_center_median().x < args.cut_x - 1e-5]
    bmesh.ops.delete(bm, geom=faces_to_remove, context="FACES_ONLY")
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_edges], context="VERTS")
    cut_verts = [
        v for v in cut_result["geom_cut"]
        if isinstance(v, bmesh.types.BMVert)
        and v.is_valid
        and abs(v.co.x - args.cut_x) < 1e-4
    ]
    cut_verts = list({v.index: v for v in cut_verts}.values())
    if len(cut_verts) < 3:
        bm.free()
        raise RuntimeError("The cut produced fewer than three boundary vertices.")
    # The scan's cut is usually an open, noisy chain. Project the section onto YZ,
    # sort around its centroid, and triangulate a single flat cap.
    section_center = Vector((args.cut_x, sum(v.co.y for v in cut_verts) / len(cut_verts), sum(v.co.z for v in cut_verts) / len(cut_verts)))
    import math
    cut_verts.sort(key=lambda v: math.atan2(v.co.z - section_center.z, v.co.y - section_center.y))
    cap_face = bm.faces.new(cut_verts)
    cap_face.normal_update()
    filled = [cap_face]

    for face in filled:
        face.normal_update()
        if face.normal.x < 0:
            face.normal_flip()
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    obj.data.update()
    bm.free()

    for other in list(bpy.context.scene.objects):
        if other != obj:
            bpy.data.objects.remove(other, do_unlink=True)
    obj.name = "Auricular Atlas Ear"
    obj.data.name = "Auricular Atlas Ear Surface"
    obj.location = (0, 0, 0)
    obj.rotation_euler = (0, 0, 0)
    obj.scale = (1, 1, 1)
    obj.data.materials.clear()

    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    output.parent.mkdir(parents=True, exist_ok=True)
    ext = output.suffix.lower()
    if ext == ".stl":
        bpy.ops.wm.stl_export(filepath=str(output), export_selected_objects=True)
    elif ext == ".obj":
        bpy.ops.wm.obj_export(filepath=str(output), export_materials=False, export_selected_objects=True)
    elif ext == ".glb":
        bpy.ops.export_scene.gltf(filepath=str(output), export_format="GLB", use_selection=True)
    else:
        raise RuntimeError("Output extension must be .stl or .obj")

    scene = bpy.context.scene
    camera_data = bpy.data.cameras.new("Atlas Preview Camera")
    camera = bpy.data.objects.new("Atlas Preview Camera", camera_data)
    scene.collection.objects.link(camera)
    corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    bbox_min = Vector((min(v.x for v in corners), min(v.y for v in corners), min(v.z for v in corners)))
    bbox_max = Vector((max(v.x for v in corners), max(v.y for v in corners), max(v.z for v in corners)))
    center = (bbox_min + bbox_max) * 0.5
    camera.location = center + Vector((0, -180, 0))
    camera.rotation_euler = (center - camera.location).to_track_quat("-Z", "Y").to_euler()
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(bbox_max.x - bbox_min.x, bbox_max.z - bbox_min.z) * 1.3
    scene.camera = camera
    material = bpy.data.materials.new("Preview skin")
    material.diffuse_color = (0.69, 0.42, 0.35, 1)
    obj.data.materials.append(material)
    light_data = bpy.data.lights.new("Atlas Preview Key", "AREA")
    light = bpy.data.objects.new("Atlas Preview Key", light_data)
    scene.collection.objects.link(light)
    light.location = center + Vector((80, -100, 110))
    light_data.energy = 12000
    light_data.size = 90
    light.rotation_euler = (center - light.location).to_track_quat("-Z", "Y").to_euler()
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1000
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(preview)
    preview.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)

    result = {
        "output": str(output),
        "preview": str(preview),
        "mesh": obj.name,
        "vertices": len(obj.data.vertices),
        "triangles": sum(max(0, len(p.vertices) - 2) for p in obj.data.polygons),
        "cutX": args.cut_x,
        "capFaces": len(filled),
    }
    print("AURICULAR_ATLAS_RESULT=" + json.dumps(result))


if __name__ == "__main__":
    main()
