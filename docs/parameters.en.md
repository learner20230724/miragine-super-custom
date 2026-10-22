# Super-version parameters and effective rules

[中文](parameters.zh-CN.md)

These values come from the verified **super-version** SWF and its recovered AS3, not the JKS remake or ordinary-version reimplementations. `config/defaults.generated.json` contains original fields, derived runtime values, and animation mappings. `generated/config-provenance.json` records source hashes, per-unit field line numbers, and semantic notes. Passing static extraction tests does not establish full-match, frame-by-frame runtime parity.

## Safe customization

Place only your changes inside `config/custom.json` → `overrides`. All unspecified values inherit the defaults:

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

Unit keys are stable menu IDs `"0"` through `"15"`, not animation indices (`ss`). Arrays, including `damage`, must be replaced as complete arrays. `unit.runtime` and `unit.animation` document derived defaults: the engine recalculates after applying raw-field overrides, rather than consuming stale derived values. A custom `ss` selects actual frame lengths from the matching `animations` symbols. `rules.animationSpeeds` / `rules.animationLoops` control ordinary-unit actions uniformly; bases and effects retain speeds / loop flags from their own `animations` entries.

```text
python -B tools/extract_game_config.py
python -B tools/extract_game_config.py --check
node --test tests/extracted-config.test.mjs
```

The extractor writes only `config/defaults.generated.json` and `generated/config-provenance.json`; `--check` is read-only. It never modifies custom overrides, extension code, or recovered sources.

## All 16 units: economy and combat

Source: [Grid.as](../recovered/as3/scripts/Grid.as). Original Chinese unit names are preserved to avoid confusing translations with original identifiers. `cost` is gold per recruit; `population` is the per-round manpower budget consumed, not a living-unit limit; `income` is the subsequent gold-per-settlement increase from one recruit. Armor type `0` = light, `1` = heavy. Damage values are against light/heavy armor, before subtracting the target's flat armor.

| ID | Original name | cost | population | income | Initial hp | Armor type / armor | Light / heavy damage |
|---|---|---:|---:|---:|---:|---|---|
| 0 | 新兵 | 20 | 1 | 4 | 45 | 0 / 0 | 5 / 5 |
| 1 | 经验丰富的老兵 | 30 | 1 | 5 | 65 | 0 / 0 | 6 / 10 |
| 2 | 腐烂的尸体 | 35 | 1 | 6 | 125 | 1 / 1 | 16 / 16 |
| 3 | 武士 | 30 | 1 | 6 | 96 | 1 / 1 | 17 / 5 |
| 4 | 剑兵 | 40 | 1 | 7 | 100 | 1 / 1 | 10 / 20 |
| 5 | 忍者 | 45 | 1 | 8 | 100 | 0 / 0 | 22 / 10 |
| 6 | 悲伤的修女 | 45 | 1 | 8 | 75 | 0 / 0 | 11 / 12 |
| 7 | 重甲剑兵 | 45 | 1 | 8 | 160 | 1 / 1 | 12 / 15 |
| 8 | 武斗家 | 100 | 2 | 15 | 225 | 0 / 1 | 18 / 38 |
| 9 | 吸血鬼 | 125 | 2 | 19 | 140 | 1 / 1 | 11 / 42 |
| 10 | 骑兵 | 150 | 2 | 21 | 240 | 1 / 1 | 30 / 30 |
| 11 | 不朽者 | 180 | 2 | 27 | 350 | 1 / 1 | 20 / 50 |
| 12 | 魔法师 | 220 | 2 | 33 | 210 | 1 / 0 | 50 / 25 |
| 13 | 铁面骑士 | 295 | 2 | 41 | 450 | 1 / 3 | 15 / 36 |
| 14 | 恐惧魔王 | 800 | 4 | 100 | 800 | 1 / 2 | 80 / 80 |
| 15 | 大领主 | 1500 | 7 | 160 | 1200 | 1 / 4 | 155 / 155 |

Actual damage is `damage[target.armorTypeID] - target.armor`. There is no minimum-one damage clamp: custom armor above damage heals the target under original semantics. Ordinary-unit creation assigns `hp` to `nowHP` but does not update `maxHP`, which retains the class default of 100. Crystals explicitly set both health fields.

## Movement, range, cooldown, and animation

Sources: [DragonForce.createUnit](../recovered/as3/scripts/DragonForce.as), [Isometric2DEntity](../recovered/as3/scripts/dragonforce/isometric2D/Isometric2DEntity.as), [Symbol](../recovered/as3/scripts/dragonforce/core/Symbol.as).

- `moveSpeed × 1.3` = world-coordinate units per simulation frame, **not screen pixels/second**.
- `range × 60` = horizontal world-coordinate range; the vertical separation must also be at most 40.
- `weaponSpeed × 20` is assigned to integer cooldown `t`, **truncating toward zero**. Positive defaults therefore use floor. Raw `weaponSpeed` is not a duration in seconds.
- Nominal seconds = cooldown frames ÷ 30. The table rounds seconds to six decimals; actual wall-clock timing depends on frame pacing. JSON retains complete double-precision results.
- `delayAttack` is the delay before an attack object starts moving, not the animation length. Melee uses moving attack objects too. Animation length alone does not determine attack frequency.

