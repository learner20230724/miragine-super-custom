# Original UI artwork and canvas helper

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
