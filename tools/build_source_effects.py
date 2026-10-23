#!/usr/bin/env python3
"""Preserve the original high-density effect bitmaps without resampling.

Only generated/source-effects.json and assets/generated/source-effects/** are written.
--check is read-only. This is a deliberately narrow XML reader: unsupported
shape/timeline changes fail instead of silently changing the original artwork.
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import struct
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
MANIFEST = "generated/source-effects.json"
OUTPUT = "assets/generated/source-effects/"
SOURCE_XML = "recovered/assets.xml"
SOURCE_SWF = "reference/super-assets-original.swf"
SOURCE_SWF_SHA256 = "31f0fc1a147bac308d794fcecb087ff47260ee830ea6b9287bad98c93e7b5a2e"
ASSET_MANIFEST = "generated/asset-manifest.json"
SYMBOLS = "recovered/unit-media/symbolClass/symbols.csv"
EFFECTS = ("thunderball", "storm")


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def source_record(file: str) -> dict:
    data = (ROOT / file).read_bytes()
    return {"file": file, "bytes": len(data), "sha256": digest(data)}


def clean(value: float) -> int | float:
    require(math.isfinite(value), "Non-finite source coordinate")
    return int(value) if value.is_integer() else value


def matrix(node: ET.Element | None, *, bitmap: bool = False) -> list:
    if node is None:
        return [1, 0, 0, 1, 0, 0]
    # A bitmap matrix maps bitmap PIXELS to shape TWIPS. Placement matrix
    # coefficients instead map twips to twips; only its translation is twips.
    divisor = 20 if bitmap else 1
    values = [float(node.get("scaleX", 1)) / divisor,
              float(node.get("rotateSkew0", 0)) / divisor,
              float(node.get("rotateSkew1", 0)) / divisor,
              float(node.get("scaleY", 1)) / divisor,
              float(node.get("translateX", 0)) / 20,
              float(node.get("translateY", 0)) / 20]
    return [clean(value) for value in values]


def multiply(left: list, right: list) -> list:
    a, b, c, d, e, f = left
    u, v, w, x, y, z = right
    return [clean(float(value)) for value in [a*u+c*v, b*u+d*v,
            a*w+c*x, b*w+d*x, a*y+c*z+e, b*y+d*z+f]]


def shape_record(node: ET.Element) -> dict:
    shapes = node.find("shapes")
    require(shapes is not None, "Missing effect shape geometry")
    require(not list(shapes.find("lineStyles/lineStyles")), "Effect gained line strokes")
    fills = list(shapes.find("fillStyles/fillStyles"))
    x, y = 0, 0
    vertices = []
    active_fill = None
    for record in shapes.find("shapeRecords"):
        typ = record.get("type")
        if typ == "StyleChangeRecord":
            require(record.get("stateNewStyles") != "true" and
                    record.get("stateLineStyle") != "true" and
                    record.get("stateFillStyle0") != "true", "Unsupported effect fill transition")
            if record.get("stateMoveTo") == "true":
                require(not vertices, "Effect gained a second path")
                x, y = int(record.get("moveDeltaX", 0)), int(record.get("moveDeltaY", 0))
            if record.get("stateFillStyle1") == "true":
                require(active_fill is None, "Effect gained multiple active fills")
                active_fill = int(record.get("fillStyle1"))
        elif typ == "StraightEdgeRecord":
            if not vertices:
                vertices.append([x / 20, y / 20])
            x += int(record.get("deltaX", 0))
            y += int(record.get("deltaY", 0))
            vertices.append([x / 20, y / 20])
        else:
            require(typ == "EndShapeRecord", "Effect gained non-rectangular edges")
    bounds = node.find("shapeBounds")
    clip = {key: clean(float(bounds.get(attr)) / 20) for key, attr in
            (("xMin", "Xmin"), ("yMin", "Ymin"), ("xMax", "Xmax"), ("yMax", "Ymax"))}
    expected = [[clip["xMin"], clip["yMin"]], [clip["xMax"], clip["yMin"]],
                [clip["xMax"], clip["yMax"]], [clip["xMin"], clip["yMax"]],
                [clip["xMin"], clip["yMin"]]]
    require(vertices == expected, "Effect is not the expected exact rectangular clip")
    require(active_fill is not None and 1 <= active_fill <= len(fills), "Missing active bitmap fill")
    fill = fills[active_fill - 1]
    require(fill.get("fillStyleType") == "67", "Effect no longer uses a non-smoothed clipped bitmap fill")
    require(fill.get("bitmapId") != "65535", "Effect selected the unused bitmap fill")
    return {"shapeId": int(node.get("shapeId")), "bitmapId": int(fill.get("bitmapId")),
            "clip": clip, "matrix": matrix(fill.find("bitmapMatrix"), bitmap=True),
            "bitmapMatrixTwips": dict(fill.find("bitmapMatrix").attrib),
            "fillStyleType": 67, "smoothing": False}


def build() -> tuple[dict, dict[str, bytes]]:
    swf_record = source_record(SOURCE_SWF)
    require(swf_record["sha256"] == SOURCE_SWF_SHA256, "Original asset SWF changed")
    xml = ET.parse(ROOT / SOURCE_XML).getroot()
    require(xml.get("_xmlExportMajor") == "4", "Unsupported FFDec XML major version")
    nodes = {}
    for node in xml.find("tags"):
        for key in ("spriteId", "shapeId", "characterID"):
            if node.get(key) is not None:
                nodes[int(node.get(key))] = node
                break
    symbols = {name: int(identifier) for identifier, name in csv.reader(
        (ROOT / SYMBOLS).read_text(encoding="utf-8-sig").splitlines(), delimiter=";")}
    assets = json.loads((ROOT / ASSET_MANIFEST).read_text(encoding="utf-8"))
    outputs = {}
    sprites = {}
    image_files = set()
    empty_frames = []
    for name in EFFECTS:
        sprite = nodes[symbols[name]]
        expected = assets["sprites"][name]
        require(expected["characterId"] == int(sprite.get("spriteId")), "Effect sprite ID changed")
        state = {}
        records = {}
        index = 0
        for tag in sprite.find("subTags"):
            typ = tag.get("type")
            if typ.startswith("PlaceObject"):
                require(tag.get("depth") == "1", "Effect gained multiple display depths")
                require(tag.get("placeFlagHasClipDepth") != "true" and
                        tag.get("placeFlagHasColorTransform") != "true", "Unsupported effect mask/color transform")
                old = state.get(1, {}) if tag.get("placeFlagMove") == "true" else {}
                placement = dict(old)
                if tag.get("characterId") is not None:
                    placement["characterId"] = int(tag.get("characterId"))
                if tag.find("matrix") is not None:
                    placement["matrix"] = matrix(tag.find("matrix"))
                placement.setdefault("matrix", [1, 0, 0, 1, 0, 0])
                require(placement["matrix"] == [1, 0, 0, 1, 0, 0], "Effect placement needs non-rectangular clipping support")
                state[1] = placement
            elif typ.startswith("RemoveObject"):
                state.pop(int(tag.get("depth")), None)
            elif typ == "ShowFrameTag":
                index += 1
                if not state:
                    records[str(index)] = {"index": index, "empty": True,
                        "source": {"spriteId": int(sprite.get("spriteId")),
                                   "timeline": "empty-after-RemoveObject2"}}
                    empty_frames.append(f"{name}:{index}")
                    continue
                placement = state[1]
                shape = shape_record(nodes[placement["characterId"]])
                bitmap = nodes[shape["bitmapId"]]
                require(bitmap.get("type") == "DefineBitsLossless2Tag" and bitmap.get("bitmapFormat") == "5",
                        "Effect source is no longer the original RGBA lossless bitmap")
                source_file = f"recovered/unit-media/images/{shape['bitmapId']}.png"
                data = (ROOT / source_file).read_bytes()
                require(data[:8] == b"\x89PNG\r\n\x1a\n" and data[12:16] == b"IHDR", "Invalid source PNG")
                width, height = struct.unpack(">II", data[16:24])
                require((width, height) == (int(bitmap.get("bitmapWidth")), int(bitmap.get("bitmapHeight"))),
                        "Source PNG dimensions differ from SWF bitmap")
                destination = f"{OUTPUT}{name}/bitmap-{shape['bitmapId']:03d}.png"
                outputs[destination] = data
                image_files.add(destination)
                records[str(index)] = {"index": index, "file": destination, "width": width, "height": height,
                    "bytes": len(data), "sha256": digest(data), "matrix": multiply(placement["matrix"], shape["matrix"]),
                    "clip": shape["clip"], "smoothing": shape["smoothing"],
                    "source": {"file": source_file, "spriteId": int(sprite.get("spriteId")),
                        "shapeId": shape["shapeId"], "bitmapId": shape["bitmapId"],
                        "fillStyleType": shape["fillStyleType"], "bitmapMatrixTwips": shape["bitmapMatrixTwips"],
                        "placementMatrix": placement["matrix"],
                        "zlibBitmapSha256": digest(bytes.fromhex(bitmap.get("zlibBitmapData")))}}
            else:
                require(typ in {"SoundStreamHead2Tag", "EndTag"}, "Unsupported effect timeline tag")
        require(index == int(sprite.get("frameCount")) == expected["frameCount"], "Effect frame count changed")
        sprites[name] = records
    require(len(image_files) == 25 and empty_frames == ["storm:10"], "Original source-effect inventory changed")
    manifest = {"schemaVersion": 1, "generation": {
        "tool": "tools/build_source_effects.py", "operation": "byte-identical-source-copy-no-resampling",
        "coordinateUnits": "bitmap matrix: source PNG pixels to original sprite pixels; clip: original sprite pixels",
        "runtime": "no recovered XML, SWF, SVG or Python is loaded by the game",
        "emptyFrames": empty_frames,
        "emptyFrameNote": "storm frame 10 is empty in the source timeline and in the existing transparent frame PNG; do not repeat frame 9.",
        "sourceSwf": swf_record, "sources": [source_record(file) for file in (SOURCE_XML, SYMBOLS, ASSET_MANIFEST)],
    }, "counts": {"images": len(image_files), "frames": sum(len(s) for s in sprites.values()),
                    "emptyFrames": len(empty_frames), "imageBytes": sum(len(data) for data in outputs.values())},
        "sprites": sprites}
    return manifest, outputs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify reproducible outputs without writing files")
    args = parser.parse_args()
    manifest, outputs = build()
    outputs[MANIFEST] = (json.dumps(manifest, ensure_ascii=False, indent=2, sort_keys=True,
                                  allow_nan=False) + "\n").encode("utf-8")
    for relative, data in outputs.items():
        require(relative == MANIFEST or relative.startswith(OUTPUT), "Unsafe generated destination")
        target = ROOT / relative
        if args.check:
            require(target.is_file() and target.read_bytes() == data, f"Generated source-effect mismatch: {relative}")
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
    # Never delete unknown files, especially human edits. Only report extras.
    actual = {file.relative_to(ROOT).as_posix() for file in (ROOT / OUTPUT).rglob("*") if file.is_file()}
    require(actual == set(outputs) - {MANIFEST}, "Unexpected files in generated source-effect directory; no files deleted")
    print(f"{'Verified' if args.check else 'Generated'} {len(outputs)-1} byte-identical source images, "
          f"{manifest['counts']['frames']} frames ({manifest['counts']['emptyFrames']} empty), "
          f"{manifest['counts']['imageBytes']} image bytes")


if __name__ == "__main__":
    main()
