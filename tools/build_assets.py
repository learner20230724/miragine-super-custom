#!/usr/bin/env python3
"""Reproduce production assets from preserved FFDec exports (stdlib only).

Only assets/generated/** and generated/asset-manifest.json may be written.
Source PNGs, MP3s and font subsets are copied byte-for-byte, never re-rendered.
SVG-export float bounds are retained as JSON evidence so public-clone builds do
not need the ignored local SVG export directory. --check performs no writes.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "assets/generated"
MANIFEST = ROOT / "generated/asset-manifest.json"
BOUNDS_FILE = "assets/generated/metadata/sprite-bounds.json"
SVG_INPUT = ROOT / ".local/unit-sprite-bounds"
BASELINE_SHA256 = "6cd4a86045d828517c5eaabacfa04ae16719733778f8b20b3c855e5f03df7149"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
SVG_NS = "{http://www.w3.org/2000/svg}"
AS3_ROOT = "recovered/as3/scripts/"
DRAGON_SOURCE = AS3_ROOT + "DragonForce.as"
SHEET_SOURCE = AS3_ROOT + "dragonforce/core/SpriteSheet.as"
MAP_SOURCE = AS3_ROOT + "dragonforce/core/SpriteMap.as"
SYMBOL_SOURCE = AS3_ROOT + "dragonforce/core/Symbol.as"


def require(condition: bool, message: str) -> None:
    if not condition:
        raise ValueError(message)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def json_bytes(value: object) -> bytes:
    return (json.dumps(value, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n").encode("utf-8")


def relative(path: Path) -> str:
    return path.relative_to(ROOT).as_posix()


def slug(value: str) -> str:
    result = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    require(bool(result), "Asset name has no safe filename characters")
    return result


def source_record(path: str) -> dict:
    data = (ROOT / path).read_bytes()
    return {"file": path, "sha256": sha256(data), "bytes": len(data)}


def png_dimensions(data: bytes) -> tuple[int, int]:
    require(len(data) >= 33 and data[:8] == PNG_SIGNATURE and data[12:16] == b"IHDR", "Invalid PNG header")
    width, height = struct.unpack(">II", data[16:24])
    require(width > 0 and height > 0, "PNG dimensions must be positive")
    return width, height


def read_symbols(path: Path) -> dict[str, int]:
    symbols = {}
    for row in csv.reader(path.read_text(encoding="utf-8-sig").splitlines(), delimiter=";"):
        require(len(row) == 2, f"Malformed symbol CSV row in {relative(path)}")
        character_id, symbol = int(row[0]), row[1]
        require(symbol not in symbols, f"Duplicate symbol {symbol}")
        symbols[symbol] = character_id
    return symbols


def float_attribute(value: str) -> float:
    number = float(value.removesuffix("px"))
    require(math.isfinite(number), "Non-finite SVG dimension")
    return number if number != 0 else 0.0


def bounds_from_svg(path: Path) -> dict:
    data = path.read_bytes()
    svg = ET.fromstring(data)
    group = svg.find(SVG_NS + "g")
    require(group is not None, "Missing first SVG group")
    matrix = re.fullmatch(r"matrix\(([^)]+)\)", group.attrib.get("transform", ""))
    require(matrix is not None, "SVG frame must have a translation matrix")
    values = [float_attribute(x.strip()) for x in matrix[1].split(",")]
    require(len(values) == 6 and values[:4] == [1.0, 0.0, 0.0, 1.0], "Unexpected SVG frame transform")
    bounds = {
        "xMin": -values[4] if values[4] != 0 else 0.0,
        "yMin": -values[5] if values[5] != 0 else 0.0,
        "width": float_attribute(svg.attrib["width"]),
        "height": float_attribute(svg.attrib["height"]),
    }
    require(bounds["width"] > 0 and bounds["height"] > 0, "Empty SVG frame bounds")
    return {"bounds": bounds, "svgSha256": sha256(data)}


def animation_profiles() -> tuple[dict, dict]:
    source = (ROOT / DRAGON_SOURCE).read_text(encoding="utf-8")
    sheet = (ROOT / SHEET_SOURCE).read_text(encoding="utf-8")
    require("param3:Boolean = true, param4:Number = 1" in sheet, "SpriteSheet default parameters changed")
    require("var _loc5_:Number = 0.9;" in sheet, "SpriteSheet raster scale changed")
    profiles, special = {}, {}
    unit_pattern = re.compile(
        r'createActionFromMovieClip\("(idle|run|attack|dead)",library\.getInstance\("([AB])" \+ _loc2_ \+ "_(idle|run|attack|dead)"\),(true|false),([\d.]+)\);'
    )
    special_pattern = re.compile(
        r'createActionFromMovieClip\("(idle|run|attack|dead)",library\.getInstance\("(fireball|thunderball|storm|[AB]_crystal)"\)(?:,(true|false))?(?:,([\d.]+))?\);'
    )
    for line_number, line in enumerate(source.splitlines(), 1):
        unit = unit_pattern.search(line)
        if unit:
            state, team, suffix, loop, speed = unit.groups()
            require(state == suffix, "Mismatched source action/symbol")
            profiles[team + "_" + state] = {
                "speed": float(speed), "loop": loop == "true",
                "speedUnit": "frames-per-Symbol.step",
                "source": {"file": DRAGON_SOURCE, "line": line_number},
            }
        match = special_pattern.search(line)
        if match:
            state, symbol, loop, speed = match.groups()
            entry = special.setdefault(symbol, {"states": []})
            entry["states"].append(state)
            entry.setdefault("animation", {
                "speed": float(speed) if speed else 1,
                "loop": loop != "false", "speedUnit": "frames-per-Symbol.step",
                "source": {"file": DRAGON_SOURCE, "line": line_number},
            })
    require(len(profiles) == 8 and len(special) == 5, "Missing source animation profiles")
    return profiles, special


def build(*, retained_bounds_only: bool = False) -> tuple[dict, dict[str, bytes]]:
    outputs: dict[str, bytes] = {}
    inventory: dict[str, dict] = {}

    def add_file(destination: str, data: bytes, source: str | None = None, **attributes) -> dict:
        require(destination.startswith("assets/generated/") and ".." not in destination.split("/"), "Unsafe output filename")
        require(destination not in outputs, f"Duplicate asset destination: {destination}")
        record = {"file": destination, "sha256": sha256(data), "bytes": len(data), **attributes}
        if source is not None:
            record["sourceFile"] = source
        outputs[destination] = data
        inventory[destination] = record
        return record

    def copy_file(source: Path, destination: str) -> dict:
        data = source.read_bytes()
        attributes = {}
        if source.suffix.lower() == ".png":
            width, height = png_dimensions(data)
            attributes = {"width": width, "height": height}
        return add_file(destination, data, relative(source), **attributes)

    symbols = read_symbols(ROOT / "recovered/unit-media/symbolClass/symbols.csv")
    game_symbols = read_symbols(ROOT / "recovered/game-media/symbolClass/symbols.csv")
    xml = ET.parse(ROOT / "recovered/assets.xml").getroot()
    definitions = {
        int(node.attrib["spriteId"]): int(node.attrib["frameCount"])
        for node in xml.find("tags") if node.attrib.get("type") == "DefineSpriteTag"
    }
    require(len(definitions) == 134, "Unexpected number of source sprite definitions")
    profiles, special = animation_profiles()

    retained_path = ROOT / BOUNDS_FILE
    retained = json.loads(retained_path.read_text(encoding="utf-8"))["frames"] if retained_path.exists() else {}
    bounds_evidence, sprites = {}, {}
    for directory in sorted((ROOT / "recovered/unit-sprites").iterdir(), key=lambda p: p.name):
        require(directory.is_dir(), "Unexpected non-directory in recovered sprites")
        match = re.fullmatch(r"DefineSprite_(\d+)(?:_(.+))?", directory.name)
        require(match is not None, "Malformed sprite directory")
        character_id = int(match[1])
        symbol = match[2] or "shadow"
        require(character_id in definitions, f"Sprite {symbol} missing from assets.xml")
        if match[2]:
            require(symbols.get(symbol) == character_id, f"CSV ID mismatch for {symbol}")
        else:
            require(character_id == 77, "Unexpected unnamed sprite")

        unit = re.fullmatch(r"([AB])(\d+)_(idle|run|attack|dead)", symbol)
        if unit:
            team, index, state = unit.groups()
            require(0 <= int(index) < 16, "Unexpected unit index")
            descriptor = {"kind": "unit", "team": team, "unitIndex": int(index), "state": state}
            animation = profiles[team + "_" + state]
            destination_base = f"assets/generated/sprites/{team.lower()}/unit-{int(index):02d}/{state}"
        elif symbol in ("A_crystal", "B_crystal"):
            descriptor = {"kind": "crystal", "team": symbol[0], "states": special[symbol]["states"]}
            animation = special[symbol]["animation"]
            destination_base = f"assets/generated/sprites/{symbol[0].lower()}/crystal"
        elif symbol in ("fireball", "thunderball", "storm"):
            descriptor = {"kind": "projectile", "states": special[symbol]["states"]}
            animation = special[symbol]["animation"]
            destination_base = f"assets/generated/sprites/effects/{symbol}"
        else:
            require(symbol == "shadow", "Unrecognized source sprite")
            descriptor = {"kind": "shadow", "states": []}
            animation = None  # Embedded visual helper, not an independent SpriteSheet action.
            destination_base = "assets/generated/sprites/effects/shadow"

        files = sorted(directory.glob("*.png"), key=lambda p: int(p.stem))
        require([int(p.stem) for p in files] == list(range(1, definitions[character_id] + 1)), f"Incomplete frames for {symbol}")
        frames = []
        for source in files:
            svg = SVG_INPUT / directory.name / (source.stem + ".svg")
            source_name = relative(source)
            evidence = bounds_from_svg(svg) if svg.exists() and not retained_bounds_only else retained.get(source_name)
            require(evidence is not None, f"Missing retained bounds for {symbol} frame {source.stem}")
            bounds_evidence[source_name] = evidence
            bounds = evidence["bounds"]
            frame = copy_file(source, f"{destination_base}/frame-{int(source.stem):03d}.png")
            require((frame["width"], frame["height"]) == (math.ceil(bounds["width"]), math.ceil(bounds["height"])), f"PNG/SVG extent mismatch for {symbol}")
            frames.append({**frame, "index": int(source.stem), "bounds": bounds})

        bounds = frames[0]["bounds"]
        require(all(frame["bounds"] == bounds for frame in frames), f"Non-uniform exported action bounds for {symbol}")
        scale = 0.9
        sprites[symbol] = {
            "characterId": character_id, "sourceSymbol": match[2], **descriptor,
            "frameCount": len(frames), "animation": animation, "bounds": bounds,
            "rasterized": {
                "scale": scale,
                "offX": int(bounds["xMin"] * scale),
                "offY": int(bounds["yMin"] * scale),
                "width": int(bounds["width"] * scale),
                "height": int(bounds["height"] * scale),
                "matrix": {"a": scale, "d": scale, "tx": -bounds["xMin"] * scale, "ty": -bounds["yMin"] * scale},
                "boundsSource": "FFDec-exported-frame-extents",
                "validatedAgainstFlashGetRect": False,
            },
            "frames": frames,
        }

    require(len(sprites) == 134 and sum(v["frameCount"] for v in sprites.values()) == 594, "Incomplete sprite export")
    add_file(BOUNDS_FILE, json_bytes({
        "schemaVersion": 1,
        "method": "FFDec frame SVG root float width/height; xMin/yMin are negative first-group translation",
        "coordinateUnit": "Flash pixels",
        "frames": bounds_evidence,
    }))

    images = {}
    for symbol in ("bg1", "bg2", "door", "terrain", "terrain2"):
        character_id = symbols[symbol]
        source = ROOT / f"recovered/unit-media/images/{character_id}_{symbol}.png"
        images[symbol] = {"characterId": character_id, **copy_file(source, f"assets/generated/scenery/{slug(symbol)}.png")}

    sounds = {}
    for domain, table in (("unit", symbols), ("game", game_symbols)):
        folder = ROOT / f"recovered/{domain}-media/sounds"
        by_id = {identifier: name for name, identifier in table.items()}
        for source in sorted(folder.glob("*.mp3"), key=lambda p: int(p.stem.split("_")[0])):
            character_id = int(source.stem.split("_")[0])
            symbol = by_id.get(character_id)
            key = symbol or f"{domain}-sound-{character_id:04d}"
            require(key not in sounds, "Duplicate sound symbol")
            sounds[key] = {
                "characterId": character_id, "sourceDomain": domain, "sourceSymbol": symbol,
                **copy_file(source, f"assets/generated/sounds/{domain}/{slug(key)}.mp3"),
            }

    ui_images = {}
    for source in sorted((ROOT / "recovered/game-media/images").glob("*.png"), key=lambda p: int(p.stem)):
        key = f"image-{int(source.stem):04d}"
        ui_images[key] = {"characterId": int(source.stem), **copy_file(source, f"assets/generated/ui/{key}.png")}

    fonts = {}
    for source in sorted((ROOT / "recovered/game-media/fonts").glob("*.ttf"), key=lambda p: int(p.stem.split("_")[0])):
        identifier, family = source.stem.split("_", 1)
        fonts[family] = {
            "characterId": int(identifier), "subset": True,
            **copy_file(source, f"assets/generated/fonts/{slug(family)}.ttf"),
        }

    manifest = {
        "schemaVersion": 1,
        "baselineGameSha256": BASELINE_SHA256,
        "generation": {
            "tool": "tools/build_assets.py", "runtimeSwfDependency": False,
            "writesOnly": ["assets/generated/**", "generated/asset-manifest.json"],
            "sourceFiles": [source_record(p) for p in (
                "recovered/assets.xml", "recovered/unit-media/symbolClass/symbols.csv",
                "recovered/game-media/symbolClass/symbols.csv", DRAGON_SOURCE,
                SHEET_SOURCE, MAP_SOURCE, SYMBOL_SOURCE,
            )],
            "boundsEvidenceFile": BOUNDS_FILE,
        },
        "fidelity": {
            "pngAudioFontCopiesByteIdentical": True,
            "pixelPerfectValidated": False,
            "exportedPngSizeRule": "ceil(SVG-exported float width/height)",
            "rasterizedIntegerRule": "AS3 int truncates toward zero; BitmapData dimensions truncate positive scaled bounds",
            "rasterizedBoundsCaveat": "Original SpriteSheet uses MovieClip.getRect at the initial frame; retained FFDec exported extents are a proxy until original-runtime comparison.",
            "rasterizationCaveat": "Preserved PNG exports are not claimed identical to Flash BitmapData.draw at scale 0.9; no redraw, crop, or resampling is performed by this pipeline.",
            "excludedPlaceholders": ["recovered/unit-media/sounds/-1.wav", "recovered/game-media/sounds/-1.wav"],
        },
        "counts": {
            "unitStates": sum(sprite["kind"] == "unit" for sprite in sprites.values()),
            "sprites": len(sprites), "frames": sum(sprite["frameCount"] for sprite in sprites.values()),
            "sceneryImages": len(images), "sounds": len(sounds),
            "namedSounds": sum(sound["sourceSymbol"] is not None for sound in sounds.values()),
            "uiImages": len(ui_images), "fonts": len(fonts), "files": len(inventory),
            "bytes": sum(record["bytes"] for record in inventory.values()),
        },
        "sprites": sprites, "images": images, "sounds": sounds, "uiImages": ui_images, "fonts": fonts,
        "files": [inventory[key] for key in sorted(inventory)],
    }
    outputs[relative(MANIFEST)] = json_bytes(manifest)
    return manifest, outputs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify reproducible outputs without writing anything")
    parser.add_argument("--retained-bounds-only", action="store_true", help="Use public retained metadata, without reading ignored local SVG exports")
    args = parser.parse_args()
    manifest, outputs = build(retained_bounds_only=args.retained_bounds_only)
    changed = []
    for name, data in outputs.items():
        path = ROOT / name
        resolved = path.resolve()
        require(resolved == MANIFEST.resolve() or resolved.is_relative_to(OUTPUT.resolve()), "Output escapes generated asset area")
        if not path.exists() or path.read_bytes() != data:
            changed.append(name)
            if not args.check:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
    if args.check and changed:
        raise SystemExit("Asset outputs differ: " + ", ".join(changed))
    print(json.dumps({"mode": "check" if args.check else "build", "changedFiles": len(changed), **manifest["counts"]}, sort_keys=True))


if __name__ == "__main__":
    main()
