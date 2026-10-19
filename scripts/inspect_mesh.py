import bpy
import bmesh
import json
import sys

source = sys.argv[sys.argv.index("--") + 1]
obj_name = sys.argv[sys.argv.index("--") + 2]
bpy.ops.wm.open_mainfile(filepath=source)
o = bpy.data.objects[obj_name]
bm = bmesh.new()
bm.from_mesh(o.data)
seen = set()
components = []
for v in bm.verts:
    if v in seen:
        continue
    stack = [v]
    seen.add(v)
    n = 0
    while stack:
        q = stack.pop()
        n += 1
        for e in q.link_edges:
            for w in e.verts:
                if w not in seen:
                    seen.add(w)
                    stack.append(w)
    components.append(n)
print(json.dumps({"components": sorted(components, reverse=True)[:50], "count": len(components)}))
bm.free()