| ID | Raw move → world/frame | Raw range → world | Raw speed → cooldown frames | Nominal seconds | Delay frames | ss | Attack artwork frames |
|---|---|---|---|---:|---:|---:|---:|
| 0 | 2.25 → 2.925 | 1 → 60 | 0.83 → 16 | 0.533333 | 0 | 5 | 5 |
| 1 | 2.25 → 2.925 | 1 → 60 | 0.86 → 17 | 0.566667 | 0 | 15 | 5 |
| 2 | 2.25 → 2.925 | 1 → 60 | 2 → 40 | 1.333333 | 10 | 6 | 6 |
| 3 | 2.25 → 2.925 | 1 → 60 | 1.2 → 24 | 0.800000 | 10 | 12 | 6 |
| 4 | 2.25 → 2.925 | 1 → 60 | 1.3 → 26 | 0.866667 | 10 | 0 | 5 |
| 5 | 3.2 → 4.16 | 1.5 → 90 | 1.3 → 26 | 0.866667 | 10 | 11 | 6 |
| 6 | 2.25 → 2.925 | 5.5 → 330 | 2.4 → 48 | 1.600000 | 5 | 7 | 6 |
| 7 | 2.5 → 3.25 | 1 → 60 | 1.44 → 28 | 0.933333 | 10 | 1 | 5 |
| 8 | 2.69 → 3.497 | 1 → 60 | 1.5 → 30 | 1.000000 | 10 | 14 | 7 |
| 9 | 2.25 → 2.925 | 5 → 300 | 2.4 → 48 | 1.600000 | 5 | 10 | 5 |
| 10 | 4 → 5.2 | 1 → 60 | 1 → 20 | 0.666667 | 10 | 8 | 6 |
| 11 | 2.25 → 2.925 | 1 → 60 | 1.45 → 29 | 0.966667 | 10 | 9 | 5 |
| 12 | 2.25 → 2.925 | 5 → 300 | 2.4 → 48 | 1.600000 | 5 | 4 | 6 |
| 13 | 2.95 → 3.835 | 1 → 60 | 1.08 → 21 | 0.700000 | 10 | 3 | 4 |
| 14 | 2.25 → 2.925 | 1.4 → 84 | 1.18 → 23 | 0.766667 | 10 | 13 | 4 |
| 15 | 2.81 → 3.653 | 1.5 → 90 | 1.59 → 31 | 1.033333 | 10 | 2 | 6 |

Do not confuse menu IDs with `ss`: recruit ID 0 uses `A5_* / B5_*`, not `A0_* / B0_*`. The extractor reads all 128 A/B action lengths from the original DefineSprite tags. Unit playback advances by 0.15 artwork frames/simulation frame for idle, 0.3 for run, 0.3 for attack, and 0.2 for death. Idle/run loop; attack/death freeze on their final frames. `Symbol.step` displays `int(currentFrame)` before advancing. Re-selecting a non-loop action through `gotoAndPlay` restarts it.

| Effect symbol | Artwork frames | Advancement / simulation frame | Loop | User |
|---|---:|---:|---|---|
| A_crystal / B_crystal | 1 each | 1 | Yes | Red / blue base |
| fireball | 3 | 0.15 | Yes | Mage; red base |
| thunderball | 16 | 1 | Yes | Nun; blue base |
| storm | 10 | 1 | Yes | Vampire |

## Economy, rounds, and bases

Paths below are relative to `rules`. Frame conversions use the nominal 30 FPS. Values come from `DragonForce.init/step`, not field initializers replaced by `init` (for example, declared income 100 becomes 500 at initialization).

| Parameter | Default | Units / effective meaning |
|---|---|---|
| frameRate | 30 | Simulation frames / nominal second |
| mapWidth / mapHeight | 4500 / 800 | World-coordinate units |
| initialMoney / startingIncome | 0 / 500 | Initial gold / gold per settlement |
| incomeLimit | 8000 | Cap on income after recruit increases; not a gold cap |
| populationLimit | 80 | Spendable manpower budget per round; deaths do not refund it |
| initialRoundFrames / roundFrames | 180 / 900 | First settlement after 6 seconds; subsequent rounds last 30 seconds |
| recruitEveryFrames | 3 | When recruitment is enabled, attempt a selected-unit purchase at countdown modulo 3 = 0 |
| movementMultiplier / rangeMultiplier / weaponSpeedMultiplier | 1.3 / 60 / 20 | Runtime conversions of raw unit fields |
| baseHp | 3500 | Both bases' nowHP and maxHP |
| baseDamage | [100,100] | Light/heavy damage; difficulty 3 overrides blue values |
| baseWeaponSpeedFrames / baseRange | 30 / 600 | Attack cooldown frames / horizontal world range |
| baseSpawnInset / spawnJitterY | 300 / 200 | Border offset; recruit y = mapHeight/2 + 200 - 400×random |
| gameOverDelayFrames | 30 | Initial victory-event countdown after a base dies |

