"""Create a non-destructive review candidate with a narrower face-side span."""
import json
import math
import struct
import sys
from pathlib import Path


def main():
    source, output = map(Path, sys.argv[1:3])
    factor = float(sys.argv[3]) if len(sys.argv) > 3 else 0.42
    raw = source.read_bytes()
    offset = 12
    doc = binary = None
    while offset < len(raw):
        size, kind = struct.unpack_from("<II", raw, offset)
        offset += 8
        chunk = raw[offset:offset + size]
        offset += size
        if kind == 0x4E4F534A:
            doc = json.loads(chunk.decode().rstrip(" \t\r\n\0"))
        elif kind == 0x004E4942:
            binary = bytearray(chunk)

    primitive = doc["meshes"][0]["primitives"][0]
    positions_accessor = doc["accessors"][primitive["attributes"]["POSITION"]]
    position_view = doc["bufferViews"][positions_accessor["bufferView"]]
    position_start = position_view.get("byteOffset", 0) + positions_accessor.get("byteOffset", 0)
    positions = [list(struct.unpack_from("<3f", binary, position_start + i * 12)) for i in range(positions_accessor["count"])]
    hinge = -35.0
    for i, p in enumerate(positions):
        if p[0] > hinge:
            p[0] = hinge + (p[0] - hinge) * factor
        struct.pack_into("<3f", binary, position_start + i * 12, *p)

    indices_accessor = doc["accessors"][primitive["indices"]]
    indices_view = doc["bufferViews"][indices_accessor["bufferView"]]
    index_start = indices_view.get("byteOffset", 0) + indices_accessor.get("byteOffset", 0)
    indices = struct.unpack_from("<%dH" % indices_accessor["count"], binary, index_start)
    normal_accessor = doc["accessors"][primitive["attributes"]["NORMAL"]]
    normal_view = doc["bufferViews"][normal_accessor["bufferView"]]
    normal_start = normal_view.get("byteOffset", 0) + normal_accessor.get("byteOffset", 0)
    normals = [[0.0, 0.0, 0.0] for _ in positions]
    for i in range(0, len(indices), 3):
        ia, ib, ic = indices[i:i + 3]
        a, b, c = positions[ia], positions[ib], positions[ic]
        u = [b[k] - a[k] for k in range(3)]
        v = [c[k] - a[k] for k in range(3)]
        n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
        for ix in (ia, ib, ic):
            for k in range(3):
                normals[ix][k] += n[k]
    for i, n in enumerate(normals):
        length = math.sqrt(sum(x * x for x in n)) or 1.0
        struct.pack_into("<3f", binary, normal_start + i * 12, *(x / length for x in n))

    xs = [p[0] for p in positions]
    positions_accessor["min"][0] = min(xs)
    positions_accessor["max"][0] = max(xs)
    json_chunk = json.dumps(doc, separators=(",", ":")).encode()
    json_chunk += b" " * ((4 - len(json_chunk) % 4) % 4)
    binary += b"\0" * ((4 - len(binary) % 4) % 4)
    total = 12 + 8 + len(json_chunk) + 8 + len(binary)
    output.write_bytes(b"glTF" + struct.pack("<II", 2, total) + struct.pack("<II", len(json_chunk), 0x4E4F534A) + json_chunk + struct.pack("<II", len(binary), 0x004E4942) + binary)
    print(json.dumps({"output": str(output), "factor": factor, "hingeX": hinge, "boundsX": [min(xs), max(xs)]}))


if __name__ == "__main__":
    main()
