"""Extract faithful defaults from recovered AS3 and original SWF symbols.

Only config/defaults.generated.json and generated/config-provenance.json are
written. Source evidence, custom overrides, and hand-written code are read-only.
No Flash code is executed, and no third-party Python packages are required.
"""
from __future__ import annotations

import argparse
import ast
import hashlib
import json
import math
from pathlib import Path
import re
import struct
import zlib

ROOT = Path(__file__).resolve().parents[1]
GAME_HASH = "6cd4a86045d828517c5eaabacfa04ae16719733778f8b20b3c855e5f03df7149"
ASSET_HASH = "31f0fc1a147bac308d794fcecb087ff47260ee830ea6b9287bad98c93e7b5a2e"


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def numeric(expression):
    """Evaluate only arithmetic numeric literals, never ActionScript/Python code."""
    def visit(node):
        if isinstance(node, ast.Constant) and type(node.value) in (int, float):
            return node.value
        if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub):
            return -visit(node.operand)
        if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub, ast.Mult, ast.Div)):
            left, right = visit(node.left), visit(node.right)
            if isinstance(node.op, ast.Add): return left + right
            if isinstance(node.op, ast.Sub): return left - right
            if isinstance(node.op, ast.Mult): return left * right
            return left / right
        raise ValueError(f"Unsupported numeric source expression: {expression}")
    value = visit(ast.parse(expression.strip(), mode="eval").body)
    if not math.isfinite(value):
        raise ValueError("Non-finite extracted value")
    return value


def one(pattern, source, transform=numeric):
    match = re.search(pattern, source, re.S)
    if not match:
        raise ValueError(f"Expected original source expression missing: {pattern}")
    return transform(match.group(1))


def source_method(source, name):
    match = re.search(r"function\s+" + re.escape(name) + r"\s*\(", source)
    if not match:
        raise ValueError(f"Method not found: {name}")
    start = source.index("{", match.end())
    depth = 1
    cursor = start + 1
    while depth:
        if cursor >= len(source): raise ValueError("Unclosed method")
        depth += (source[cursor] == "{") - (source[cursor] == "}")
        cursor += 1
    return source[start + 1:cursor - 1]


def swf_symbols(data):
    """Read sprite lengths/symbol mappings without invoking the SWF runtime."""
    if data[:3] == b"CWS":
        body = zlib.decompress(data[8:])
    elif data[:3] == b"FWS":
        body = data[8:]
    else:
        raise ValueError("Unsupported SWF compression")
    if len(body) + 8 != struct.unpack_from("<I", data, 4)[0]:
        raise ValueError("SWF decompression length mismatch")
    rect_bytes = (5 + 4 * (body[0] >> 3) + 7) // 8
    frame_rate = struct.unpack_from("<H", body, rect_bytes)[0] / 256
    offset = rect_bytes + 4
    symbols, sprites = {}, {}
    while offset + 2 <= len(body):
        record = struct.unpack_from("<H", body, offset)[0]
        offset += 2
        tag, size = record >> 6, record & 63
        if size == 63:
            size = struct.unpack_from("<I", body, offset)[0]
            offset += 4
        payload = body[offset:offset + size]
        offset += size
        if len(payload) != size: raise ValueError("Truncated SWF tag")
        if tag == 39:
            sid, frames = struct.unpack_from("<HH", payload)
            sprites[sid] = frames
        if tag == 76:
            count = struct.unpack_from("<H", payload)[0]
            cursor = 2
            for _ in range(count):
                sid = struct.unpack_from("<H", payload, cursor)[0]
                cursor += 2
                end = payload.index(b"\0", cursor)
                symbols[payload[cursor:end].decode("utf-8")] = sid
                cursor = end + 1
        if tag == 0: break
    return frame_rate, {name: {"characterId": sid, "frames": sprites[sid]}
                        for name, sid in symbols.items() if sid in sprites}