A purchase immediately deducts gold and current-round manpower, and immediately increases the income available at the next settlement. Settlement resets both manpower budgets to `populationLimit`, credits current income to gold, and resets the countdown to 900. Single-player AI then reselects a unit. This is not one preset squad per round, nor a scripted wave system.

## Exact difficulty changes

Every single-player AI decision checks `counterSelectionProbability > random()`. The counter branch chooses from candidates against the most numerous friendly unit type with a count greater than one. Its candidate selection still involves randomness. There is no universal difficulty multiplier for ordinary-unit health, damage, or movement.

| ID / name | Counter-branch probability | Blue initial income | Blue initial manpower field | Blue base damage | Blue base cooldown |
|---|---:|---:|---:|---|---|
| 0 Easy | 0% | 500 | 80 | 100 / 100 | 30 frames (1 second) |
| 1 Normal | 50% | 500 | 80 | 100 / 100 | 30 frames (1 second) |
| 2 Hard | 100% | 500 | 80 | 100 / 100 | 30 frames (1 second) |
| 3 Impossible | 100% | 600 | 100, reset to 80 at first settlement | 110 / 110 | 25 frames (0.833333 seconds) |

Impossible adds **20%** initial income, **10%** base damage, and changes the base attack interval from 30 to 25 frames (approximately **16.67% shorter** interval, **20% higher** attack frequency). The initial manpower field of 100 is not a persistent 25% population bonus: default initial gold is zero, and manpower resets to 80 before the first income credit. Thus those temporary extra 20 manpower cannot be spent in the unchanged normal flow.

Override `counterSelectionProbability`, `rightStartingIncome`, `rightStartingPopulation`, `blueBaseDamage`, or `blueBaseWeaponSpeedFrames` under a difficulty key. The original difficulty-3 initialization checks difficulty only, not single-player/local-two-player mode; changing a launcher must not silently alter that condition.

### AI counters and thresholds

`ai.counterChoices` maps a predominant friendly unit ID to blue-side random candidates:

```json
{
  "1":[1,3,5], "2":[4,6,7,8], "3":[4,7], "4":[1,6,8],
  "5":[3,10], "6":[5,6,12], "7":[4,8,9], "8":[5,6,12],
  "9":[6,8,9,11], "10":[11,13,14], "11":[8,9],
  "12":[9,10,12,13], "13":[8,9,11], "14":[9,10,11], "15":[9,10,11]
}
```

- Predominant ID 0: choose 0 if blue income is **<200**, otherwise 3 (`newbieIncomeThreshold` and related keys).
- Counter branch without a recognized predominant ID: choose randomly from 0–15 if income is **>1000**, otherwise 0 (`counterFallback*`).
- Non-counter branch: choose randomly from 0–13 if income is **>450**, otherwise 0–7 (`random*`).
- Force ID 15 when blue gold is **>15030**, or the current counter-branch count of friendly IDs 14/15 is **>2** (`forceOverlord*`, `eliteUnitIds`, `forcedUnitId`). These are strict original comparisons, not `>=`.
- Equal-count choices depend on Flash `Dictionary` enumeration order. Sharing a numeric random seed between runtimes does not prove full-match parity.

## Additional extracted constants

| rules parameter | Default | Units / caveat |
|---|---:|---|
| unitSeparationDistance | 40 | Same-side separation distance in world units |
| targetVerticalWeight | 30 | Target score dx² + 30×dy², not a search radius |
| attackVerticalTolerance | 40 | Vertical world separation allowed when initiating an attack |
| projectileSpeed | 20 | World units / simulation frame |
| projectileSpawnHeight | 40 | Attack visual height pz |
| projectileLifeFrames | 100 | Initial original lifetime counter; removal occurs when a step starts at zero |
| projectileVerticalTolerance | 30 | Vertical hit tolerance when an attack crosses target x |
| gravity | −0.8 | World height units / simulation frame² |
| deathAnimationFrames | 25 | Initial death counter; removed after decrementing to 1, not a guarantee of 25 displayed frames |
| spriteRasterScale | 0.9 | Original runtime rasterization scale |
| focalLength / groundTiltDegrees | 600 / −70 | World projection focal length / ground rotation degrees |
| cameraFollowFactor | 0.1 | Automatic camera-follow interpolation per frame |
| manualCameraHoldFrames | 60 | Hold-off counter after manual camera movement |
| minimapScale | 0.06 | World-to-minimap coordinate multiplier |

The original does not have a configurable construction/building-upgrade system, player skill tree, or level waves. Fixed crystal combat units do not constitute a building-production system. New mechanics must be separate, explicitly enabled extensions rather than claimed original features.
