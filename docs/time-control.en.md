# Speed, pause and presentation in this game

[中文](time-control.zh-CN.md) · [Settings guide](custom-settings.en.md)

These controls target Super Miragine War itself, not a universal external accelerator. No system-clock changes, process injection, Cheat Engine or SWF player are used: complete logic steps are scheduled directly in this game's source.

## Usage and mechanism

Open settings with F2. The slider/numeric input accepts **0–20× in 0.1 increments**. Zero pauses, 1 is normal, and 0.1–0.9 is slow motion. One game second always contains **30 original logic steps**; the rule frequency is not changed to 240 or 600 Hz.

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

These are **throughput targets, not guarantees**. Settings reports requested speed, actual battle steps/real second and actual presentations/real second separately. Large armies, CPU load and window scheduling may prevent reaching 20×; selecting 20× is not evidence of measured 600-step/s performance.

The clock accumulates `accepted real time × multiplier`. Each `1000 / 30` game milliseconds executes one complete original step, including recruitment, movement, attacks, collisions and RNG. Rules are not skipped and damage/cooldowns are not modified to fake acceleration. Rate changes do not rescale an existing fractional remainder.

## Pause and background behavior

- **Speed 0** freezes combat while presentation, camera observation and menus remain responsive. The lower-left resume button can restore the previous positive speed.
- **Editor pause** is a separate reason, enabled when opening settings. Releasing it does not override 0× or a manual pause; collapsing the panel releases only the editor reason.
- Changes settle the old rate at a real-time boundary before selecting the new rate. Paused time is never repaid on resume. Normal battle input is gated, but explicit sandbox actions can refresh a stationary world.
- Menus/result transitions use real time, so 0× cannot permanently freeze menus. Music continues normally; entering pause stops current combat effects.
- Both visibility-change edges synchronize a zero-progress clock, preventing hidden time from being replayed after resume.
- Each real-time delta is capped at **250 ms before** speed multiplication. Excess wall time is discarded to avoid unlimited catch-up. Accepted simulation budget still executes step by step; severe stalls reduce achieved speed.
- **Accelerated-work guard:** above 1×, each batch executes at most **24 complete steps**, or stops catch-up when an **8 ms** simulation budget is reached between steps. Expired whole-step time demand is discarded while the sub-step remainder is retained. Battle frame/RNG state is never advanced without a full step: actual speed falls instead. This is a soft between-step budget, not preemption of one slow step. Original 1× and slow-motion scheduling are not subject to this added guard.

## Presentation, camera and sound

- Independent display targets are 30/60/120/240 FPS. At most one presentation occurs per `requestAnimationFrame`; missed slots are not repaid with bursts. Monitor refresh, browser scheduling, CPU/GPU and drawing costs limit actual cadence.
- Position/camera interpolation creates presentation copies only, preserving current draw order, poses, HP and visibility. Birth/removal/action discontinuities snap to current state. It creates no new animation poses and normally adds up to one logic step of visual latency.
- I/J/K/L move in world coordinates using real time. Default crystal separation is `4200 − 300 = 3900`; a four-second crossing is **975 world units/second**. Diagonal input is normalized. Zoom and game speed do not change this rate; map boundaries and severe stalls can still limit displacement.
- Overview tightly frames the full crystal sprites near the view edges, retaining the oblique angle and vertical allowance. Exterior decoration or near map corners may fall outside the view; they are not deleted or hidden from simulation. The wheel can zoom out further; the development API `fitMap()` still supports complete-map framing.
- Music/fades retain normal real-time speed and pitch. Dense combat effects are merged per batch, same-name effects deduplicated within **40 ms** of real time, and concurrent effects capped at **32**, prioritizing UI clicks. High speed can coalesce/drop effects rather than queue them, without modifying simulation events or RNG.

## Source entry points

| Entry point | Responsibility |
|---|---|
| [`src/runtime/game-clock.mjs`](../src/runtime/game-clock.mjs) | Fixed steps, 0–20× speed and independent presentation; [API contract](../src/runtime/README.md) |
| [`src/app/playback-session.mjs`](../src/app/playback-session.mjs) | Game input, menu timing, pause reasons, snapshots and new-match resets |
| [`src/app/custom-controls.mjs`](../src/app/custom-controls.mjs), [`settings-panel.mjs`](../src/app/settings-panel.mjs) | Speed, dock and explicit editing actions |
| [`src/render/view-camera.mjs`](../src/render/view-camera.mjs) | Oblique observation, compact overview and world-coordinate keyboard movement |
| [`src/app/audio.mjs`](../src/app/audio.mjs) | Real-time music and bounded effects |
| [`src/app/main.mjs`](../src/app/main.mjs) | RAF, input isolation, visibility boundaries, presentation and measurement |

The internal clock is source-reusable, but other games still require step/input/menu/timer/audio/snapshot adapters. This version does not integrate Zombie Builders or Mini Richman. Measure battle time using `simulation.frame / 30`, not the generic clock's scheduled callback count: menu callbacks may not advance a battle.
