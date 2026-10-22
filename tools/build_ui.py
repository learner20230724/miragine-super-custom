"""Deterministically export the original UI artwork and XML display-list layout.

This is a graphics export, not a SWF player or an ActionScript interpreter. Runtime
behaviour belongs in the handwritten application. Only generated/ui is written.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "generated/ui"
SOURCE = ROOT / "recovered/game-canvas"
UI_SPRITES = (55, 75, 134, 210, 228, 238, 258, 74, 209)
IDENTITY = [1, 0, 0, 1, 0, 0]


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean(value):
    number = round(float(value), 10)
    return int(number) if number.is_integer() else number


def matrix(element):
    if element is None:
        return IDENTITY[:]
    a = element.attrib
    return [clean(a.get("scaleX", 1)), clean(a.get("rotateSkew0", 0)),
            clean(a.get("rotateSkew1", 0)), clean(a.get("scaleY", 1)),
            clean(float(a.get("translateX", 0)) / 20),
            clean(float(a.get("translateY", 0)) / 20)]


def rectangle(element):
    if element is None:
        return None
    return {key: clean(float(element.get(attr)) / 20)
            for key, attr in (("xMin", "Xmin"), ("yMin", "Ymin"),
                              ("xMax", "Xmax"), ("yMax", "Ymax"))}


def transform(bounds, m):
    if bounds is None:
        return None
    points = [(m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5])
              for x in (bounds["xMin"], bounds["xMax"])
              for y in (bounds["yMin"], bounds["yMax"])]
    return dict(zip(("xMin", "yMin", "xMax", "yMax"), map(clean,
                    (min(x for x, _ in points), min(y for _, y in points),
                     max(x for x, _ in points), max(y for _, y in points)))))


def union(rectangles):
    values = [r for r in rectangles if r is not None]
    if not values:
        return None
    return {"xMin": min(v["xMin"] for v in values), "yMin": min(v["yMin"] for v in values),
            "xMax": max(v["xMax"] for v in values), "yMax": max(v["yMax"] for v in values)}


def definitions(root):
    result = {}
    for tag in root.find("tags"):
        if tag.get("type") not in {"DefineShapeTag", "DefineShape2Tag", "DefineShape3Tag", "DefineShape4Tag",
                                   "DefineMorphShapeTag", "DefineMorphShape2Tag", "DefineSpriteTag",
                                   "DefineButtonTag", "DefineButton2Tag", "DefineTextTag", "DefineText2Tag",
                                   "DefineEditTextTag", "DefineFont2Tag", "DefineFont3Tag"}:
            continue
        for key in ("shapeId", "spriteId", "buttonId", "characterID", "characterId", "textId", "fontID"):
            if tag.get(key) is not None and tag.get("type", "").startswith("Define"):
                result[int(tag.get(key))] = tag
                break
    return result


def symbol(tag, character_id):
    typ = tag.get("type", "")
    prefix = ("sprite" if "Sprite" in typ else "button" if "Button" in typ
              else "font" if "Font" in typ else "text" if "Text" in typ else "shape")
    return f"{prefix}{character_id}"


def timeline(tags):
    """Evaluate only display-list placements; do not execute ActionScript."""
    state, frames, label = {}, [], None
    for tag in tags:
        typ = tag.get("type", "")
        if typ == "FrameLabelTag":
            label = tag.get("name")
        elif typ.startswith("RemoveObject"):
            state.pop(int(tag.get("depth")), None)
        elif typ.startswith("PlaceObject"):
            depth = int(tag.get("depth"))
            old = state.get(depth, {}) if tag.get("placeFlagMove") == "true" else {}
            item = dict(old)
            item["depth"] = depth
            for key in ("characterId", "name", "ratio", "clipDepth"):
                if tag.get(key) is not None:
                    item[key] = tag.get(key) if key == "name" else int(tag.get(key))
            if tag.find("matrix") is not None:
                item["localMatrix"] = matrix(tag.find("matrix"))
            item.setdefault("localMatrix", IDENTITY[:])
            state[depth] = item
        elif typ == "ShowFrameTag":
            frames.append({"frame": len(frames), "label": label,
                           "placements": [dict(state[d]) for d in sorted(state)]})
            label = None
    return frames


def export_layout(xml):
    root = ET.parse(xml).getroot()
    defs = definitions(root)
    cache = {}
    # The canvas exporter resolves Flash text records into positioned outline
    # glyphs. Preserve those literal baseline offsets rather than estimating
    # them from the broader XML text field rectangle or a platform font.
    exported_text = {}
    canvas_source = (SOURCE / "frames.html").read_text(encoding="utf-8")
    for match in re.finditer(r"function text(\d+)\([^)]*\)\{([\s\S]*?)(?=\nfunction |\nvar imageObj|\Z)", canvas_source):
        transform_match = re.search(r"ctx\.transform\(([^)]+)\)", match.group(2))
        if transform_match:
            values = [float(value.strip()) for value in transform_match.group(1).split(",")]
            if len(values) == 6:
                exported_text[int(match.group(1))] = {
                    "exportedBaseline": clean(values[5] / 20),
                    "exportedFirstGlyphX": clean(values[4] / 20),
                    "exportedGlyphMatrix": [clean(value / 20) for value in values],
                }

    def bounds(character_id, ancestors=()):
        if character_id in cache:
            return cache[character_id]
        if character_id in ancestors or character_id not in defs:
            return None
        tag = defs[character_id]
        typ = tag.get("type", "")
        result = None
        for key in ("shapeBounds", "bounds", "textBounds", "startBounds"):
            if tag.find(key) is not None:
                result = rectangle(tag.find(key))
                break
        next_ancestors = (*ancestors, character_id)
        if "Button" in typ:
            characters = tag.find("characters")
            records = list(characters) if characters is not None else []
            selected = [p for p in records if p.get("buttonStateHitTest") == "true"]
            if not selected:
                selected = [p for p in records if p.get("buttonStateUp") == "true"]
            result = union(transform(bounds(int(p.get("characterId")), next_ancestors),
                                     matrix(p.find("placeMatrix"))) for p in selected)
        elif "Sprite" in typ:
            frames = timeline(tag.find("subTags"))
            if frames:
                result = union(transform(bounds(p["characterId"], next_ancestors), p["localMatrix"])
                               for p in frames[0]["placements"] if "characterId" in p)
        cache[character_id] = result
        return result

    def enrich(frame):
        items = []
        for p in frame["placements"]:
            if "characterId" not in p:
                continue
            character_id = p["characterId"]
            tag = defs.get(character_id)
            item = dict(p)
            item["symbol"] = symbol(tag, character_id) if tag is not None else None
            item["localBounds"] = bounds(character_id)
            item["bounds"] = transform(item["localBounds"], item["localMatrix"])
            if tag is not None and "EditText" in tag.get("type", ""):
                item["text"] = {"font": f"font{tag.get('fontId')}",
                                "fontSize": clean(float(tag.get("fontHeight", 0)) / 20),
                                "initialText": tag.get("initialText", ""),
                                "align": int(tag.get("align", 0)),
                                **exported_text.get(character_id, {})}
            items.append(item)
        return {**frame, "placements": items,
                "instances": {p["name"]: p for p in items if p.get("name")}}

    frames = [enrich(f) for f in timeline(root.find("tags"))]
    sprites = {}
    for character_id in UI_SPRITES:
        tag = defs[character_id]
        own_frames = [enrich(f) for f in timeline(tag.find("subTags"))]
        sprites[str(character_id)] = {"symbol": f"sprite{character_id}",
                                      "frameCount": int(tag.get("frameCount")),
                                      "localBounds": bounds(character_id),
                                      **own_frames[0], "frames": own_frames}
    fonts = {}
    for character_id, tag in sorted(defs.items()):
        if tag.get("type") not in ("DefineFont2Tag", "DefineFont3Tag"):
            continue
        codes = [int(x.text) for x in tag.find("codeTable")]
        advances_element = tag.find("fontAdvanceTable")
        advances = [int(x.text) for x in advances_element] if advances_element is not None else []
        fonts[f"font{character_id}"] = {"name": tag.get("fontName", "").replace("\\u0000", ""),
             "unitsPerEm": 20480 if tag.get("type") == "DefineFont3Tag" else 1024,
             "advances": {chr(c): a for c, a in zip(codes, advances)},
             "glyphs": "".join(chr(c) for c in codes)}
    output = {"schemaVersion": 1, "generatedBy": "tools/build_ui.py",
              "source": "recovered/super.xml", "sourceSha256": digest(xml),
              "units": "pixels (original SWF twips divided by 20)",
              "boundsNotes": "Shape/edit-text RECTs; button hit-state, falling back to up-state; sprite first-frame display-list union. Filter extents are excluded.",
              "viewport": rectangle(root.find("displayRect")),
              "rootFrames": {f["label"]: f for f in frames if f["label"]},
              "sprites": sprites, "fonts": fonts}
    return output


def export_graphics(layout):
    html = (SOURCE / "frames.html").read_text(encoding="utf-8")
    helper = (SOURCE / "canvas.js").read_text(encoding="utf-8")
    # Discard FFDec's demonstration page and timer, retaining only symbol artwork.
    start = html.index("var scalingGrids =")
    stop = html.index("var frame = -1;", start)
    graphics = html[start:stop].rstrip()
    demo_start = helper.index("window.addEventListener('load'")
    demo_stop = helper.index("function drawMorphPath", demo_start)
    helper = helper[:demo_start] + helper[demo_stop:]
    helper = helper.replace("Filters = {};", "var Filters = {};", 1)
    substitutions = {
        'eval(obj + "(ctx,new cxform(0,0,0,0,255,255,255,255),frame,ratio,time);");':
            'symbolRegistry[obj](ctx,new cxform(0,0,0,0,255,255,255,255),frame,ratio,time);',
        'eval(obj + "(ctx,ctrans,frame,ratio,time);");':
            'symbolRegistry[obj](ctx,ctrans,frame,ratio,time);',
    }
    for old, new in substitutions.items():
        assert helper.count(old) == 1, "Unexpected FFDec helper; review before regenerating"
        helper = helper.replace(old, new)
    place_head = "var place = function (obj, canvas, ctx, matrix, ctrans, blendMode, frame, ratio, time) {"
    assert helper.count(place_head) == 1
    helper = helper.replace(place_head, place_head + """
    if (activeFilter) {
        var change = activeFilter({symbol:obj, matrix:matrix.slice(), frame:frame, ratio:ratio, time:time});
        if (change === false) return;
        if (change && typeof change === 'object') {
            if (change.matrix) matrix = change.matrix;
            if (change.frame !== undefined) frame = change.frame;
            if (change.ratio !== undefined) ratio = change.ratio;
            if (change.time !== undefined) time = change.time;
        }
    }
