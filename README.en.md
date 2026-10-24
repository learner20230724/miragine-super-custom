# Super Miragine War · Customization Project

[中文](README.md)

This independent customization repository starts from commit `8554d89713456368378738744bfeb32ec41c2689` of the [faithful reconstruction](https://github.com/learner20230724/miragine-super-rebuild), which remains untouched. Features include **0–20× speed, manual pause, F2 settings, independent red/blue units and crystals, live resources, cancellable batched spawning, four editable AI profiles and presets**, plus an independent 240 FPS display target and compact oblique battlefield overview. Original rules, default values and assets are retained; explicit actions enable custom behavior. Historical records cover only their corresponding versions.

An editable JavaScript project based on the **super Flash version**, with recovered sources, original assets, and traceable data. This is neither the JKS remake nor the C++ network reimplementation.

**Runnable preview:** combat logic is manually ported from recovered AS3 to JavaScript and rendered with Canvas / WebGL, without Flash or a SWF player. One instrumented original normal-difficulty match matches all 6,842 logic-state frames; this does not establish all Adobe Flash behavior or pixel-perfect parity. See the [verification record](docs/verification.json) for delivery status.

**Current source: v0.5.0-preview.2 usability update.** Left-drag the battlefield, type speed changes immediately, clear troops without confirmation, navigate AI categories through menus, and see difficulty separately from custom-rule status. Publication status is below.

**Retains v0.5.0-preview.1 native-window-resolution rendering.** Stage layout retains 640×480 logical coordinates and combat simulation remains 30 Hz; backing pixels now follow the fitted game viewport and display DPR instead of enlarging a completed 640×480 bitmap. Original PNGs and rules are unchanged. See the [implementation guide](docs/native-resolution.en.md).

## Windows portable build

Download the Windows x64 preview from the **[custom Releases](https://github.com/learner20230724/miragine-super-custom/releases)**, extract the entire archive, then double-click `Start-Game.cmd` or `MiragineSuper.exe`. The runtime is bundled; Node.js, Python and Flash are not required. Keep this customization in a separate directory from the baseline game.

The current published build is **[v0.5.0-preview.2](https://github.com/learner20230724/miragine-super-custom/releases/tag/v0.5.0-preview.2)**, from runtime commit `2c20cf285ee5575a180388e774ecd9941abc6a20`. **669 source tests, 96 portable settings checks across two launches and 33 focused real-input usability checks passed**, as did [Windows/Linux CI](https://github.com/learner20230724/miragine-super-custom/actions/runs/40070327363). Fresh ZIP extraction, exact source comparison, original-asset/clock invariants and privacy review passed. All **20 remote assets** match local sizes and SHA-256 digests reported by the GitHub API; no complete remote redownload was performed. See the [delivery record](docs/releases/v0.5.0-preview.2.json).

Bundled READMEs retain publication status at the runtime commit; later delivery receipts do not repackage the game. The [v0.5.0-preview.1 native-resolution record](docs/releases/v0.5.0-preview.1.json) and its 663/96/41/9 checks remain historical. This patch makes no new sustained-performance claim.

Historical delivery records remain available for [v0.4.0-preview.2](docs/releases/v0.4.0-preview.2.json), [v0.4.0-preview.1](docs/releases/v0.4.0-preview.1.json), [v0.3.0-preview.2](docs/releases/v0.3.0-preview.2.json) and [v0.3.0-preview.1](docs/releases/v0.3.0-preview.1.json). Their measurements validate only their corresponding versions.

Edit the external `config/custom.json` and restart to apply changes; the panel never rewrites it. Desktop drafts/presets live in `userdata/custom-settings.json`; restoring them still requires explicit application. Back up both files before upgrading. `ui-helper/` contains replaceable drawing code; `build-info.json` identifies the source commit. See inherited [baseline verification](docs/verification.json) and [known issues](docs/known-issues.md).

This runtime commit's tracked source occupies **66.13 MB** (66,134,116 bytes), including **11.97 MB** of runtime assets; the Windows ZIP is **170.59 MB** and unpacks to **402.26 MB**. Sizes use decimal MB and exclude development dependencies, Git history and generated user data. Both 20× and 240 FPS remain targets, not guarantees.

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
| Left / right / middle mouse drag | Pan into free observation; left dragging starts after 5 CSS pixels, so simple clicks do not pan |
| F2 | The only settings entry: opening/closing never changes pause state. Side-by-side in wide windows, stacked in narrow windows |
| Lower-left pause/resume text | Manual pause/resume; crisp clickable text above matching help/quit controls |
| Settings speed slider / numeric input | 0–20× in 0.1 increments: 0 pauses, 1 is normal, 0.1–0.9 is slow motion |
| Settings time section | Speed and the full-width pause/resume button together |
| View section below: free / overview / follow | Manual observation / compact battlefield framing / original follow camera |
| Settings display ceiling | Select 30/60/120/240 FPS targets without changing the game step |
| Esc | Close the open settings panel first; otherwise show leave-match confirmation |
| F11 / view-section fullscreen | Toggle fullscreen, distinct from camera overview |

The menu offers four single-player difficulties and local two-player play. Network multiplayer is not implemented.

### Performance

**The released build renders into native window pixels:** 640×480 is the logical coordinate system, while the visible backing size is the fitted game viewport's CSS size × DPR, rounded to pixels. Ground retains its 640×400 logical projection but uses a matching-density WebGL surface and one-entry cache. HUD caches are cropped and aligned to device pixels; obsolete buffers are released on size/DPR changes. Input maps CSS coordinates to game coordinates without an extra DPR multiplier. Resizing while paused redraws without advancing simulation.

Original art gains no invented detail: extreme enlargement still exposes finite PNG resolution, not AI remastering. All **9 isolated frozen sprite fixtures** matched an independent one-pass reference using the same original PNG, with no changed reference pixels. This verifies the sampling path, not full-screen/Flash pixel parity or newly created detail. More pixels still cost memory/GPU work. See the [native-resolution guide](docs/native-resolution.en.md) for implementation and verification boundaries.

**Short local comparison:** the previous v0.4.0-preview.2 portable build and frozen v0.5 runtime source both used Electron **44.4.3**, a **3273×2455** final target, 128 soldiers plus two crystals, disabled recruitment, muted audio and a 240 presentation target. Across five scenarios requesting four seconds each, the old path submitted **4.26–5.30 frames/second**, versus **48.99–49.60** for the native source; the live 1× native scene advanced at **29.88 logic steps/second**. These are short source-development measurements, not a sustained final-package benchmark, physical monitor FPS or a 240 FPS guarantee. Random seeds and external desktop load were not controlled; live scenes may diverge. See the Release's measurement records for conditions and limitations.

**Original-pixel sampling is retained:** sprites still project directly from preserved PNGs, skipping the intermediate 0.9-scale rasterization while retaining logical dimensions, foot anchors, clipping and animation timing. The previously retained 25 larger thunderball/storm bitmaps total 46,676 bytes; the final transparent storm frame remains. This change adjusts drawing-target density, not scenery, character images, artificial detail or handwritten configuration. No Flash pixel equivalence is claimed; `spriteRasterMode: 'legacy'` remains available for comparison. Check retained assets with `python -B tools/build_source_effects.py --check`.

Settings start collapsed with no persistent F2 launcher. Press F2 to edit while the battle runs; opening/closing never pauses or resumes it. Pause is explicitly controlled by the player. Overview frames the full red/blue crystal sprites near the viewport edges, reducing empty outer scenery without promising all map corners. Wheel zoom still allows a wider view.

One game second still contains **30 complete original logic steps**. 20× requests **600 steps per real second**, not 600 FPS or guaranteed throughput for every army size/machine. Independent rendering interpolates positions/cameras without adding original animation poses. The panel separates target speed, actual simulation rate and actual presentation rate; 240 FPS is a ceiling. Menus, observation and music use real time. Dense combat sounds are bounded/coalesced, never queued for later playback.

See the [time-control guide](docs/time-control.en.md) for this game's implementation and limits. This release focuses on in-game controls, not an external universal accelerator. Older reconstruction measurements remain in the [baseline performance record](https://github.com/learner20230724/miragine-super-rebuild/releases/download/v0.1.0-preview.2/performance-comparison.json), not as evidence for this release.

Combat retains the original **30 Hz** simulation. Static button shadows, unchanged health bars and results panels are cached instead of recalculating full-stage filters at every display refresh. Numbers, pointer tooltips, selection pulses and transitions still update; asset resolution is not reduced. Profile an independently extracted test copy with:

```sh
node tools/profile-desktop.mjs --dir <test-copy-directory> --out .local/performance.json
```

The tool enters a real match through the menus and measures both ordinary gameplay and a unit tooltip. Browser callback rate, final canvas submission rate and the 30 Hz simulation rate are recorded separately, not interchangeable FPS claims.

## Change game parameters

The current release retains the single-apply-button layout described below.

**Use F2 for interactive editing:**

- **Current match / basics:** red and blue status appear together. Edit money, round income, remaining population, current/max crystal HP, attacks and common limits; Enter or leaving the input applies that field. Clear red, blue or both directly.
- **Units:** independent red/blue columns for the same unit; explicitly apply the draft afterward. Editing one side does not automatically change the other.
- **Starting settings:** initial money, income, first-round population and wait time together; current resources are not reset.
- **Difficulty / AI:** all four cards are expanded, with counter probability, income/money/count thresholds, candidate sets, counter tables and forced-selection rules.
- **Presets / files:** named presets, undo, default drafts and JSON import/export; load/save/import do not activate rules.

Integer resources support **9,007,199,254,740,991**, JavaScript's safe-integer maximum. Excess input clamps immediately instead of failing only after confirmation. The **round-income cap** governs income gained through recruitment, not the held-money balance. The old 100-per-action / 500-total spawn caps are removed: generation runs in cancellable batches with progress. This does not mean arbitrary army sizes fit in memory or run smoothly. See the **[custom settings guide](docs/custom-settings.en.md)** for limits and application timing.

The footer places **Undo**, **Restore original defaults** and one **Apply settings** action in a row. During a match it applies eligible draft rules now and starting fields next match; without an active match it sets next-match rules without starting combat. Homepage fields still apply immediately; the footer can apply other outstanding draft edits. HP-limit edits consistently preserve health ratios, with no health-policy selector. Existing cooldowns, the current countdown and resources are not reset. Building construction, active skills, fixed waves and scripted reinforcements are absent from this game, so no invented controls are provided.

### Why does the computer choose these troops?

After each single-player round's income payout, blue enters either the counter or ordinary-random branch according to its difficulty probability. Counter selection counts red's dominant troop type and samples a fixed response table; the other branch picks a candidate set by income. Money/elite thresholds can then override the result. Defaults force unit 15 when blue money is **>15030**, or red units 14/15 counted in that counter branch total **>2**—not twenty thousand. Thresholds, candidate tables and switches are now editable per difficulty. This AI does not automatically relearn counters after unit damage/armor edits; see the [full algorithm and boundaries](docs/custom-settings.en.md#ai-selection-and-editable-parameters).

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
| `src/customization/` | Fields/drafts/presets; `runtime.mjs` is the separate custom adapter, `numeric.mjs` handles safe integers and finite arithmetic without editing recovered core |
| `src/app/settings-panel.mjs`, `custom-storage.mjs`, `game-text-controls.mjs` | Settings UI, persistence and native crisp-text controls |
| `src/render/` | Battlefield, perspective projection, native-pixel ground and one-entry cache; logical projection does not change with DPR |
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
