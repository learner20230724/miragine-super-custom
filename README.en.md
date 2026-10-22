# Super Miragine War · Source Reconstruction

[中文](README.md)

An editable JavaScript project based on the **super Flash version**, with recovered sources, original assets, and traceable data. This is neither the JKS remake nor the C++ network reimplementation.

**Work in progress:** combat logic is manually ported to native JavaScript and rendered with Canvas / WebGL. The game does not require a Flash plugin or SWF player. Full-match frame-by-frame parity, Windows package installation, and release acceptance remain separate validation tasks; this is not a claim of a finished one-to-one replica.

## Run locally

Install Git, **Node.js 22.12 or newer**, and npm. Python 3 is also needed to regenerate data and assets. Initial dependency and Electron downloads require internet access.

```sh
git clone https://github.com/learner20230724/miragine-super-rebuild.git
cd miragine-super-rebuild
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
| Esc | Open the leave-match confirmation |
| F11 | Toggle fullscreen |

The menu offers four single-player difficulties and local two-player play. Network multiplayer is not implemented.

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

Run `npm run build:windows` for a local Windows x64 package in a separate directory under `dist/`. **A build command is not evidence of a published or installation-tested release.** Consult subsequent repository records for downloadable builds and their verification results.

## Attribution and licensing

See **[NOTICE.txt](NOTICE.txt)** for the boundaries between original game content, third-party components, and project code. This is an independent reconstruction, not an original-author open-source release. Do not assume a blanket MIT license covers all assets and recovered code.
