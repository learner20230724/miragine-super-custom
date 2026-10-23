# Super Miragine War · Customization Project

[中文](README.md)

This independent customization repository starts from commit `8554d89713456368378738744bfeb32ec41c2689` of the [faithful reconstruction](https://github.com/learner20230724/miragine-super-rebuild), which remains untouched. Added features include **0–20× speed, pause, collapsible settings, unit/economy editing, sandbox spawning, named presets and JSON import/export**, plus an independent 240 FPS display target and compact oblique battlefield overview. Original rules, default values and assets are retained; custom rules require explicit application. Historical records cover only their corresponding versions.

An editable JavaScript project based on the **super Flash version**, with recovered sources, original assets, and traceable data. This is neither the JKS remake nor the C++ network reimplementation.

**Runnable preview:** combat logic is manually ported from recovered AS3 to JavaScript and rendered with Canvas / WebGL, without Flash or a SWF player. One instrumented original normal-difficulty match matches all 6,842 logic-state frames; this does not establish all Adobe Flash behavior or pixel-perfect parity. See the [verification record](docs/verification.json) for delivery status.

## Windows portable build

Download the Windows x64 preview from the **[custom Releases](https://github.com/learner20230724/miragine-super-custom/releases)**, extract the entire archive, then double-click `Start-Game.cmd` or `MiragineSuper.exe`. The runtime is bundled; Node.js, Python and Flash are not required. Keep this customization in a separate directory from the baseline game.

The current portable build is **[v0.3.0-preview.2](https://github.com/learner20230724/miragine-super-custom/releases/tag/v0.3.0-preview.2)**, built from runtime commit `c1dcb85`. It improves original-pixel sampling without changing the v0.3 settings features. All 497 source tests, 96 browser interactions and 96 actual-EXE checks passed, including clean ZIP extraction, two launches, persistent presets, native export and clipping checks for all 594 frames. Package/source byte comparisons and privacy review passed. See the [delivery record](docs/releases/v0.3.0-preview.2.json) and Release attachments; this does not promise increased FPS or a complete HD art remaster.

Historical **[v0.3.0-preview.1](https://github.com/learner20230724/miragine-super-custom/releases/tag/v0.3.0-preview.1)** used runtime commit `75e4c6f`; its 471 source tests, 97 EXE interactions and 10 additional pause/resume cycles remain in its [own record](docs/releases/v0.3.0-preview.1.json), not as evidence for the new build.

Edit the external `config/custom.json` and restart to apply changes; the panel never rewrites it. Desktop drafts/presets live in `userdata/custom-settings.json`; restoring them still requires explicit application. Back up both files before upgrading. `ui-helper/` contains replaceable drawing code; `build-info.json` identifies the source commit. See inherited [baseline verification](docs/verification.json) and [known issues](docs/known-issues.md).

Tracked source is approximately 65.6 MB, including 12.0 MB of runtime assets; the Windows ZIP is 170.5 MB and unpacks to 402.1 MB. These exclude development dependencies, Git history and generated user data. The [v0.2.0-preview.1 record](docs/releases/v0.2.0-preview.1.json) remains available. Both 20x and 240 FPS are targets, not guarantees: the earlier settings-release maximized native-window 20x sample achieved approximately 5.6x, depending on army size and display load. It is not a controlled performance comparison for this sampling change.

Extract to a reasonably short directory path: deeply nested Windows paths can prevent Chromium from initializing local runtime data. The generated `userdata/` and `.tmp/` directories are local data, not release contents. The never-show-help preference persists across restarts in `userdata/preferences.json`; delete that file to restore the initial tutorial.

## Run locally

Install Git, **Node.js 22.12 or newer**, and npm. Python 3.10+ is also needed to regenerate data and assets. Initial dependency and Electron downloads require internet access.

```sh
git clone https://github.com/learner20230724/miragine-super-custom.git
cd miragine-super-custom
npm ci --ignore-scripts
npm run setup:electron
npm start
```

If PowerShell execution policy blocks npm's script wrapper, use `npm.cmd` instead of `npm`.

For browser development, the Electron binary is not required:

```sh
npm run dev
```

Open the address printed in the terminal, normally **http://127.0.0.1:51286/**. Use `npm run dev -- --port 51287` for another port. Do not open `index.html` directly. Press `Ctrl+C` to stop the development server. Browser audio may require an initial click or key press.

### Controls

| Input | Action |
|---|---|
| Click a unit | Select unit |
| W / A / S / D | Left player's unit selection |
| Space | Toggle left player's recruitment |
| Arrow keys, Enter | Right player's selection and recruitment in local two-player mode |
| Drag the minimap | Move the camera |
| I / J / K / L | World-coordinate pan: approximately four real seconds between default crystals, independent of zoom/speed |
| Wheel over the battlefield | Pointer-anchored zoom; map boundaries take priority at limits |
| Right / middle mouse drag | Pan the observation camera without changing combat |
| F2 / lower-left settings | Expand/collapse settings; editing pauses by default. Side-by-side in wide windows, stacked in narrow windows |
| Lower-left pause/resume | Pause or resume combat |
| Settings speed slider / numeric input | 0–20× in 0.1 increments: 0 pauses, 1 is normal, 0.1–0.9 is slow motion |
| Settings overview / follow | Compact battlefield framing / original follow camera |
| Settings display ceiling | Select 30/60/120/240 FPS targets without changing the game step |
| Esc | Close the open settings panel first; otherwise show leave-match confirmation |
| F11 | Toggle fullscreen, distinct from camera overview |

The menu offers four single-player difficulties and local two-player play. Network multiplayer is not implemented.

### Performance

**Lightweight original-pixel sampling:** sprites project directly from the preserved PNGs, skipping the intermediate 0.9-scale rasterization while retaining logical dimensions, foot anchors, clipping and animation timing. Thunderball and storm reuse larger bitmaps already embedded in the SWF: 25 byte-identical image copies total 46,676 bytes, with the final transparent storm frame preserved. No AI, real-time super-resolution, new engine or larger stage/ground buffers are introduced. Scenery, existing character frames and custom configuration are not overwritten. This is not a complete art remaster or a claim of Flash pixel parity; the renderer retains `spriteRasterMode: 'legacy'` for comparison. Regenerate/check with `python -B tools/build_source_effects.py` / `--check`; run the independent browser comparison with `node tools/verify-source-rendering.mjs`.

Settings start collapsed, leaving compact lower-left buttons rather than a large overlay. Opening the panel pauses editing by default; use its resume button to watch the battle while editing. Closing it releases only the editor pause, not a manual pause or selected 0×. Overview frames the complete crystal sprites near opposite view edges, reducing exterior space; it does not guarantee every map corner is visible. Wheel zoom still allows a wider view.

One game second still contains **30 complete original logic steps**. 20× requests **600 steps per real second**, not 600 FPS or guaranteed throughput for every army size/machine. Independent rendering interpolates positions/cameras without adding original animation poses. The panel separates target speed, actual simulation rate and actual presentation rate; 240 FPS is a ceiling. Menus, observation and music use real time. Dense combat sounds are bounded/coalesced, never queued for later playback.

See the [time-control guide](docs/time-control.en.md) for this game's implementation and limits. This release focuses on in-game controls, not an external universal accelerator. The preview.2 measurements below belong only to the original reconstruction baseline.

**preview.2** fixes the sustained slowdown after entering combat. With the same maximized window at DPI 1.5, final canvas submissions improved from **4.77 to 28.74 FPS** in the battlefield and **5.05 to 28.44 FPS** with a unit tooltip. Some late frames remain; this is not a locked-30-FPS guarantee for all hardware. See the [measurement conditions](https://github.com/learner20230724/miragine-super-rebuild/releases/download/v0.1.0-preview.2/performance-comparison.json).

Combat retains the original **30 Hz** simulation. Static button shadows, unchanged health bars and results panels are cached instead of recalculating full-stage filters at every display refresh. Numbers, pointer tooltips, selection pulses and transitions still update; asset resolution is not reduced. Profile an independently extracted test copy with:

```sh
node tools/profile-desktop.mjs --dir <test-copy-directory> --out .local/performance.json
```

The tool enters a real match through the menus and measures both ordinary gameplay and a unit tooltip. Browser callback rate, final canvas submission rate and the 30 Hz simulation rate are recorded separately, not interchangeable FPS claims.

## Change game parameters

**Use F2 for interactive editing:** all 16 units, economy/rounds, crystals, four difficulties and automatic behavior. Explicitly apply to the current or next match. Sandbox actions edit current resources, spawn/clear troops, or start a match from the draft. Undo, default-draft restoration, named presets and JSON import/export are available. Loading, saving and importing do not automatically apply rules.

Live application can preserve health ratios or absolute health. Existing cooldowns, the current countdown and resources are not reset; starting values affect only a new match. See the **[custom settings guide](docs/custom-settings.en.md)** for timing, persistence and limits. Building construction, active skills, fixed waves and scripted reinforcements are absent from this game, so no invented controls are provided.

Panel exports use a different format from startup overrides: **do not overwrite `config/custom.json` with an exported draft**. The existing handwritten override workflow remains available:

Edit **[`config/custom.json`](config/custom.json)**, then reload the browser or restart the desktop game. Do not edit generated defaults for lasting customizations.

```json
{
  "schemaVersion": 1,
  "profile": "custom",
  "overrides": {
    "units": {"0": {"cost": 15, "hp": 60}},
    "rules": {"incomeLimit": 10000},
    "difficulties": {"3": {"rightStartingIncome": 650}}
  }
}
```

Unit keys are menu IDs `"0"`–`"15"`, not animation indices (`ss`). Objects merge recursively; arrays replace whole arrays. Empty `overrides` retain original default values. See the **[English parameter reference](docs/parameters.en.md)** / [中文参数表](docs/parameters.zh-CN.md) for units, economy, manpower, attack-speed conversions, animation, and difficulty settings.

## Project entry points

| Path | Purpose |
|---|---|
| `src/core/` | Headless simulation, units, attack objects, scene, and AS3 numeric semantics |
| `src/app/` | Menus, input, match flow, audio, and interface |
| `src/runtime/` | Fixed-step clock, presentation scheduling and interpolation; this game's pause/speed adapter is `src/app/playback-session.mjs` |
| `src/customization/` | Editable fields, validation, drafts/presets, explicit application and sandbox adapter |
| `src/app/settings-panel.mjs`, `custom-storage.mjs` | Settings UI and browser/desktop persistence |
| `src/render/` | Battlefield, perspective projection, ground, and character rendering |
| `src/platform/`, `desktop/` | Viewport/input-coordinate transforms and Electron integration |
| `src/config/` | Configuration loading, validation, and override merging |
| `config/defaults.generated.json` | Generated defaults extracted from recovered code |
| `config/custom.json` | User overrides, preserved during regeneration |
| `src/extensions/custom.mjs` | Reserved custom extension entry; currently empty, not an automatically wired plugin system |
| `assets/generated/`, `generated/` | Generated runtime media, asset manifest, UI, and configuration provenance |
| `recovered/`, `reference/` | Decompiled AS3, exports, and verified original SWFs for provenance and comparison |
| `tools/`, `tests/` | Extraction, generation, packaging, publication checks, and tests |

The original SWF is reference evidence, **not the production game engine**. Recovered AS3 is not the author's complete original editor project. Production logic lives in `src/`; original images, sounds, fonts, and UI graphics enter through the generation pipeline. Defaults target the super version; new gameplay should remain separate from those defaults.

## Development checks

```sh
npm test
npm run check:data
npm run check:public
```

Regenerate runtime data and media after changing recovered inputs:

```sh
python -B tools/extract_game_config.py
python -B tools/build_assets.py
python -B tools/build_ui.py
```

These generators update designated generated outputs, not `config/custom.json` or `src/extensions/`. `tools/prepare_ffdec.py` and `tools/export_reference.py` handle fresh FFDec exports; normal parameter editing and gameplay do not require re-exporting.

Windows x64 packaging uses `npm run build:windows`, requires committed public source, and writes a fresh build directory under `dist/`. Release assets and verification records identify the corresponding commit, hashes and isolated launch tests; local builds do not upload automatically.

## Attribution and licensing

See **[NOTICE.txt](NOTICE.txt)** for the boundaries between original game content, third-party components, and project code. This is an independent reconstruction, not an original-author open-source release. Do not assume a blanket MIT license covers all assets and recovered code.
