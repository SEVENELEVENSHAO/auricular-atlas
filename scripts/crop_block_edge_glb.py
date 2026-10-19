"""Create a capped GLB candidate by shaving the far outer block edge."""
import json
import math
import struct
import sys
from pathlib import Path


JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942


def read_glb(path):
    data = Path(path).read_bytes()
    if data[:4] != b"glTF":
        raise ValueError("Not a GLB file")
    offset = 12
    doc = binary = None
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset:offset + length]
        offset += length
        if kind == JSON_CHUNK:
            doc = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\0"))
        elif kind == BIN_CHUNK:
            binary = chunk
    if doc is None or binary is None:
        raise ValueError("Incomplete GLB")
    return doc, binary


def write_glb(path, doc, binary):
    doc["buffers"][0]["byteLength"] = len(binary)
    json_chunk = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    json_chunk += b" " * ((4 - len(json_chunk) % 4) % 4)
    binary += b"\0" * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(json_chunk) + 8 + len(binary)
    data = b"glTF" + struct.pack("<II", 2, total)
    data += struct.pack("<II", len(json_chunk), JSON_CHUNK) + json_chunk
    data += struct.pack("<II", len(binary), BIN_CHUNK) + binary
    Path(path).write_bytes(data)


def accessor_data(doc, binary, accessor_id):
    accessor = doc["accessors"][accessor_id]
    view = doc["bufferViews"][accessor["bufferView"]]
    start = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    if accessor["componentType"] == 5126 and accessor["type"] == "VEC3":
        return [struct.unpack_from("<3f", binary, start + i * 12) for i in range(accessor["count"])]
    if accessor["componentType"] == 5123 and accessor["type"] == "SCALAR":
        return struct.unpack_from("<%dH" % accessor["count"], binary, start)
    raise ValueError("Unsupported accessor layout")


