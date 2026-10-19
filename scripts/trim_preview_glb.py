"""Create a review candidate with the broad face slab cropped away.

This keeps the source GLB unchanged and only removes triangles whose complete
face lies beyond the crop on the face-slab side of the fused scan.
"""
import json
import struct
import sys
from pathlib import Path


def read_glb(path):
    data = Path(path).read_bytes()
    if data[:4] != b"glTF":
        raise ValueError("Not a GLB file")
    offset = 12
    doc = None
    binary = None
    while offset < len(data):
        length, kind = struct.unpack_from("<II", data, offset)
        offset += 8
        chunk = data[offset:offset + length]
        offset += length
        if kind == 0x4E4F534A:
            doc = json.loads(chunk.decode("utf-8").rstrip(" \t\r\n\0"))
        elif kind == 0x004E4942:
            binary = chunk
    if doc is None or binary is None:
        raise ValueError("Incomplete GLB")
    return doc, binary


def write_glb(path, doc, binary):
    json_chunk = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    json_chunk += b" " * ((4 - len(json_chunk) % 4) % 4)
    binary += b"\0" * ((4 - len(binary) % 4) % 4)
    payload = b"glTF" + struct.pack("<II", 2, 12 + 8 + len(json_chunk) + 8 + len(binary))
    payload += struct.pack("<II", len(json_chunk), 0x4E4F534A) + json_chunk
    payload += struct.pack("<II", len(binary), 0x004E4942) + binary
    Path(path).write_bytes(payload)


def main():
    source, output, cut = sys.argv[1], sys.argv[2], float(sys.argv[3])
    keep_face = len(sys.argv) > 4 and sys.argv[4] == "keep-face"
    doc, binary = read_glb(source)
    mesh = doc["meshes"][0]["primitives"][0]
    pos_accessor = doc["accessors"][mesh["attributes"]["POSITION"]]
    pos_view = doc["bufferViews"][pos_accessor["bufferView"]]
    pos_base = pos_view.get("byteOffset", 0) + pos_accessor.get("byteOffset", 0)
    positions = [struct.unpack_from("<3f", binary, pos_base + i * 12) for i in range(pos_accessor["count"])]
    idx_accessor = doc["accessors"][mesh["indices"]]
    idx_view = doc["bufferViews"][idx_accessor["bufferView"]]
    idx_base = idx_view.get("byteOffset", 0) + idx_accessor.get("byteOffset", 0)
    indices = struct.unpack_from("<%dH" % idx_accessor["count"], binary, idx_base)
    kept = []
    for i in range(0, len(indices), 3):
        tri = indices[i:i + 3]
        inside = (lambda x: x >= cut) if keep_face else (lambda x: x <= cut)
        if len(tri) == 3 and all(inside(positions[v][0]) for v in tri):
            kept.extend(tri)
    new_indices = struct.pack("<%dH" % len(kept), *kept)
    new_binary = bytearray(binary)
    new_view = doc["bufferViews"][idx_accessor["bufferView"]]
    start = new_view.get("byteOffset", 0)
    new_binary[start:start + len(new_indices)] = new_indices
    del new_binary[start + len(new_indices):start + idx_view["byteLength"]]
    delta = len(new_indices) - idx_view["byteLength"]
    new_view["byteLength"] = len(new_indices)
    idx_accessor["count"] = len(kept)
    doc["buffers"][0]["byteLength"] = len(new_binary)
    write_glb(output, doc, bytes(new_binary))
    print(json.dumps({"source": source, "output": output, "cutX": cut, "side": "face" if keep_face else "ear", "triangles": len(kept) // 3, "removed": (len(indices) - len(kept)) // 3}))


if __name__ == "__main__":
    main()
