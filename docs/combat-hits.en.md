# Custom combat hit rules

[中文](combat-hits.zh-CN.md)

This is **new gameplay** for physical projectile interception and long-range ordinary attacks, not recovered original behavior. The v0.6.1-preview.1 local build includes this extension and is not published to GitHub; the old v0.6.0-preview.1 EXE lacks it. Recovered core, generated unit defaults, assets, firing range, attack intervals, damage/armor formulas, speed controls and the 30 Hz simulation rate remain unchanged.

## Why could an apparently attacked unit keep its HP?

Original firing permits vertical separation up to 40, but the moving attack only damages its locked target if separation is at most 30 when it crosses that target's X. A failed check still removes the attack. Targets between these tolerances can repeatedly avoid damage until they move. Original ordinary attacks also use invisible moving attack objects, so increased firing range can encounter travel-time and lifetime limits. Overlapping effects do not establish a hit in the old logic.

Another independent cause remains: damage is **damage for the target's armor type − armor**, with no minimum-damage clamp. Equality still yields zero; damage below armor can still heal. This extension does not treat every unchanged HP value as a collision bug or guarantee that every custom attack kills every custom target.

## Ranged: straight flight and first contact

- Weapon types `fb`, `tb` and `storm` identify ranged projectiles: by default **nun ID 6, vampire ID 9, mage ID 12 and both crystals**. Firing range alone does not classify an attack.
- When the original firing delay ends, aim once at the original target's current world XY position, then fly straight without homing. A moving target can evade the shot; its death does not automatically consume the projectile.
- Each projectile processing step sweeps the **entire segment** from the previous to the next position against enemy circles. The first contact along that segment receives one original damage calculation, then the projectile is removed. Testing the whole segment instead of only its endpoint avoids tunneling through a target at high speed.
- Allies, dead entities and entities no longer in the scene do not block shots. Front-line enemies can intercept shots aimed farther back. Without contact, the projectile keeps flying until impact or expiry.
- Collision occurs in the logical world XY plane, not PNG alpha pixels or screen pixels. Zoom, oblique projection, image padding and airborne poses do not change the world radii below; visual outlines and hit shapes are not guaranteed to coincide exactly.
- The sweep tests projectile travel against enemy positions at processing time, not both objects' complete between-frame trajectories. Extremely fast customized troops can still cross a projectile between updates. High firing rates and long delays/lifetimes can accumulate many pending attacks; fixed frame rates are not guaranteed with extreme parameters.

## Ordinary attacks: delayed damage to the locked target

Other ordinary attacks without those independent projectiles retain their existing firing conditions and current unit range. Once created, an attack waits for its original `delayAttack`, then damages its still-living, in-scene locked target once. There is no additional flight-distance, vertical-separation or range recheck. This supports deliberately huge-range melee attacks. If the locked target dies or leaves, no damage is dealt and no replacement target is chosen automatically.

Only hit resolution changes, not attack animations, cooldowns or damage values. No minimum or guaranteed damage is added.

## Configuration

| `overrides.combatHitRules` field | Default | Meaning |
|---|---|---|
| `projectiles` | `swept-first-enemy` | Sweep the flight path; damage/remove at first enemy contact |
| `ordinaryAttacks` | `delayed-target` | Directly resolve the locked target after the original delay |
| `unitRadius` | 20 | Unit collision radius in world units |
| `baseRadius` | 40 | Crystal collision radius in world units |
| `projectileRadius` | 6 | Projectile collision radius in world units |

**20 / 40 / 6 are explicitly new customization parameters, not collision radii recovered from the SWF.** Contact uses the sum of target and projectile radii. These values neither change firing range nor scale with viewport zoom.

The current startup configuration is below. Edit `config/custom.json` and restart the source application; do not overwrite generated defaults. Preserve any other handwritten overrides.

```json
{
  "schemaVersion": 1,
  "profile": "custom-combat-hits",
  "overrides": {
    "casterProjectileLifetime": {
      "mapWidths": 1.1,
      "unitIds": [9, 12],
      "baseLifeFrames": 253
    },
    "combatHitRules": {
      "projectiles": "swept-first-enemy",
      "ordinaryAttacks": "delayed-target",
      "unitRadius": 20,
      "baseRadius": 40,
      "projectileRadius": 6
    }
  }
}
```

The extensions are independent: crystal life is fixed at 253 steps, vampire/mage life budgets for 1.1 map widths, and nun projectile life remains 100. Delay also consumes projectile life, and collisions may end flight early. See the [lifetime table](projectile-lifetime.en.md) for travel distances and rounding.

No new F2 fields were added for these hit parameters. Removing `combatHitRules` restores original hit resolution but retains the separate lifetime extension. Remove both overrides, or use F2 “Return to original” for subsequent matches, to restore original combat rules. The panel does not rewrite disk settings; restarting loads the disk configuration again.

## Development and focused checks

- `src/extensions/combat-hits.mjs`: separate collision and ordinary-hit extension.
- `src/extensions/projectile-lifetime.mjs`: separate lifetime budget.
- `src/app/main.mjs`: match factory installation.
- `tests/combat-hits.test.mjs` and `tests/projectile-lifetime.test.mjs`: focused headless regressions.

```sh
node --test --test-isolation=none tests/combat-hits.test.mjs tests/projectile-lifetime.test.mjs
```