""", 1)
    functions = re.findall(r"function\s+(\w+)\s*\(", graphics)
    images = re.findall(r"var (imageObj\d+)\s*=", graphics)
    assert len(functions) == len(set(functions))
    registry = ",\n".join(f"{json.dumps(name)}:{name}" for name in functions)
    font_data = json.dumps(layout["fonts"], ensure_ascii=False, separators=(",", ":"))
    result = """/* GENERATED by tools/build_ui.py. Do not hand-edit.
 * Original game artwork exported by JPEXS FFDec 26.4.0; original-game rights are separate.
 * canvas.js helper: Jindra Petrik (JPEXS) and contributors, LGPL-3.0-or-later.
 * See generated/ui/NOTICE.md and bundled license texts for attribution and modifications.
 */
(function(global) {
'use strict';
var canvas = null;
var defaultFill;
var activeFilter = null;
""" + helper + "\n" + graphics + "\nvar symbolRegistry = {\n" + registry + "\n};\n"
    result += "var fontMetrics = " + font_data + ";\n"
    result += "var imageObjects = [" + ",".join(images) + "];\n"
    result += """
var ready = Promise.all(imageObjects.map(function(image) {
    if (typeof image.decode === 'function') return image.decode();
    if (image.complete && image.naturalWidth) return Promise.resolve();
    return new Promise(function(resolve, reject) {
        image.addEventListener('load', resolve, {once:true});
        image.addEventListener('error', function() { reject(new Error('Original UI image failed to decode')); }, {once:true});
    });
}));
var enhancedContexts = new WeakSet();
function attach(target) {
    if (!target || typeof target.getContext !== 'function') throw new TypeError('A canvas is required');
    var context = target.getContext('2d');
    if (!enhancedContexts.has(context)) {
        if (typeof context.applyTransforms !== 'function') enhanceContext(context);
        enhancedContexts.add(context);
    }
    var current = context.getTransform();
    context._matrix = [current.a,current.b,current.c,current.d,current.e,current.f];
    return context;
}
function draw(symbol, context, options) {
    options = options || {};
    if (typeof symbolRegistry[symbol] !== 'function') throw new RangeError('Unknown original UI symbol: '+symbol);
    attach(context.canvas);
    var previousCanvas = canvas;
    var previousFilter = activeFilter;
    canvas = context.canvas;
    activeFilter = options.filter || null;
    try {
        var m = options.matrix || (symbol === 'main' ? [1,0,0,1,0,0] : [.05,0,0,.05,0,0]);
        place(symbol, canvas, context, m, new cxform(0,0,0,0,255,255,255,255),
              1, options.frame || 0, options.ratio || 0, options.time || 0);
    } finally {
        activeFilter = previousFilter;
        canvas = previousCanvas;
    }
}
function measureText(text, options) {
    options = options || {};
    var font = fontMetrics[options.font || 'font17'];
    if (!font || !Object.keys(font.advances).length) throw new RangeError('Font has no original advance table');
    var width = 0;
    for (var ch of String(text)) {
        if (font.advances[ch] === undefined) throw new RangeError('Glyph unavailable in original font: '+ch);
        width += font.advances[ch];
    }
    return width * (options.size || 12) / font.unitsPerEm;
}
function drawText(text, context, options) {
    options = options || {};
    attach(context.canvas);
    var fontName = options.font || 'font17';
    var font = fontMetrics[fontName];
    var glyph = symbolRegistry[fontName];
    var width = measureText(text, options);
    var x = options.x || 0;
    var y = options.y || 0; // Baseline, in pixels. No platform font substitution.
    if (options.align === 'right') x -= width;
    else if (options.align === 'center') x -= width / 2;
    var scale = (options.size || 12) / font.unitsPerEm;
    for (var ch of String(text)) {
        context.save();
        try {
            context.transform(scale,0,0,scale,x,y);
            glyph(context,ch,options.color || '#fff');
        } finally { context.restore(); }
        x += font.advances[ch] * scale;
    }
    return width;
}
global.OriginalGraphics = Object.freeze({ready:ready, attach:attach, draw:draw,
    drawText:drawText, measureText:measureText,
    symbols:Object.freeze(Object.keys(symbolRegistry)),
    has:function(symbol) { return typeof symbolRegistry[symbol] === 'function'; }});
})(window);
"""
    assert "eval(" not in result
    assert "setInterval(" not in result and "setTimeout(" not in result
    assert 'getElementById("myCanvas")' not in result
    return result, len(functions), len(images)


def write_notice():
    notice = """# Original UI artwork and canvas helper