def interpolate(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def clip_triangle(attributes, cut_x):
    polygon = attributes
    output = []
    for current, following in zip(polygon, polygon[1:] + polygon[:1]):
        inside_current = current[0][0] >= cut_x
        inside_following = following[0][0] >= cut_x
        if inside_current and inside_following:
            output.append(following)
        elif inside_current and not inside_following:
            t = (cut_x - current[0][0]) / (following[0][0] - current[0][0])
            output.append((interpolate(current[0], following[0], t), interpolate(current[1], following[1], t)))
        elif not inside_current and inside_following:
            t = (cut_x - current[0][0]) / (following[0][0] - current[0][0])
            output.append((interpolate(current[0], following[0], t), interpolate(current[1], following[1], t)))
            output.append(following)
    deduped = []
    for item in output:
        if not deduped or math.dist(item[0], deduped[-1][0]) > 1e-8:
            deduped.append(item)
    if len(deduped) > 1 and math.dist(deduped[0][0], deduped[-1][0]) <= 1e-8:
        deduped.pop()
    return deduped


def normalize(vector):
    length = math.sqrt(sum(v * v for v in vector))
    if length < 1e-12:
        return (0.0, 0.0, 1.0)
    return tuple(v / length for v in vector)


def endpoint_key(point, tolerance=1e-4):
    return round(point[1] / tolerance), round(point[2] / tolerance)


def loops_from_segments(segments):
    points = {}
    adjacency = {}
    for a, b in segments:
        ka, kb = endpoint_key(a), endpoint_key(b)
        points[ka], points[kb] = a, b
        adjacency.setdefault(ka, []).append(kb)
        adjacency.setdefault(kb, []).append(ka)
    if any(len(neighbors) != 2 for neighbors in adjacency.values()):
        bad = sum(len(neighbors) != 2 for neighbors in adjacency.values())
        raise ValueError("Cut boundary is not a set of closed loops (%d irregular vertices)" % bad)
    loops = []
    unseen = set(adjacency)
    while unseen:
        start = next(iter(unseen))
        loop = [start]
        previous = None
        current = start
        while True:
            following = next(key for key in adjacency[current] if key != previous)
            if following == start:
                break
            if following in loop:
                raise ValueError("Cut boundary self-intersects or branches")
            loop.append(following)
            previous, current = current, following
        unseen.difference_update(loop)
        loops.append([points[key] for key in loop])
    return loops


def cross2(a, b, c):
    return (b[1] - a[1]) * (c[2] - b[2]) - (b[2] - a[2]) * (c[1] - b[1])


def point_in_triangle(p, a, b, c, orientation):
    epsilon = 1e-8
    values = (cross2(a, b, p), cross2(b, c, p), cross2(c, a, p))
    return all(orientation * value >= -epsilon for value in values)


def triangulate_cap(loop):
    polygon = list(loop)
    area = sum(polygon[i][1] * polygon[(i + 1) % len(polygon)][2] - polygon[(i + 1) % len(polygon)][1] * polygon[i][2] for i in range(len(polygon)))
    orientation = 1 if area > 0 else -1
    if area < 0:
        polygon.reverse()
    indices = list(range(len(polygon)))
    triangles = []
    while len(indices) > 3:
        found = False
        for slot, current in enumerate(indices):
            previous = indices[slot - 1]
            following = indices[(slot + 1) % len(indices)]
            a, b, c = polygon[previous], polygon[current], polygon[following]
            if orientation * cross2(a, b, c) <= 1e-9:
                continue
            if any(point_in_triangle(polygon[other], a, b, c, orientation) for other in indices if other not in (previous, current, following)):
                continue
            triangles.append((previous, current, following))
            del indices[slot]
            found = True
            break
        if not found:
            raise ValueError("Could not triangulate cut cap without overlap")
    triangles.append(tuple(indices))
    # The retained mesh is on +X; the cap's outward normal must face -X.
    if orientation > 0:
        triangles = [(a, c, b) for a, b, c in triangles]
    return polygon, triangles


def main():
    source = Path(sys.argv[1])
    output = Path(sys.argv[2])
    cut_x = float(sys.argv[3]) if len(sys.argv) > 3 else -73.5
    rotate_starter = len(sys.argv) > 4 and sys.argv[4] == "rotate-starter"
    doc, binary = read_glb(source)
    if len(doc["meshes"]) != 1 or len(doc["meshes"][0]["primitives"]) != 1:
        raise ValueError("Expected one mesh primitive")
    primitive = doc["meshes"][0]["primitives"][0]
    positions = accessor_data(doc, binary, primitive["attributes"]["POSITION"])
    normals = accessor_data(doc, binary, primitive["attributes"]["NORMAL"])
    indices = accessor_data(doc, binary, primitive["indices"])
    if len(indices) % 3:
        raise ValueError("Index accessor is not triangles")

    out_positions, out_normals, out_indices = [], [], []
    segments = []
    for offset in range(0, len(indices), 3):
        tri = indices[offset:offset + 3]
        source_attrs = [(positions[i], normals[i]) for i in tri]
        hits = []
        for (pa, _), (pb, _) in zip(source_attrs, source_attrs[1:] + source_attrs[:1]):
            da, db = pa[0] - cut_x, pb[0] - cut_x
            if da * db < 0:
                t = -da / (db - da)
                hits.append(interpolate(pa, pb, t))
        if len(hits) == 2:
            segments.append((hits[0], hits[1]))

        clipped = clip_triangle(source_attrs, cut_x)
        if len(clipped) < 3:
            continue
        base = len(out_positions)
        for position, normal in clipped:
            out_positions.append(position)
            out_normals.append(normalize(normal))
        for corner in range(1, len(clipped) - 1):
            out_indices.extend((base, base + corner, base + corner + 1))

    loops = loops_from_segments(segments)
    cap_triangle_count = 0
    for loop in loops:
        polygon, triangles = triangulate_cap(loop)
        base = len(out_positions)
        for point in polygon:
            out_positions.append((cut_x, point[1], point[2]))
            out_normals.append((-1.0, 0.0, 0.0))
        for triangle in triangles:
            out_indices.extend(base + index for index in triangle)
        cap_triangle_count += len(triangles)

    if rotate_starter:
        out_positions = [(-x, y, -z) for x, y, z in out_positions]
        out_normals = [(-x, y, -z) for x, y, z in out_normals]

    bounds_min = [min(point[axis] for point in out_positions) for axis in range(3)]
    bounds_max = [max(point[axis] for point in out_positions) for axis in range(3)]
    position_bytes = b"".join(struct.pack("<3f", *point) for point in out_positions)
    normal_bytes = b"".join(struct.pack("<3f", *normal) for normal in out_normals)
    index_bytes = struct.pack("<%dI" % len(out_indices), *out_indices)
    output_binary = bytearray(binary)
    buffer_views = doc.setdefault("bufferViews", [])
    accessors = doc["accessors"]

    def append_data(data, target):
        output_binary.extend(b"\0" * ((4 - len(output_binary) % 4) % 4))
        view_id = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": len(output_binary),
            "byteLength": len(data),
            "target": target,
        })
        output_binary.extend(data)
        return view_id

    position_view = append_data(position_bytes, 34962)
    normal_view = append_data(normal_bytes, 34962)
    index_view = append_data(index_bytes, 34963)
    new_accessors = [
        {"bufferView": 0, "componentType": 5126, "count": len(out_positions), "type": "VEC3", "min": bounds_min, "max": bounds_max},
        {"bufferView": 1, "componentType": 5126, "count": len(out_normals), "type": "VEC3"},
        {"bufferView": 2, "componentType": 5125, "count": len(out_indices), "type": "SCALAR", "min": [min(out_indices)], "max": [max(out_indices)]},
    ]
    new_accessors[0]["bufferView"] = position_view
    new_accessors[1]["bufferView"] = normal_view
    new_accessors[2]["bufferView"] = index_view
    accessor_start = len(accessors)
    accessors.extend(new_accessors)
    primitive["attributes"]["POSITION"] = accessor_start
    primitive["attributes"]["NORMAL"] = accessor_start + 1
    primitive["indices"] = accessor_start + 2
    output.parent.mkdir(parents=True, exist_ok=True)
    write_glb(output, doc, bytes(output_binary))
    print(json.dumps({
        "source": str(source),
        "output": str(output),
        "cutX": cut_x,
        "rotatedForStarterView": rotate_starter,
        "bounds": [bounds_min, bounds_max],
        "vertices": len(out_positions),
        "triangles": len(out_indices) // 3,
        "capLoops": len(loops),
        "capTriangles": cap_triangle_count,
    }, indent=2))


if __name__ == "__main__":
    main()
