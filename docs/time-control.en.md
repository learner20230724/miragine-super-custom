# Speed, pause and presentation in this game

[中文](time-control.zh-CN.md) · [Settings guide](custom-settings.en.md)

This guide describes the v0.7.0-preview.1 release candidate with new 50×/100× quick buttons; final verification is pending. These controls target Super Miragine War itself, not a universal external accelerator. No system-clock changes, process injection, Cheat Engine or SWF player are used: complete logic steps are scheduled directly in this game's source.

## Controls

Press **F2** to open settings; there is no permanent settings button over the game. Opening or collapsing the dock **does not pause or resume** combat. F2, Esc or the close control hides it.

The first section contains **speed and pause/resume together**. The section beneath it contains **free observation, follow, overview, fullscreen and display targets**. Clear clickable pause/resume text also appears above help/quit at the lower left of the game, so pausing does not require the dock. F11 remains the fullscreen shortcut.

The slider/numeric input accepts **0–100× in 0.1 increments**. Existing quick choices remain, with new **50× and 100×** buttons. Zero pauses, 1 is normal, and 0.1–0.9 is slow motion. Excess numeric input clamps to 100 instead of showing a range-rejection dialog. One game second always contains **30 original logic steps**; the rule frequency is not changed to 240, 600 or 3,000 Hz.

| Selected speed | Target logic steps per real second | Target game time per real second |
|---|---:|---:|
| 0 | 0 | Paused |
| 0.5 | 15 | 0.5 seconds |
| 1 | 30 | 1 second |
| 2 | 60 | 2 seconds |
| 4 | 120 | 4 seconds |
| 8 | 240 | 8 seconds |
| 12 | 360 | 12 seconds |
| 20 | 600 | 20 seconds |
| 50 | 1,500 | 50 seconds |
| 100 | 3,000 | 100 seconds |

These are **throughput targets, not guarantees**. The dock separately reports requested speed, actual battle steps/real second and actual presentations/real second. Large armies, CPU load, window scheduling and per-batch work limits may prevent reaching 50×/100×; selecting 100× is not evidence of measured 3,000-step/s performance.

## Clock mechanism and pause

The clock accumulates `accepted real time × multiplier`. Each `1000 / 30` game milliseconds executes one complete original step, including recruitment, movement, attacks, collisions and RNG. Rules are not skipped and damage/cooldowns are not modified to fake acceleration. Changing speed does not rescale an existing fractional remainder.

- Pause selects 0×; resume restores the last positive speed. Camera observation, menus and explicit sandbox edits remain responsive at 0×. The settings panel adds no editor pause reason.
- Changes settle the old rate at a real-time boundary before selecting the new one. Paused time is never repaid on resume. Normal battle input is gated, while explicit sandbox edits can refresh a stationary world.
- Menus/result transitions use real time, so 0× cannot permanently freeze menus. Music continues normally; entering pause stops current combat effects.
- Both visibility-change edges synchronize a zero-progress clock, preventing hidden time from being replayed after resume.
- Each real-time delta is capped at **250 ms before** speed multiplication. Excess wall time is discarded to avoid unlimited catch-up. Accepted simulation demand still executes step by step; severe stalls reduce achieved speed.
- **Accelerated-work guard:** above 1×, each batch executes at most **24 complete steps**, or stops catch-up when an **8 ms** simulation budget is reached between steps. Expired whole-step demand is discarded while the sub-step remainder is retained. Battle frame/RNG state is never advanced without a full step: actual speed falls instead. This is a soft between-step budget, not preemption of one slow step. Original 1× and slow-motion scheduling are not subject to this added guard.

Removing sandbox army caps does not remove CPU/memory limits. Creation now yields between small batches, but combat targeting/separation can grow roughly as the square of army size. A large battle may run below the selected speed even at a low display target.

## Independent display, camera and sound

- Display targets are **30/60/120/240 FPS**, independent of the 30 Hz game-time step. At most one presentation occurs per `requestAnimationFrame`; missed slots are not repaid with bursts. Monitor refresh, browser scheduling, CPU/GPU and drawing costs limit actual cadence.
- Position/camera interpolation creates presentation copies only, preserving current draw order, poses, HP and visibility. Birth/removal/action discontinuities snap to current state. It creates no new animation poses and normally adds up to one logic step of visual latency.
- Use the **wheel to zoom**, **right/middle-button drag to pan**, and **I/J/K/L to move**. Free observation keeps the current framing without automatic follow; Follow restores following; Overview changes framing, not fullscreen state.
- Keyboard movement uses world coordinates and real time. Default crystal separation is `4200 − 300 = 3900`; a four-second crossing is **975 world units/second**. Diagonal input is normalized. Zoom and game speed do not change this rate; boundaries and severe stalls can still limit displacement.
- Overview tightly frames the full red/blue crystal sprites near the view edges while retaining the oblique angle and vertical allowance. Exterior decoration or near map corners may fall outside the view; they remain in the simulation. The wheel can zoom out further; the development API `fitMap()` supports complete-map framing.
- Fullscreen fills the window/screen while preserving game aspect ratio. It does not itself zoom to the crystal overview. The desktop button and F11 use the native window fullscreen state; browser mode uses the browser fullscreen API.
- Music/fades retain normal real-time speed and pitch. Dense combat effects are merged per batch, same-name effects deduplicated within **40 ms** of real time, and concurrent effects capped at **32**, prioritizing UI clicks. High speed can coalesce/drop effects rather than queue them, without modifying simulation events or RNG.

## Source entry points

| Entry point | Responsibility |
|---|---|
| [`src/runtime/game-clock.mjs`](../src/runtime/game-clock.mjs) | Fixed steps, speed and independent presentation; [API contract](../src/runtime/README.md) |
| [`src/app/playback-session.mjs`](../src/app/playback-session.mjs) | Game input, menu timing, pause state, snapshots and new-match resets |
| [`src/app/custom-controls.mjs`](../src/app/custom-controls.mjs), [`settings-panel.mjs`](../src/app/settings-panel.mjs) | Time/view sections, dock and explicit editing actions |
| [`src/app/game-text-controls.mjs`](../src/app/game-text-controls.mjs) | Clear clickable in-game pause/help/quit text |
| [`src/render/view-camera.mjs`](../src/render/view-camera.mjs) | Oblique observation, compact overview and world-coordinate keyboard movement |
| [`src/app/audio.mjs`](../src/app/audio.mjs) | Real-time music and bounded effects |
| [`src/app/main.mjs`](../src/app/main.mjs) | RAF, input isolation, fullscreen, visibility boundaries and measured rates |

The internal clock is source-reusable, but other games still require step/input/menu/timer/audio/snapshot adapters. This version does not integrate Zombie Builders or Mini Richman. Measure battle time using `simulation.frame / 30`, not the generic clock's scheduled callback count: menu callbacks may not advance a battle. Speed, pause, display target and camera settings are not stored in rules presets.
