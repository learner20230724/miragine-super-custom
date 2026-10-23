# Game clock and presentation interpolation

[中文](time-control.zh-CN.md)

This page describes the current custom-repository source, not a claim that these changes have shipped in a new downloadable release.
It is a **reusable source-level clock and presentation toolkit**, not an automatic accelerator for arbitrary EXEs or a player wrapper around the original SWF.

## In this game

The match toolbar offers **1 / 2 / 4 / 8×**, a **30 / 60 / 120 / 240 Hz** display target, and overview/follow observation controls.
Speed scales match simulation time only. Menus, result transitions and observation-camera controls use wall time.
Music, effects and fades keep their normal playback speed and pitch; faster game events can still trigger effects more frequently.
There are no separate pause/single-step controls, and `GameClock` has no `pause()` or `singleStep()` API. Speed 0 is not accepted.

This game's fixed rule is **30 simulation steps = 1 game second**. Do not change that frequency to request a higher display rate.

| Target speed | Target simulation steps per wall second | Target game seconds per wall second |
| --- | ---: | ---: |
| 1× | 30 | 1 |
| 2× | 60 | 2 |
| 4× | 120 | 4 |
| 8× | 240 | 8 |

These are scheduling targets, not throughput guarantees on every machine. The toolbar reports the requested speed, measured simulation rate and measured presentation rate separately.
Use actual battle `simulation.frame` for battle-time measurement. Clock `gameTimeMs` counts scheduled callbacks and is not battle time when a callback does not advance a match, such as in menus.

## Simulation and presentation are independent

- **Simulation:** each callback still executes one complete original rule step, including recruitment, movement, attacks, collision and RNG. Acceleration does not skip these rules. Changing speed does not rescale an existing fractional remainder.
- **Presentation:** select its target independently, up to 240 Hz. At most one presentation occurs per `requestAnimationFrame`; missed display slots are not repaid. Monitor refresh, browser scheduling and GPU/CPU load limit actual cadence. Non-divisible refresh rates can produce uneven intervals.
- **Interpolation:** blend continuous positions and camera coordinates between consecutive simulation snapshots into presentation copies, never back into simulation. Current painter order, pose, HP and visibility are preserved; births, removal, action changes and death transitions snap to current state. This adds no animation poses to the original assets and introduces up to one simulation step of visual latency.
- **Stalls:** by default, cap one wall-time delta at **250 ms before** multiplying by speed. Excess wall time is discarded instead of causing unlimited catch-up. Accepted simulation time still advances step by step without skipping rules.
- **Background:** an `advance(now, { hidden: true })` call accepts zero wall time, does not present, and retains its fractional remainder. This game's adapter synchronizes a zero-progress clock at both visibility-change edges, preventing hidden time from being replayed after suspended RAF callbacks. Other game adapters must also handle visibility changes rather than relying solely on hidden RAF callbacks.

## Entry points and minimal integration

| Entry point | Responsibility |
| --- | --- |
| [`src/runtime/index.mjs`](../src/runtime/index.mjs) · [API notes](../src/runtime/README.md) | DOM-independent `GameClock` and interpolation helpers; the clock accepts other positive finite `stepHz` values and display targets in `(0, 240]` |
| [`src/app/playback-session.mjs`](../src/app/playback-session.mjs) | This game's adapter: sample input per step, tick the controller, retain snapshots/cameras, reset snapshots on a new match |
| [`src/app/custom-controls.mjs`](../src/app/custom-controls.mjs) | Speed, display-target and observation UI |
| [`src/app/main.mjs`](../src/app/main.mjs) | Connect RAF, real-time audio/observation controls and presentation |

This **15-line example** belongs in an entry module at the project root. `capture`, `simulateOneTick` and `render` are functions supplied by the integrating game, not built-in SDK APIs.
`capture()` returns an entity array matching the interpolation schema; `simulateOneTick()` advances exactly one fixed game step.

```js
import { GameClock, interpolateSnapshots } from './src/runtime/index.mjs';
let before = capture(), after = before;
const clock = new GameClock({ now: performance.now(),
  stepHz: 30, renderHz: 120, step() {
    before = after; simulateOneTick(); after = capture();
  } });
function frame(now) {
  const state = clock.advance(now, { hidden: document.hidden });
  if (state.render) {
    render(interpolateSnapshots(before, after, state.alpha));
  }
  requestAnimationFrame(frame);
}
clock.setSpeed(2);
requestAnimationFrame(frame);
```

`setSpeed(1|2|4|8)` changes future game-time accumulation only. `setRenderHz(rate)` changes display cadence only. `invalidate()` requests presentation but does not bypass its rate limit.
The `step(wallNow)` argument is a wall-clock timestamp, not `dt`; catch-up steps within the same RAF receive the same timestamp.
For cameras, use `interpolateRenderState`; pass `cameraCut: true` for a deliberate cut. Reset both snapshots on a new match or UID reuse. When simulation ends or stops, collapse previous/current snapshots to avoid repeatedly blending the last movement.

## Adapting another game or engine

1. Identify one authoritative fixed-step entry point, its units and original rule frequency. Do not let the engine's own loop and this clock both advance simulation, or scale both `dt` and step count.
2. Supply a game-specific adapter for input sampling, single-tick simulation, stable entity IDs, position snapshots, cameras and scene resets. The current interpolator expects `uid`, `px/py/pz` and action/continuity fields; it does not interpolate arbitrary engine objects. Convert other schemas or provide another presentation interpolator.
3. Separate game timers, menu/network timers and audio policy explicitly. For an existing Phaser or other engine game, prefer its official clock interfaces and check animations, physics and timers separately. Local scaling does not change server-authoritative time.
4. Test input, new matches, deaths, stalls, background recovery and target-versus-measured rates in that game. The source-level integration points are reusable; adaptation and validation remain necessary.

## Existing projects: practical choices

These are comparisons, not dependencies of this toolkit. No process-injection or anti-cheat-bypass implementation is provided here.

| Project / official source | What it addresses | Choice here and license |
| --- | --- | --- |
| [Cheat Engine Speedhack source](https://github.com/cheat-engine/cheat-engine/blob/master/Cheat%20Engine/bin/autorun/SpeedhackV3.lua) | Scales readings from selected system-time APIs; this is not a compute/render performance improvement or a guarantee for every game | Not a dependency; implementation not copied. Its [official FAQ](https://www.cheatengine.org/faq.php) makes source available but does not grant publication of modified versions. Do not label the whole project GPL |
| [libTAS implementation guide](https://clementgallet.github.io/libTAS/guides/how/) | Deterministic time, frame control and replay on GNU/Linux; not a general Windows game runtime | A research/testing reference, not an Electron runtime dependency; [GPL-3.0-or-later source declaration](https://github.com/clementgallet/libTAS/blob/v1.4.8/src/library/DeterministicTimer.cpp) |
| [Phaser `Time.Clock`](https://docs.phaser.io/api-documentation/class/time-clock) | `timeScale` scales that Clock's TimerEvents, not automatically all physics, animations or audio | Prefer the official interface in an existing Phaser game. Do not import an entire engine for this project's clock; [MIT](https://github.com/phaserjs/phaser/blob/v4.2.1/LICENSE.md) |

See [`NOTICE.txt`](../NOTICE.txt) for the repository's component-specific permissions; this clock guide does not change them.
