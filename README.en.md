# Super Miragine War · Customization Project

[中文](README.md)

This independent customization repository starts from commit `8554d89713456368378738744bfeb32ec41c2689` of the [faithful reconstruction](https://github.com/learner20230724/miragine-super-rebuild), which remains untouched. Features include **0–100× speed, manual pause, automatically saved F2 settings, independent red/blue units and crystals, live resources, cancellable batched spawning, four editable AI profiles and presets**, plus an independent 240 FPS display target and compact oblique battlefield overview. Original rules, default values and assets are retained; explicit actions enable custom behavior. Historical records cover only their corresponding versions.

An editable JavaScript project based on the **super Flash version**, with recovered sources, original assets, and traceable data. This is neither the JKS remake nor the C++ network reimplementation.

**Runnable preview:** combat logic is manually ported from recovered AS3 to JavaScript and rendered with Canvas / WebGL, without Flash or a SWF player. One instrumented original normal-difficulty match matches all 6,842 logic-state frames; this does not establish all Adobe Flash behavior or pixel-perfect parity. See the [verification record](docs/verification.json) for delivery status.

**Current source: v0.7.1-preview.1 release candidate, confirmation-dialog interaction fix.** In response to inputs becoming uneditable after confirming Restore original defaults, this candidate uses an asynchronous in-app confirmation with Cancel focused by default and Escape to cancel; editing by mouse and keyboard should remain available afterward. Reproduction and packaged verification are still in progress, and this candidate is not published. Earlier verification below does not validate this fix. Parameter behavior, automatic saving, reset scope and hit/lifetime improvements are unchanged.

**Current published version: v0.7.0-preview.1, automatic settings application and 50×/100× quick choices.** Verification and remote-asset checks are complete; the current delivery record below reports the actual results. Retains the v0.6.0 large-army optimization: spatial indexes accelerate targeting and same-side separation, presentation buffers are reused, fully off-screen sprites are culled, and finished spawn jobs release their battle reference. Original 30 Hz logic, assets and native-window rendering remain; no troop cap is added. Current and historical delivery results are recorded separately below.

**Current source also enables the requested custom hit rules:** ranged projectiles follow a straight trajectory and hit the first enemy contacted; ordinary attacks damage their locked target after the original firing delay, supporting long-range melee customization. Red/blue crystal projectile life is fixed at 253 steps; vampire/mage life still budgets for 1.1 map widths. Firing range, damage/armor formulas, cooldowns, speed controls and the 30 Hz simulation rate are unchanged. Startup is marked as custom rules. Restoring panel parameters retains the previously approved trajectory-hit and lifetime improvements and does not rewrite the startup file. See [hit rules](docs/combat-hits.en.md) and [projectile lifetime](docs/projectile-lifetime.en.md).

**Clearing troops retains their original death animation.** Clearing red, blue or both sides immediately removes troops from combat and targeting lists, while their original backward-fall animation remains visible instead of vanishing instantly. Crystals take no damage, no refund is given, and associated attacks are cleared. Animation waits during pause/0× and continues on resume; repeated clearing does not restart existing corpses. See [clearing behavior](docs/custom-settings.en.md#spawn-and-clear).

**Retains v0.5.0-preview.1 native-window-resolution rendering.** Stage layout retains 640×480 logical coordinates and combat simulation remains 30 Hz; backing pixels now follow the fitted game viewport and display DPR instead of enlarging a completed 640×480 bitmap. Original PNGs and rules are unchanged. See the [implementation guide](docs/native-resolution.en.md).

## v0.7.0-preview.1 delivery

Published **[v0.7.0-preview.1](https://github.com/learner20230724/miragine-super-custom/releases/tag/v0.7.0-preview.1)** uses runtime commit `3d992112c246dd449c56edb9b5202e7b93777e00`. The EXE verification tool has a separate commit, `1320b80cf1dfe8677bbcb13a183751fcbffb739a`, correcting a verifier operation that treated a select as a text input; the packaged runtime did not change.

| Delivery / verification | Result |
|---|---|
| Runtime-source tests | **836 passed** |
| Isolated portable EXE | **47 real-input checks across 2 launches passed**, zero runtime errors; personal installation/migration checks excluded |
| CI | [Windows and Linux passed](https://github.com/learner20230724/miragine-super-custom/actions/runs/40082589169) |
| Remote assets | All **20** sizes and API SHA-256 digests match; tag identifies the runtime commit. No complete remote redownload |
| Windows ZIP | **170,643,556 bytes** (170.64 MB) |
| Extracted package | **402,405,410 bytes / 105 files** (402.41 MB) |
| Source privacy-scan coverage | **3,106 files / 66,475,822 bytes** (66.48 MB), not total repository/history disk usage |
| Privacy and assets | **0** unresolved privacy findings; original/generated assets unchanged from the preceding version |

The [post-publication receipt](docs/releases/v0.7.0-preview.1.json) records runtime/tool versions and asset digests. Candidate wording in bundled READMEs/guides reflects frozen build-time status; this receipt adds publication evidence without repackaging. 50×/100× and 240 FPS are targets, not sustained-throughput guarantees.

## Windows portable build

**Source versus portable build:** v0.6.0-preview.1 **already includes vampire/mage lifetime extension**. Trajectory collisions, delayed direct ordinary hits and the 253-step crystal lifetime were introduced in v0.6.1-preview.1 and are included with animated troop clearing in published v0.6.2-preview.1. The old v0.6.0 EXE lacks these new rules and does not update automatically. See the current delivery receipt below for assets and verification results. Merge the new extension fields into external configuration while preserving personal settings. Configure them in `config/custom.json`; no new panel fields were added. See [hit parameters and development entry points](docs/combat-hits.en.md).

Download the Windows x64 preview from the **[custom Releases](https://github.com/learner20230724/miragine-super-custom/releases)**, extract the entire archive, then double-click `Start-Game.cmd` or `MiragineSuper.exe`. The runtime is bundled; Node.js, Python and Flash are not required. Keep this customization in a separate directory from the baseline game.

### v0.6.2-preview.1 delivery

Published **[v0.6.2-preview.1](https://github.com/learner20230724/miragine-super-custom/releases/tag/v0.6.2-preview.1)** uses runtime commit `3e2860a2f75dd129d68b9d79d0f56a4be89f7a61`. It preserves original death animation when clearing troops, includes the preceding hit fixes and 253-step crystal lifetime, and retains the original damage/armor formula. **804 source tests and 24 focused portable-EXE clearing checks** passed, together with [Windows/Linux CI](https://github.com/learner20230724/miragine-super-custom/actions/runs/40076916041). New-package privacy review has zero unresolved findings. All **14 public assets** match local sizes and GitHub API SHA-256 digests both before and after publication; the remote version tag points to that runtime commit. No complete remote redownload was performed. See the [delivery record](docs/releases/v0.6.2-preview.1.json).

This runtime commit contains **66.38 MB** of source (66,378,141 bytes), including **11.97 MB** of runtime assets. The Windows ZIP is **170.63 MB** (170,631,735 bytes), extracted **402.37 MB** (402,368,863 bytes), using decimal MB. **Publishing does not replace an existing local installation or automatically update a running game.** Bundled READMEs/documents retain their release-candidate status at the runtime commit; this post-publication receipt adds delivery evidence without repackaging or changing the game.

Historically published **[v0.6.0-preview.1](https://github.com/learner20230724/miragine-super-custom/releases/tag/v0.6.0-preview.1)**, runtime commit `6c575f808004f8fc46a086aad5d8eee322ed142a`, merging large-army optimization and the requested projectile-lifetime configuration. **745 source tests, 96 portable settings checks, 33 focused input checks, 28 large-battle checks and 24 pixel-comparison fixtures passed**, as did [Windows/Linux CI](https://github.com/learner20230724/miragine-super-custom/actions/runs/40073111039). All 28 published assets match local sizes and API SHA-256 digests, and the public tag points to the verified commit; no complete remote redownload was performed. See the [delivery record](docs/releases/v0.6.0-preview.1.json). Runtime-commit source is **66.30 MB** including **11.97 MB** of assets; ZIP **170.61 MB**, extracted **402.31 MB** (decimal). Bundled READMEs preserve publication status at the runtime commit; this later receipt does not repackage the game.

Historical **[v0.5.0-preview.2](https://github.com/learner20230724/miragine-super-custom/releases/tag/v0.5.0-preview.2)**, from runtime commit `2c20cf285ee5575a180388e774ecd9941abc6a20`. **669 source tests, 96 portable settings checks across two launches and 33 focused real-input usability checks passed**, as did [Windows/Linux CI](https://github.com/learner20230724/miragine-super-custom/actions/runs/40070327363). Fresh ZIP extraction, exact source comparison, original-asset/clock invariants and privacy review passed. All **20 remote assets** match local sizes and SHA-256 digests reported by the GitHub API; no complete remote redownload was performed. See the [delivery record](docs/releases/v0.5.0-preview.2.json).

Bundled READMEs retain publication status at the runtime commit; later delivery receipts do not repackage the game. The [v0.5.0-preview.1 native-resolution record](docs/releases/v0.5.0-preview.1.json) and its 663/96/41/9 checks remain historical. This patch makes no new sustained-performance claim.

Historical delivery records remain available for [v0.4.0-preview.2](docs/releases/v0.4.0-preview.2.json), [v0.4.0-preview.1](docs/releases/v0.4.0-preview.1.json), [v0.3.0-preview.2](docs/releases/v0.3.0-preview.2.json) and [v0.3.0-preview.1](docs/releases/v0.3.0-preview.1.json). Their measurements validate only their corresponding versions.

External `config/custom.json` supplies the startup template and is never rewritten by the panel; saved panel settings take precedence over overlapping fields. Current panel settings and named presets live in `userdata/custom-settings.json`; confirmed edits now apply and save automatically, and saved settings restore on restart without an extra Apply action. Back up both files before upgrading. `ui-helper/` contains replaceable drawing code; `build-info.json` identifies the source commit. See inherited [baseline verification](docs/verification.json) and [known issues](docs/known-issues.md).

The historical v0.5.0-preview.2 runtime commit's tracked source occupies **66.13 MB** (66,134,116 bytes), including **11.97 MB** of runtime assets; the Windows ZIP is **170.59 MB** and unpacks to **402.26 MB**. Sizes use decimal MB and exclude development dependencies, Git history and generated user data. Both 20× and 240 FPS remain targets, not guarantees.

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
| Settings speed slider / numeric input | 0–100× in 0.1 increments, including new 50×/100× quick buttons: 0 pauses, 1 is normal, 0.1–0.9 is slow motion |
| Settings time section | Speed and the full-width pause/resume button together |
| View section below: free / overview / follow | Manual observation / compact battlefield framing / original follow camera |
| Settings display ceiling | Select 30/60/120/240 FPS targets without changing the game step |
| Esc | Close the open settings panel first; otherwise show leave-match confirmation |
| F11 / view-section fullscreen | Toggle fullscreen, distinct from camera overview |

The menu offers four single-player difficulties and local two-player play. Network multiplayer is not implemented.

### Performance

Short 1000-soldier A/B test (same Electron, 1280×960 CSS / DPR 1.5, approximately three seconds per scene, 500 basic troops per side): the requested 8× overview improved from **54.85 to 129.25 simulation steps/s** and **34.97 to 46.23 presentation submissions/s**. Actual speed is about 4.31×, **not the 240 steps/s required for 8×**. RNG and external desktop load were uncontrolled; troops started at opposite ends, not a sustained worst-case melee. This comparison deliberately isolates performance changes from the concurrent projectile extension; the combined package is verified separately.

Large-army acceleration lives in `src/performance/`, leaving recovered `src/core/` unchanged. It skips impossible comparisons while retaining original-list target ties, strict distances and reverse separation order; exceptional/extreme inputs fall back to the reference algorithm. Off-screen entities still simulate fully; conservative clipping respects partial sprites, effects and mirroring. Completed jobs keep progress metadata, not old battles. These changes do not promise unlimited armies or sustained 100×: dense contact and large-area attacks still cost work.

**The released build renders into native window pixels:** 640×480 is the logical coordinate system, while the visible backing size is the fitted game viewport's CSS size × DPR, rounded to pixels. Ground retains its 640×400 logical projection but uses a matching-density WebGL surface and one-entry cache. HUD caches are cropped and aligned to device pixels; obsolete buffers are released on size/DPR changes. Input maps CSS coordinates to game coordinates without an extra DPR multiplier. Resizing while paused redraws without advancing simulation.

Original art gains no invented detail: extreme enlargement still exposes finite PNG resolution, not AI remastering. All **9 isolated frozen sprite fixtures** matched an independent one-pass reference using the same original PNG, with no changed reference pixels. This verifies the sampling path, not full-screen/Flash pixel parity or newly created detail. More pixels still cost memory/GPU work. See the [native-resolution guide](docs/native-resolution.en.md) for implementation and verification boundaries.

**Short local comparison:** the previous v0.4.0-preview.2 portable build and frozen v0.5 runtime source both used Electron **44.4.3**, a **3273×2455** final target, 128 soldiers plus two crystals, disabled recruitment, muted audio and a 240 presentation target. Across five scenarios requesting four seconds each, the old path submitted **4.26–5.30 frames/second**, versus **48.99–49.60** for the native source; the live 1× native scene advanced at **29.88 logic steps/second**. These are short source-development measurements, not a sustained final-package benchmark, physical monitor FPS or a 240 FPS guarantee. Random seeds and external desktop load were not controlled; live scenes may diverge. See the Release's measurement records for conditions and limitations.

**Original-pixel sampling is retained:** sprites still project directly from preserved PNGs, skipping the intermediate 0.9-scale rasterization while retaining logical dimensions, foot anchors, clipping and animation timing. The previously retained 25 larger thunderball/storm bitmaps total 46,676 bytes; the final transparent storm frame remains. This change adjusts drawing-target density, not scenery, character images, artificial detail or handwritten configuration. No Flash pixel equivalence is claimed; `spriteRasterMode: 'legacy'` remains available for comparison. Check retained assets with `python -B tools/build_source_effects.py --check`.

Settings start collapsed with no persistent F2 launcher. Press F2 to edit while the battle runs; opening/closing never pauses or resumes it. Pause is explicitly controlled by the player. Overview frames the full red/blue crystal sprites near the viewport edges, reducing empty outer scenery without promising all map corners. Wheel zoom still allows a wider view.

One game second still contains **30 complete original logic steps**. 50×/100× request **1,500/3,000 steps per real second**, not the same number of FPS or guaranteed throughput for every army size/machine. Accelerated batches retain the 24-step/8 ms soft budget: insufficient compute lowers actual speed instead of skipping complete simulation steps. Independent rendering interpolates positions/cameras without adding original animation poses. The panel separates target speed, actual simulation rate and actual presentation rate; 240 FPS is a ceiling. Menus, observation and music use real time. Dense combat sounds are bounded/coalesced, never queued for later playback.

See the [time-control guide](docs/time-control.en.md) for this game's implementation and limits. This release focuses on in-game controls, not an external universal accelerator. Older reconstruction measurements remain in the [baseline performance record](https://github.com/learner20230724/miragine-super-rebuild/releases/download/v0.1.0-preview.2/performance-comparison.json), not as evidence for this release.

Combat retains the original **30 Hz** simulation. Static button shadows, unchanged health bars and results panels are cached instead of recalculating full-stage filters at every display refresh. Numbers, pointer tooltips, selection pulses and transitions still update; asset resolution is not reduced. Profile an independently extracted test copy with:

```sh
node tools/profile-desktop.mjs --dir <test-copy-directory> --out .local/performance.json
```

The tool enters a real match through the menus and measures both ordinary gameplay and a unit tooltip. Browser callback rate, final canvas submission rate and the 30 Hz simulation rate are recorded separately, not interchangeable FPS claims.

## Change game parameters

**Use F2 for interactive editing:** press **Enter or leave the field** to confirm a number. Valid settings apply and save locally without a separate **Apply settings** button. Current-compatible parameters take effect now; starting parameters automatically apply next match. Saved settings restore on restart.

- **Current match / basics:** match/difficulty summary, spawning and clearing, common rules, then red/blue current status. Money, round income, remaining manpower and current crystal HP are live operations, not a battle save.
- **Units:** independent red/blue columns for the same unit; confirmed edits apply automatically without changing the other side.
- **Starting settings:** initial money, income, first-round manpower and wait time take effect next match, without resetting current resources or countdown. The separate Automation (this and later matches) recruitment/AI switches act now and are saved for later matches.
- **Difficulty / AI:** select a difficulty and parameter category to edit probabilities, thresholds, candidate sets, counter tables and forced selection. Only the current difficulty's values affect this match; editing another profile never switches difficulty.
- **Presets / files:** saving a preset makes a named copy, not a required application step. Loading/importing automatically applies and saves settings; JSON export is for backup or exchange.

Integer resources support **9,007,199,254,740,991**, JavaScript's safe-integer maximum. Excess input clamps immediately instead of failing only after confirmation. The **round-income cap** governs income gained through recruitment, not the held-money balance. The old 100-per-action / 500-total spawn caps are removed: generation runs in cancellable batches with progress. This does not mean arbitrary army sizes fit in memory or run smoothly. See the **[custom settings guide](docs/custom-settings.en.md)** for limits and application timing.

The footer contains recovery actions only. **Undo last settings change** actually reapplies the previous rules without rewinding troops, money or battle progress. **Restore original defaults** resets every exposed parameter and applies the result, with starting fields deferred; it does not clear troops, delete named presets or start a match. Previously approved trajectory-hit/lifetime improvements remain. **Return to main menu** explicitly ends this match while keeping settings; it is not a reset action.

The old **unsaved draft** label meant that edits differed from the last loaded/saved editor baseline, **not that no local backup existed or that all edits were inactive**. The new UI replaces that ambiguity with application timing and local-save status. HP-limit edits preserve health ratios; existing cooldowns, the current countdown and resources are not reset. Construction, active skills, fixed waves and scripted reinforcements are absent from the original game, so no invented controls are provided.

### Why does the computer choose these troops?

After each single-player round's income payout, blue enters either the counter or ordinary-random branch according to its difficulty probability. Counter selection counts red's dominant troop type and samples a fixed response table; the other branch picks a candidate set by income. Money/elite thresholds can then override the result. Defaults force unit 15 when blue money is **>15030**, or red units 14/15 counted in that counter branch total **>2**—not twenty thousand. Thresholds, candidate tables and switches are now editable per difficulty. This AI does not automatically relearn counters after unit damage/armor edits; see the [full algorithm and boundaries](docs/custom-settings.en.md#ai-selection-and-editable-parameters).

Panel exports use a different format from startup overrides: **do not overwrite `config/custom.json` with an exported settings document**. The existing handwritten override workflow remains available:

Edit **[`config/custom.json`](config/custom.json)**, then reload the browser or restart the desktop game to read the startup template. Do not edit generated defaults for lasting customizations. Existing saved panel settings override overlapping fields; unexposed extension fields still come from the startup template. To adopt all template values again, first back up local settings, then remove only the current-settings record while retaining the preset library. See [precedence and backups](docs/custom-settings.en.md#presets-migration-and-backups).

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
| `src/extensions/combat-hits.mjs` | Optional swept projectile collisions and delayed ordinary hits; see [hit rules](docs/combat-hits.en.md) |
| `src/extensions/projectile-lifetime.mjs` | Optional mage/vampire distance budget and fixed crystal lifetime; see [projectile lifetime](docs/projectile-lifetime.en.md) |
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
