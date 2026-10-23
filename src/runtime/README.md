# Custom presentation runtime

These helpers separate this project's fixed game ticks from display scheduling.
They do not automatically adapt another game's input, time units, assets or audio.

```js
import { GameClock, interpolateRenderState } from './index.mjs';

const clock = new GameClock({
  stepHz: 30,
  renderHz: 240,
  now: performance.now(),
  step(wallNow) {
    keyboard.step();
    controller.tick(wallNow);
    // The adapter keeps the two consecutive same-phase render snapshots.
  },
});
clock.setSpeed(4);       // 1 / 2 / 4 / 8; changes future game-time accumulation.
clock.setRenderHz(120);  // Positive finite target <= 240; leaves game time intact.
const state = clock.advance(rafNow, { hidden: document.hidden });
if (state.render) {
  const display = interpolateRenderState(previousSnapshot, currentSnapshot,
    state.alpha, { previousCamera, currentCamera });
  renderer.render(display.snapshot, display.camera);
}
```

- One game tick is `1000 / stepHz` game milliseconds. Keep the recovered default
  `stepHz=30`; do not increase it to select a faster display target.
- Accepted wall delta is capped at 250 ms **before** multiplication by speed.
  Hidden time adds zero; fractional game remainder is retained. Long stalls still
  discard capped wall time, so the requested speed is not a throughput guarantee.
- Render deadlines retain fractional phase, submit at most once per RAF, and do
  not repay missed display slots. The render target is an average cadence: on a
  non-divisible monitor rate, individual presentation intervals can vary.
- `invalidate()` requests presentation without a game tick, subject to the same
  render deadline. `setRenderHz()` resets only display cadence, preventing a burst
  of old presentation debt.
- `advance()` and `clock.stats` return frozen scalar statistics. `gameTimeMs`
  counts scheduled callback ticks, not necessarily battle time if the adapter's
  callback does nothing in menus or after a match. Actual battle frame time stays
  in the simulation. Speed/rate/counters have getter-only access.
- Interpolation only writes new presentation record copies and keeps current
  painter order, pose, HP and visibility. Births, removals and discontinuities
  never become new game events. Nested opaque metadata remains borrowed read-only.
- Reset both saved snapshots/cameras on every new match because entity UIDs may
  restart. Normal previous/current interpolation introduces up to one game tick
  of visual latency. `cameraCut:true` snaps a deliberate camera cut.
- Input sampling, wall-clock menus, sound playback and speed-control behavior
  remain explicit adapter choices. Interpolation must never call the simulation,
  draw RNG values, change collisions or write camera/entity positions back.
