# Game clock and presentation runtime

Internal source-level helpers for this game's fixed ticks and independent display.
This is not an external executable accelerator. User documentation:
[中文](../../docs/time-control.zh-CN.md) / [English](../../docs/time-control.en.md).

## Clock contract

```js
import { GameClock } from './index.mjs';

const clock = new GameClock({
  stepHz: 30,
  renderHz: 240,
  now: performance.now(),
  step(wallNow) {
    // Caller supplies exactly one complete fixed simulation step.
    simulateOneTick(wallNow);
  },
});
clock.setSpeed(2.5, performance.now());
clock.setSpeed(0, performance.now()); // Pause simulation, not presentation.
clock.setRenderHz(120);              // Presentation only.
```

`simulateOneTick` is an integrating application's function, not a runtime export.

- `setSpeed(value, now?)` accepts any finite number in **[0, 20]**. The game UI
  limits selections to 0.1 increments; the clock itself does not quantize them.
  `GAME_SPEEDS` remains the legacy quick-preset list `[1, 2, 4, 8]`, not the valid
  input range. `paused` is a read-only convenience for `speed === 0`.
- Pass the event timestamp for changes between RAF callbacks. With `now`, the
  old speed is settled up to that boundary first; without it, the new speed
  applies to the next accepted delta under the previous adapter contract.
  Never change rates using different clock origins or adjust system time.
- One tick is `1000 / stepHz` game milliseconds; Miragine keeps **stepHz=30**.
  The `step(wallNow)` argument is a real timestamp, not `dt`. Multiple catch-up
  ticks in the same advance receive the same timestamp.
- Accepted real-time delta is capped at **250 ms before** multiplying by speed.
  Accepted budget executes complete steps; excess wall time is dropped.
  Existing fractional game-time remainder is retained across rate/pause changes.
- Optional constructor limits `maxStepsPerAdvance` (positive integer or Infinity)
  and `maxWorkMs` (positive finite milliseconds or Infinity) bound catch-up only
  when `speed > 1`. Both default to Infinity; Miragine's main entry selects **24
  steps / 8 ms**. `workNow()` supplies the real work timestamp. Limits are checked
  between complete steps, so the time limit is soft and cannot preempt one slow
  step or GC pause. This budget excludes rendering/audio. On reaching a limit,
  overdue whole-step time demand is dropped; only the
  fractional remainder remains. No simulation frame/RNG state is skipped ahead.
- Budget statistics distinguish `cappedWallDeltaMs` (after the wall-delta cap),
  `acceptedWallDeltaMs` (after shedding work demand), `droppedWallDeltaMs` (total
  dropped demand in wall-time units), `droppedGameTimeMs` (budget-discarded game
  demand) and `workLimited`. These are per-advance, not cumulative values. 1× and
  slow motion retain the original scheduling even when finite guards are supplied.
- `advance(now, { hidden: true })` accepts zero time and does not present.
  Call it at both visibility edges, not only in RAF; otherwise resumed callbacks
  could count up to the delta cap as game time. Miragine wires both edges.
- `advance()` / `stats` return frozen scalar measurements. `gameTimeMs` counts
  scheduled callbacks, not necessarily battle progress. Use actual simulation
  frames when the callback may do nothing in menus or after a match.
- `setRenderHz(rate)` accepts finite targets in **(0, 240]** and changes display
  cadence only. Deadlines retain fractional phase, at most one frame is submitted
  per RAF, and missed slots are not repaid. `invalidate()` stays within this cap.
  These targets do not guarantee achieved hardware/browser throughput.

## This game's adapter

`src/app/playback-session.mjs` owns the Miragine-specific policy:

- `setSpeed(speed, now)` retains the selected value and last positive rate.
  Menus/results are scheduled at real-time rate, not a paused/accelerated match rate.
- `setPaused(paused, now, reason)`, `pause(reason, now)` and `resume(reason, now)`
  compose named reasons. Removing `editor` cannot release `manual` or speed 0.
  These methods belong to **MiraginePlayback**, not `GameClock`.
- `togglePause(now)` toggles the selected speed between zero and the last positive
  rate unless an explicit manual reason needs releasing. The caller gates normal
  battle inputs and handles sound when pausing.
- `refresh()` captures an explicitly edited world without advancing its logic.
  Customization refreshes the underlying render snapshot; playback then collapses
  its before/after snapshots so paused edits render without motion artifacts.
- New matches reset both snapshots/cameras because entity IDs may be reused.
  Stopped/ended worlds must not repeatedly interpolate the final movement.

## Presentation interpolation

`interpolateSnapshots` / `interpolateRenderState` create new presentation records
for continuous positions and camera coordinates only. Current painter order,
pose, HP and visibility are preserved. Births, removals and discontinuities snap
to current state; opaque nested metadata remains borrowed read-only.

Normal interpolation adds up to one logic tick of visual latency. Use
`cameraCut: true` for a deliberate cut. Neither interpolation nor display may
advance simulation, draw RNG values, change collisions or write positions back.
Input sampling, pause composition, real-time menus, sound and scene resets are
adapter responsibilities. There is no single-step API in this version.