def extract(root=ROOT):
    sources = {}
    source_paths = {
        "grid": "recovered/as3/scripts/Grid.as",
        "game": "recovered/as3/scripts/DragonForce.as",
        "entity": "recovered/as3/scripts/dragonforce/isometric2D/Isometric2DEntity.as",
        "entityPcode": "recovered/pcode/scripts/dragonforce/isometric2D/Isometric2DEntity.pcode",
        "projectile": "recovered/as3/scripts/dragonforce/isometric2D/Isometric2DAttack.as",
        "symbol": "recovered/as3/scripts/dragonforce/core/Symbol.as",
        "spriteSheet": "recovered/as3/scripts/dragonforce/core/SpriteSheet.as",
        "timeline": "recovered/as3/scripts/miragine3d_fla/MainTimeline.as",
        "renderer": "recovered/as3/scripts/dragonforce/renderEngine/DragonForceRenderEngine.as",
    }
    for key, relative in source_paths.items():
        sources[key] = (root / relative).read_text(encoding="utf-8")
    game, grid, entity = sources["game"], sources["grid"], sources["entity"]
    baseline = (root / "reference/super-original.swf").read_bytes()
    assets = (root / "reference/super-assets-original.swf").read_bytes()
    if sha256(baseline) != GAME_HASH or sha256(assets) != ASSET_HASH:
        raise ValueError("Reference baseline hash mismatch; refusing to regenerate")
    fps, _ = swf_symbols(baseline)
    asset_fps, animations = swf_symbols(assets)
    if fps != asset_fps: raise ValueError("Unexpected asset frame rate")
    units = json.loads(one(r"this\.entity\s*=\s*(\[.*?\]);", grid, str))
    if [row["id"] for row in units] != list(range(16)):
        raise ValueError("Expected the 16 original Grid units in stable ID order")
    if not re.search(r"private var t:int\s*=\s*0;", entity) or "this.t = this.weaponSpeed;" not in source_method(entity, "attack"):
        raise ValueError("Attack cooldown integer-slot semantics changed")
    if 'initproperty QName(PrivateNamespace(null,"13"),"t")' not in sources["entityPcode"]:
        raise ValueError("Recovered P-code no longer corroborates the cooldown assignment")
    init, create, ai, step = (source_method(game, name) for name in ("init", "createUnit", "ai", "step"))
    movement_multiplier = one(r"\.moveSpeed\s*=\s*this\.grid\.entity\[param2\]\.moveSpeed\s*\*\s*([^;]+);", create)
    range_multiplier = one(r"\.range\s*=\s*this\.grid\.entity\[param2\]\.range\s*\*\s*([^;]+);", create)
    cooldown_multiplier = one(r"\.weaponSpeed\s*=\s*this\.grid\.entity\[param2\]\.weaponSpeed\s*\*\s*([^;]+);", create)
    action_speeds = {}
    action_loops = {}
    for action in ("idle", "run", "attack", "dead"):
        match = re.search(r'createActionFromMovieClip\("' + action + r'",library\.getInstance\("A"\s*\+.*?\),\s*(true|false),\s*([\d.]+)\);', game)
        if not match: raise ValueError(f"Animation speed missing: {action}")
        action_loops[action] = match.group(1) == "true"
        action_speeds[action] = numeric(match.group(2))
    for name, info in animations.items():
        unit_action = re.fullmatch(r"[AB]\d+_(idle|run|attack|dead)", name)
        if unit_action:
            action = unit_action.group(1)
            info.update(speed=action_speeds[action], loop=action_loops[action])
        else:
            # Values omitted by the call use SpriteSheet's actual defaults.
            pattern = r'createActionFromMovieClip\("idle",library\.getInstance\("' + re.escape(name) + r'"\)(?:,(true|false))?(?:,([\d.]+))?\);'
            match = re.search(pattern, game)
            if not match: raise ValueError(f"Unmapped original animation: {name}")
            info.update(speed=numeric(match.group(2)) if match.group(2) else 1,
                        loop=match.group(1) != "false")
    for unit in units:
        unit["runtime"] = {
            "moveSpeed": unit["moveSpeed"] * movement_multiplier,
            "range": unit["range"] * range_multiplier,
            "weaponSpeed": unit["weaponSpeed"] * cooldown_multiplier,
            "attackCooldownFrames": math.trunc(unit["weaponSpeed"] * cooldown_multiplier),
            "attackCooldownSeconds": math.trunc(unit["weaponSpeed"] * cooldown_multiplier) / fps,
        }
        unit["animation"] = {"spriteIndex": unit["ss"]}
        for action in action_speeds:
            red, blue = f'A{unit["ss"]}_{action}', f'B{unit["ss"]}_{action}'
            if animations[red]["frames"] != animations[blue]["frames"]:
                raise ValueError("Unexpected asymmetric unit animation lengths")
            unit["animation"][action] = {"redSymbol": red, "blueSymbol": blue,
                                          **{key: animations[red][key] for key in ("frames", "speed", "loop")}}
    rules = {
        "frameRate": fps,
        **{key: one(r"public var " + key + r":int\s*=\s*([^;]+);", game)
           for key in ("mapWidth", "mapHeight", "incomeLimit", "populationLimit")},
        "initialMoney": one(r"this\.leftMoney\s*=\s*([^;]+);", init),
        "startingIncome": one(r"this\.leftIncome\s*=\s*([^;]+);", init),
        "initialRoundFrames": one(r"this\.round\s*=\s*([^;]+);", init),
        "roundFrames": one(r"this\.round\s*=(?!=)\s*([^;]+);", step),
        "recruitEveryFrames": one(r"this\.round\s*%\s*(\d+)\s*==\s*0", step),
        "movementMultiplier": movement_multiplier,
        "rangeMultiplier": range_multiplier,
        "weaponSpeedMultiplier": cooldown_multiplier,
        "baseHp": one(r"this\.redBoss\.nowHP\s*=\s*([^;]+);", init),
        "baseDamage": one(r"this\.redBoss\.damage\s*=\s*(\[[^;]+]);", init, json.loads),
        "baseWeaponSpeedFrames": one(r"this\.redBoss\.weaponSpeed\s*=\s*([^;]+);", init),
        "baseRange": one(r"this\.redBoss\.range\s*=\s*([^;]+);", init),
        "baseSpawnInset": one(r"this\.redBoss\.px\s*=\s*([^;]+);", init),
        "spawnJitterY": one(r"\.py\s*=\s*this\.mapHeight\s*/\s*2\s*\+\s*\(([^-]+)-", create),
        "gameOverDelayFrames": one(r"this\.gameOverTime\s*=\s*([^;]+);", init),
        "unitSeparationDistance": math.sqrt(one(r"if\(_loc5_\s*<\s*([^\)]+)\)", step)),
        "targetVerticalWeight": one(r"_loc6_\s*=\s*_loc4_\s*\+\s*([\d.]+)\s*\*\s*_loc5_;", entity),
        "attackVerticalTolerance": one(r"Math\.abs\(this\.target\.py\s*-\s*py\)\s*<=\s*([\d.]+)", entity),
        "projectileSpeed": one(r"_loc1_\.vx\s*=\s*([\d.]+)\s*\*", entity),
        "projectileSpawnHeight": one(r"_loc1_\.pz\s*=\s*([^;]+);", entity),
        "projectileLifeFrames": one(r"public var life:int\s*=\s*([^;]+);", sources["projectile"]),
        "projectileVerticalTolerance": one(r"Math\.abs\(py\s*-\s*this\.target\.py\)\s*<=\s*([\d.]+)", sources["projectile"]),
        "gravity": one(r"private var gravity:Number\s*=\s*([^;]+);", entity),
        "deathAnimationFrames": one(r"this\.deadTime\s*=\s*([^;]+);", source_method(entity, "dead")),
        "spriteRasterScale": one(r"var _loc5_:Number\s*=\s*([^;]+);", sources["spriteSheet"]),
        "animationSpeeds": action_speeds,
        "animationLoops": action_loops,
        "focalLength": one(r"this\.focalLength\s*=\s*([^;]+);", sources["renderer"]),
        "groundTiltDegrees": one(r"appendRotation\(([^,]+),", sources["renderer"]),
        "cameraFollowFactor": one(r"camera\.x\s*\+=\s*\(_loc11_\.px\s*-\s*camera\.x\)\s*\*\s*([^;]+);", step),
        "manualCameraHoldFrames": one(r"this\.cameraTime\s*=\s*([^;]+);", source_method(game, "steer")),
        "minimapScale": one(r"_loc12_\s*=\s*([^;]+);", step),
    }
    probabilities = {match.group(1): numeric(match.group(2)) for match in re.finditer(r"case\s+(\d+):\s*_loc1_\s*=\s*([^;]+);", ai)}
    if set(probabilities) != {"0", "1", "2", "3"}: raise ValueError("Unexpected difficulty set")
    hardest = one(r"if\(this\.difficulty\s*==\s*3\)\s*\{(.*?)\}", init, str)
    labels = [("简单", "Easy"), ("普通", "Normal"), ("困难", "Hard"), ("不可战胜", "Impossible")]
    difficulties = {}
    for key, probability in probabilities.items():
        hard = key == "3"
        difficulties[key] = {
            "name": labels[int(key)][0], "nameEn": labels[int(key)][1],
            "counterSelectionProbability": probability,
            "rightStartingIncome": one(r"this\.rightIncome\s*=\s*([^;]+);", hardest) if hard else rules["startingIncome"],
            "rightStartingPopulation": one(r"this\.rightPopulation\s*=\s*([^;]+);", hardest) if hard else rules["populationLimit"],
            "blueBaseDamage": one(r"this\.blueBoss\.damage\s*=\s*(\[[^;]+]);", hardest, json.loads) if hard else rules["baseDamage"].copy(),
            "blueBaseWeaponSpeedFrames": one(r"this\.blueBoss\.weaponSpeed\s*=\s*([^;]+);", hardest) if hard else rules["baseWeaponSpeedFrames"],
        }
    counter_choices = {match.group(1): json.loads(match.group(2))
                       for match in re.finditer(r"else if\(_loc5_\s*==\s*(\d+)\)\s*\{\s*_loc7_\s*=\s*(\[[^;]+]);", ai)}
    if set(counter_choices) != {str(i) for i in range(1, 16)}: raise ValueError("Incomplete AI counter table")
    config = {
        "schemaVersion": 1, "profile": "faithful", "units": {str(unit["id"]): unit for unit in units},
        "rules": rules, "difficulties": difficulties,
        "ai": {
            "counterChoices": counter_choices,
            "newbieIncomeThreshold": one(r"if\(this\.rightIncome\s*<\s*([^\)]+)\)", ai),
            "newbieBelowThresholdChoice": one(r"if\(this\.rightIncome\s*<[^\)]+\)\s*\{\s*_loc2_\s*=\s*([^;]+);", ai),
            "newbieAtOrAboveThresholdChoice": one(r"if\(this\.rightIncome\s*<[^\)]+\)\s*\{[^}]+\}\s*else\s*\{\s*_loc2_\s*=\s*([^;]+);", ai),
            "counterFallbackIncomeThreshold": one(r"else if\(this\.rightIncome\s*>\s*([^\)]+)\)", ai),
            "counterFallbackRandomUnitCount": one(r"else if\(this\.rightIncome\s*>[^\)]+\)\s*\{\s*_loc2_\s*=\s*int\(Math\.random\(\)\s*\*\s*(\d+)", ai),
            "counterFallbackLowIncomeChoice": one(r"else if\(this\.rightIncome\s*>[^\)]+\)\s*\{[^}]+\}\s*else\s*\{\s*_loc2_\s*=\s*([^;]+);", ai),
            "randomIncomeThreshold": one(r"else if\(this\.rightIncome\s*>\s*([^\)]+)\)\s*\{\s*_loc2_\s*=\s*int\(Math\.random\(\)\s*\*\s*14", ai),
            "randomHighIncomeUnitCount": one(r"\}\s*else if\(this\.rightIncome\s*>[^\)]+\)\s*\{\s*_loc2_\s*=\s*int\(Math\.random\(\)\s*\*\s*(\d+)\);\s*\}\s*else\s*\{\s*_loc2_\s*=\s*int", ai),
            "randomLowIncomeUnitCount": one(r"\}\s*else\s*\{\s*_loc2_\s*=\s*int\(Math\.random\(\)\s*\*\s*(\d+)\);\s*\}\s*if\(this\.rightMoney", ai),
            "forceOverlordMoneyThreshold": one(r"this\.rightMoney\s*>\s*([^|]+)\|\|", ai),
            "forceOverlordEliteCountThreshold": one(r"\|\|\s*_loc4_\s*>\s*([^\)]+)\)", ai),
            "eliteUnitIds": [numeric(value) for value in re.findall(r"this\.friendList\[_loc2_\]\.id\s*==\s*(\d+)", ai)],
            "forcedUnitId": one(r"if\(this\.rightMoney[^\)]+\)\s*\{\s*_loc2_\s*=\s*([^;]+);", ai),
        },
        "animations": animations,
        "notApplicable": ["buildingConstruction", "buildingUpgrades", "playerSkills", "levelWaves"],
    }
    provenance = {
        "schemaVersion": 1, "generator": "tools/extract_game_config.py",
        "baselineGameSha256": GAME_HASH, "baselineAssetsSha256": ASSET_HASH,
        "sources": [{"path": relative, "sha256": sha256((root / relative).read_bytes())}
                    for relative in source_paths.values()],
        "unitFields": {},
        "mappings": {
            "units.* raw fields": "Grid.Grid: this.entity JSON-compatible literal; id is the menu unit ID, ss is a different animation index.",
            "units.*.runtime": "DragonForce.createUnit: moveSpeed * 1.3; range * 60; weaponSpeed * 20. Isometric2DEntity.attack assigns Number weaponSpeed to private int t, truncating toward zero.",
            "units.*.animation / animations": "SymbolClass and DefineSprite frame counts in original asset SWF; playback rates/loop flags in DragonForce.libraryComplete and SpriteSheet defaults.",
            "rules economy": "DragonForce.init and step, not field initializers that init replaces. Population is a per-round recruitment budget, not a living-unit cap.",
            "difficulties": "DragonForce.ai probability switch and init difficulty==3 branch. Difficulty 3 population 100 applies only before first reset; step subsequently resets both to populationLimit (80).",
            "ai": "DragonForce.ai counter table and strict >/< branch thresholds; the crystal has no menu id and may be counted under undefined.",
        },
        "semantics": {
            "cooldown": "floor(raw weaponSpeed * 20) frames for the positive defaults, NOT raw seconds. Attack animation speed/delayAttack are independent. Elapsed wall time depends on achieved rendering frame rate.",
            "animation": "Symbol.step displays int(currentFrame), then increments by speed; non-loop actions freeze on last frame. gotoAndPlay restarts non-loop actions even if already selected.",
            "damage": "nowHP -= damage[target.armorTypeID] - target.armor; original has no max(1,...) clamp. Custom armor above damage can heal; not silently corrected.",
            "income": "Recruit cost deducted immediately; income increase applied immediately and capped at incomeLimit; settlement credits the current income when round reaches zero.",
            "population": "Recruit deducts population; death does not refund it. Both budgets reset to populationLimit on round zero.",
            "unitMaxHP": "createUnit assigns nowHP from hp but does not assign maxHP; Isometric2DEntity.maxHP remains its default 100 for ordinary units. Crystal maxHP is explicitly 3500.",
            "spawnAndAI": "No invented reinforcement waves: selected units are repeatedly attempted when the countdown modulo 3 equals zero; AI selection is reconsidered at settlement only.",
            "derivedFields": "units.*.runtime and animation are documentation/extraction results; the core recalculates raw stat conversions after custom overrides. Unit ss selects actual flat animation frame lengths; rules.animationSpeeds/Loops govern unit action playback, while crystal/effect speeds are stored in the flat animation entries.",
        },
        "units": {
            "cost": "gold / recruit", "population": "per-round manpower budget / recruit",
            "income": "gold / settlement added per recruit", "hp": "initial health points",
            "damage": "[damage against light armor, damage against heavy armor] before flat armor",
            "armorTypeID": "0 = light, 1 = heavy", "armor": "flat health points subtracted from incoming damage",
            "moveSpeed": "raw display coefficient; actual world units / simulation frame = raw * 1.3",
            "range": "raw display coefficient; actual horizontal world units = raw * 60",
            "weaponSpeed": "raw display coefficient; actual positive-default cooldown frames = trunc(raw * 20)",
            "delayAttack": "simulation frames before projectile begins moving, independent of animation",
            "animation.speed": "source animation frames advanced per simulation frame, not animations/second",
        },
        "limits": ["A static source extraction is not proof of full-match runtime parity.",
                   "The historical platform listing date is not proof of the binary build date.",
                   "No author-original FLA/source project is claimed; recovered AS3 was decompiled from the verified SWF."],
    }
    literal = re.search(r"this\.entity\s*=\s*(\[.*?\]);", grid, re.S)
    for record in re.finditer(r"\{[^{}]*\}", literal.group(1), re.S):
        row = json.loads(record.group())
        first = literal.start(1) + record.start()
        provenance["unitFields"][str(row["id"])] = {
            "source": source_paths["grid"],
            "firstLine": grid[:first].count("\n") + 1,
            "lastLine": grid[:first + len(record.group())].count("\n") + 1,
            "fields": {key: grid[:first + re.search('"' + re.escape(key) + '"\\s*:', record.group()).start()].count("\n") + 1
                       for key in row},
        }
    return config, provenance


def render_documents(config, provenance):
    return (json.dumps(config, ensure_ascii=False, indent=2) + "\n",
            json.dumps(provenance, ensure_ascii=False, indent=2) + "\n")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Read-only comparison with committed generated files")
    args = parser.parse_args()
    payloads = render_documents(*extract())
    destinations = (ROOT / "config/defaults.generated.json", ROOT / "generated/config-provenance.json")
    for destination, payload in zip(destinations, payloads):
        if args.check:
            if not destination.exists() or destination.read_text(encoding="utf-8") != payload:
                raise SystemExit(f"Generated file differs: {destination.relative_to(ROOT).as_posix()}")
        else:
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_text(payload, encoding="utf-8", newline="\n")
        print(f'{"Verified" if args.check else "Generated"}: {destination.relative_to(ROOT).as_posix()}')


if __name__ == "__main__":
    main()
