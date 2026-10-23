# Super Miragine War · Customization Project

[中文](README.md)

This independent customization repository starts from commit `8554d89713456368378738744bfeb32ec41c2689` of the [faithful reconstruction](https://github.com/learner20230724/miragine-super-rebuild), which remains untouched. Added features are **1/2/4/8x game speed, independent presentation up to a 240 FPS target, oblique-view wheel zoom, drag, full-map overview and restored follow mode**. Original core logic, values and assets are retained. Historical preview.2 records describe the inherited baseline; custom verification is recorded separately.

An editable JavaScript project based on the **super Flash version**, with recovered sources, original assets, and traceable data. This is neither the JKS remake nor the C++ network reimplementation.

**Runnable preview:** combat logic is manually ported from recovered AS3 to JavaScript and rendered with Canvas / WebGL, without Flash or a SWF player. One instrumented original normal-difficulty match matches all 6,842 logic-state frames; this does not establish all Adobe Flash behavior or pixel-perfect parity. See the [verification record](docs/verification.json) for delivery status.

## Windows portable build

Download the Windows x64 preview from the **[custom Releases](https://github.com/learner20230724/miragine-super-custom/releases)**, extract the entire archive, then double-click `Start-Game.cmd` or `MiragineSuper.exe`. The runtime is bundled; Node.js, Python and Flash are not required. Keep this customization in a separate directory from the baseline game.

Edit the external `config/custom.json` and restart to apply changes; back it up before upgrading. `ui-helper/` contains replaceable drawing source and instructions. `build-info.json` identifies the source commit. See the [custom verification record](docs/custom-verification.json), inherited [baseline verification](docs/verification.json), and [known issues](docs/known-issues.md).

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
| I / J / K / L | Move the camera |
| Wheel over the battlefield | Pointer-anchored zoom; map boundaries take priority at limits |
| Right / middle mouse drag | Pan the observation camera without changing combat |
| In-game 1x / 2x / 4x / 8x | Speed up game time equally for both sides |
| In-game overview / follow | Fit the whole battlefield / restore the original follow view |
| In-game display ceiling | Select 30/60/120/240 FPS targets without changing the game step |
| Esc | Open the leave-match confirmation |
| F11 | Toggle fullscreen |

The menu offers four single-player difficulties and local two-player play. Network multiplayer is not implemented.

### Performance

**Customization:** one game second still contains 30 original logic steps. At 2/4/8x, the adapter attempts 60/120/240 steps per real second. Rendering is independent and interpolates positions/camera; the original finite animation poses remain unchanged. The toolbar distinguishes requested speed from measured simulation steps and canvas submissions. 240 FPS is a ceiling, not a hardware- or army-independent guarantee. Menus, observation input and music use real time.

See the [reusable time-control toolkit](docs/time-control.en.md) for adapting other games. It is a source-level SDK plus adapters, not an automatic accelerator for arbitrary executables. The preview.2 measurements below belong only to the original reconstruction baseline.

**preview.2** fixes the sustained slowdown after entering combat. With the same maximized window at DPI 1.5, final canvas submissions improved from **4.77 to 28.74 FPS** in the battlefield and **5.05 to 28.44 FPS** with a unit tooltip. Some late frames remain; this is not a locked-30-FPS guarantee for all hardware. See the [measurement conditions](https://github.com/learner20230724/miragine-super-rebuild/releases/download/v0.1.0-preview.2/performance-comparison.json).

Combat retains the original **30 Hz** simulation. Static button shadows, unchanged health bars and results panels are cached instead of recalculating full-stage filters at every display refresh. Numbers, pointer tooltips, selection pulses and transitions still update; asset resolution is not reduced. Profile an independently extracted test copy with:

```sh
node tools/profile-desktop.mjs --dir <test-copy-directory> --out .local/performance.json
```

The tool enters a real match through the menus and measures both ordinary gameplay and a unit tooltip. Browser callback rate, final canvas submission rate and the 30 Hz simulation rate are recorded separately, not interchangeable FPS claims.

## Change game parameters

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
| `src/runtime/` | Reusable fixed-step clock, presentation scheduling and interpolation; game wiring lives in `src/app/playback-session.mjs` |
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