The vector artwork, embedded bitmap images, font outlines, display-list layout,
and text are exported from the preserved Super Miragine War SWF. These remain
original-game assets, not artwork authored by FFDec. The project's permission
record and original-game attribution apply separately.

The `canvas.js` runtime helper is extracted from **JPEXS Free Flash Decompiler
Library 26.4.0**, by **Jindra Petřík (JPEXS) and contributors**, licensed under
**LGPL-3.0-or-later**. Its original header is retained in the generated bundle.

- [Original helper source, pinned version](https://github.com/jindrapetrik/jpexs-decompiler/blob/version26.4.0/libsrc/ffdec_lib/src/com/jpexs/helpers/resource/canvas.js)
- [Library license statement](https://github.com/jindrapetrik/jpexs-decompiler/blob/version26.4.0/libsrc/ffdec_lib/README.md#licenses--acknowledgments)
- Bundled license texts: `LGPL-3.0.txt` and `GPL-3.0.txt`.

The deterministic adaptation is documented in `tools/build_ui.py`: encapsulate
the helper and generated symbol functions in an IIFE; remove demonstration DOM
controls and autoplay timers; replace dynamic `eval` dispatch with a closed
symbol registry; add a placement filter, explicit canvas attachment, image decode
readiness, and original-font text drawing. No original ActionScript is executed
by this artwork module. The separate handwritten UI controls software behaviour.

Font attribution recorded in the original SWF includes Microsoft, Founder,
Monotype, Zhongyi Electronic, and Blue Vinyl. The outline export contains only
the glyphs embedded in that SWF; it is not a complete font distribution.
"""
    (OUT / "NOTICE.md").write_text(notice, encoding="utf-8", newline="\n")
    cached = ROOT / ".cache/ffdec/version26.4.0"
    for source, destination in ((cached / "lib/ffdec_lib.license.txt", "LGPL-3.0.txt"),
                                (cached / "license.txt", "GPL-3.0.txt")):
        if source.is_file():
            (OUT / destination).write_bytes(source.read_bytes())
        elif not (OUT / destination).is_file():
            raise FileNotFoundError("Run tools/prepare_ffdec.py first to retain the helper licenses")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    layout = export_layout(ROOT / "recovered/super.xml")
    graphics, symbols, images = export_graphics(layout)
    (OUT / "layout.generated.json").write_text(json.dumps(layout, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    (OUT / "original-graphics.js").write_text(graphics, encoding="utf-8", newline="\n")
    write_notice()
    print(json.dumps({"symbols": symbols, "images": images,
                      "sprites": len(layout["sprites"]), "rootLabels": list(layout["rootFrames"]),
                      "graphicsBytes": (OUT / "original-graphics.js").stat().st_size}))


if __name__ == "__main__":
    main()
