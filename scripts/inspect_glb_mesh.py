import bpy
import bmesh
import json
import sys

path = sys.argv[sys.argv.index("--") + 1]
bpy.ops.import_scene.gltf(filepath=path)
objects = []
for obj in bpy.context.scene.objects:
    if obj.type != "MESH":
        continue
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    seen = set()
    components = []
    for vertex in bm.verts:
        if vertex in seen:
            continue
        stack = [vertex]
        seen.add(vertex)
        members = []
        while stack:
            current = stack.pop()
            members.append(current)
            for edge in current.link_edges:
                for other in edge.verts:
                    if other not in seen:
                        seen.add(other)
                        stack.append(other)
        coords = [v.co for v in members]
        components.append({
            "vertices": len(members),
            "min": [round(min(getattr(v, axis) for v in coords), 4) for axis in "xyz"],
            "max": [round(max(getattr(v, axis) for v in coords), 4) for axis in "xyz"],
        })
    objects.append({
        "name": obj.name,
        "vertices": len(bm.verts),
        "faces": len(bm.faces),
        "boundaryEdges": sum(edge.is_boundary for edge in bm.edges),
        "components": sorted(components, key=lambda c: c["vertices"], reverse=True),
    })
    bm.free()
print(json.dumps(objects, indent=2))
