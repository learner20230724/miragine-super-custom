# Mage / vampire / crystal projectile lifetime

[中文](projectile-lifetime.zh-CN.md)

This custom rule does not change firing range, projectile speed, damage, cooldowns or generated data. Distances are world units, not screen pixels. Published v0.6.0-preview.1 already includes vampire/mage extension; crystal extension and the [new hit rules](combat-hits.en.md) were introduced in v0.6.1-preview.1 and are included in published v0.6.2-preview.1. The old v0.6.0 EXE lacks those two additions. See the [delivery record](releases/v0.6.2-preview.1.json) for publication and verification results.

## Defaults and effective travel

| Parameter | Vampire ID 9 / mage ID 12 | Red / blue crystals |
|---|---:|---:|
| Lifetime policy | Calculated from map width × 1.1 | Fixed `baseLifeFrames` |
| Map width / target travel | 4500 / 4950 | Map width does not affect calculation |
| Speed (unchanged) | 20 world units / projectile processing step | 20 world units / projectile processing step |
| Default firing delay (unchanged) | 5 steps | 0 steps |
| New projectile initial life | 253 steps; original 100 | 253 steps; original 100 |
| Maximum retained travel | 4960 | 5060 |
| Possible travel during removal update | 4980 | 5080 |

Maximum travel assumes no earlier collision. New hit rules allow diagonal straight trajectories, so **path length is not horizontal displacement**. Ordinary attacks resolve through a separate delayed hit and do not use this table to determine hit distance. Nun ID 6 retains the original projectile life of 100.

Vampire/mage lifetime = firing delay + ceil(map width × multiplier / absolute projectile speed). Map width is the actual core value after recovered AS3 integer conversion. Only near-integer floating-point noise is removed; genuine fractional steps round upward. Defaults require 248 movement updates plus 5 delay updates, totaling 253. Extreme values saturate at JavaScript's safe-integer maximum; distance coverage is not guaranteed after saturation.

Crystal life 253 is a **fixed total budget including delay**, not recalculated for map width, speed or firing delay. Increasing delay reduces available flight steps. Both policies retain the original lifetime update order: delay consumes life; an update beginning at zero life still moves before removal, and that final position is absent from the next render snapshot. Simulation runs at 30 Hz, but original live-list ordering can skip an individual projectile's update; exact wall-clock duration is not guaranteed. Speed controls shorten waiting without increasing world distance.

**Extended life does not increase firing range or guarantee travel through the entire budget.** With the current hit extension, contact with the first enemy removes the projectile. Without that independent extension, the original target-X crossing and vertical-tolerance removal rules still apply. Lifetime and hit rules are separate options.

## Configuration and restoration

Keep other settings in `config/custom.json` and configure this field inside `overrides`:

```json
"casterProjectileLifetime": {
  "mapWidths": 1.1,
  "unitIds": [9, 12],
  "baseLifeFrames": 253
}
```

- `mapWidths` must be positive and finite; `unitIds` is a list of distinct unit IDs from 0 to 15.
- Optional `baseLifeFrames` must be a positive safe integer. Omitting it preserves original crystal lifetime. It is a total budget, not extra steps.
- Restart the source application after editing the file. Only newly fired shots use the policy; existing remaining life is not reset. Applying other F2 settings preserves it; no lifetime panel fields were added.
- Removing startup override `casterProjectileLifetime` and restarting restores original lifetime without disabling independent `combatHitRules`. Remove both overrides to withdraw both improvements; other personal parameters require their own reset. In the v0.7.0-preview.1 candidate, F2 Restore original defaults retains these improvements, and Return to main menu (end this match) keeps settings rather than restoring original rules. The panel never rewrites the startup file; saved panel fields override matching startup values. See [settings and backups](custom-settings.en.md#presets-migration-and-backups).

## Development entry points

`src/extensions/projectile-lifetime.mjs`, installed by the match factory in `src/app/main.mjs`, wraps the original attack callback per instance and changes only `attack.life`. It does not patch recovered classes or global prototypes, and regeneration does not overwrite it. Separate hit behavior lives in `src/extensions/combat-hits.mjs`.

```sh
node --test --test-isolation=none tests/projectile-lifetime.test.mjs
```
