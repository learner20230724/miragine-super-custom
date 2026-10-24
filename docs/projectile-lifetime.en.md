# Mage / vampire projectile lifetime

[中文](projectile-lifetime.zh-CN.md)

This is a user-requested custom rule, not an original value. Recovered code, generated data and the baseline repository remain unchanged. Distances use world units, not screen pixels.

| Parameter | Current setting |
|---|---:|
| Units | Vampire ID 9 and mage ID 12, both sides |
| Map width | 4500 |
| Target travel distance | Map width × 1.1 = 4950 |
| Speed (unchanged) | 20 world units / projectile processing step |
| Default firing delay (unchanged) | 5 projectile processing steps |
| New projectile initial life | 253 projectile processing steps; original 100 |
| Default horizontal firing range (unchanged) | 5 × 60 = 300 |
| Maximum retained displacement | 4960, without an earlier impact or miss |

Lifetime = firing delay + ceil(map width × multiplier / absolute projectile speed). Map width is the actual core value after recovered AS3 integer conversion. Only near-integer floating-point noise is removed; genuine fractional steps round upward. Defaults require 248 movement updates plus 5 delay updates, totaling 253. Extreme values saturate at JavaScript's safe integer maximum; distance coverage is not guaranteed after saturation.

Recovered update order is unchanged: delay consumes life; an update starting with zero life still moves before removal. The last retained default position is 4960 units from launch. The removal update can reach 4980 internally, but that position is absent from the next render snapshot. Global simulation runs at 30 Hz, but original live-list ordering can skip an individual projectile's update; exact wall-clock duration is not guaranteed. Speed controls shorten waiting time without increasing world distance.

**Firing range is not increased, and shots need not travel the full 4950 units.** Units still begin firing only within their existing range. Crossing the original target's current X still resolves/removes the shot; a vertical miss also removes it. All other units and crystals retain their original lifetime.

## Configuration and development

Explicit override in `config/custom.json`:

```json
"overrides": {
  "casterProjectileLifetime": { "mapWidths": 1.1, "unitIds": [9, 12] }
}
```

Edit `mapWidths` and restart the source application. Only newly fired shots use the calculation; existing shots are not reset. Applying other F2 settings preserves the extension, which has no new panel control. Remove the override to restore original startup behavior. “Return to original” also restores original rules for subsequent matches without rewriting disk settings; restarting enables the disk override again.

Implementation: `src/extensions/projectile-lifetime.mjs`, installed by the match factory in `src/app/main.mjs`. It wraps the original attack callback per instance and changes only `attack.life`, not recovered classes or global prototypes. Regeneration does not overwrite it. Focused regression: `node --test --test-isolation=none tests/projectile-lifetime.test.mjs`.
