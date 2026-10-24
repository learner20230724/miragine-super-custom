# Custom settings and sandbox

[中文](custom-settings.zh-CN.md) · [Default parameter tables](parameters.en.md) · [Game clock](time-control.en.md)

This guide describes the v0.7.0-preview.1 release candidate, with automatic settings application and 50×/100× quick choices. New-version verification and publication are not complete. The [v0.6.2 delivery record](releases/v0.6.2-preview.1.json) remains historical evidence, not validation of this candidate. Defaults still come from the super version; optional edits are custom rules, not recovered original behavior.

## Open and navigate

- **F2 opens settings.** There is no permanent settings launcher over the battlefield. F2, Esc or the close control collapses the dock. Opening or closing it **does not pause or resume** the game.
- The dock reserves space alongside the game in wide windows, or below it in narrow windows. Its contents scroll; the game keeps its aspect ratio.
- **Time control comes first:** 0–100× speed in 0.1 increments, including new 50×/100× quick choices, a wide pause/resume button, and measured simulation/display rates.
- **View/display comes below time:** free observation, follow, compact overview, fullscreen and 30/60/120/240 FPS targets. Fullscreen also uses F11; overview is camera framing, not window fullscreen.
- The lower-left game controls are clear clickable text: **pause/resume, help, quit**. They are not the original blurry button bitmaps. Pause works without opening settings.

Left/right/middle dragging pans the main battlefield into free observation. Left dragging starts after 5 CSS pixels; simple clicks do not pan. Minimap navigation, wheel zoom and IJKL remain available. Valid numeric speed edits apply while typing; rule fields commit on Enter or blur, automatically applying and saving valid changes without another Apply button.

The match summary shows actual difficulty separately from original/custom rule status. Selecting a difficulty with unchanged defaults does not mark a new match custom. AI difficulty/category/candidate-table menus only navigate editing content; they never change the current match difficulty.

The three clear-troop buttons act immediately without a confirmation dialog: troops leave combat but retain their original death animation. Crystals remain unharmed; no refund or undo is provided.

## Five pages

| Page | What it controls | When it changes the game |
|---|---|---|
| Current match / basics | Match/difficulty summary → spawn/clear → common rules → red/blue current status, including resources, crystals, recruitment and selection AI | Confirm numbers with Enter or leaving the field; switches act immediately. Current resources affect this match only; rule edits also update next-match settings |
| Units | All 16 units, with independent red/blue columns | Confirmed edits apply automatically; cost/manpower/income edits affect subsequent recruitment without refunds |
| Starting settings | Starting money, income/manpower, initial wait and the next match's mode/difficulty; a separate Automation (this and later matches) section | Starting resources/manpower/wait take effect next match without resetting current resources/countdown; recruitment/AI switches act immediately and are saved for later matches |
| Difficulty / AI | Difficulty/category menus for blue crystal attacks, counter probability and detailed AI rules | Confirmed edits apply automatically. Only this match's difficulty affects it; editing another profile never switches difficulty |
| Presets / files | Named copies and JSON import/export | Loading/importing automatically applies and saves settings; a named preset is an optional reusable copy |

Both sides appear together. Current resources and selected recruits are live match operations, not battle saves. **Red/blue recruitment and blue selection-AI switches act immediately and are saved for later matches**; the homepage and Automation (this and later matches) section edit the same switches. Ordinary unit/resource rule edits do not reset these choices; loading a full preset, resetting or undoing restores the corresponding saved choices.

### Income, money and manpower are different

- **Income limit** means the maximum income amount accumulated through recruitment for each round's payout. It is **not a cap on the wallet balance**. Lowering it does not immediately deduct current income; the cap is checked when recruitment next updates income.
- **Current money** is the spendable balance. There is no additional gameplay balance cap in the custom runtime: its numeric ceiling is the JavaScript safe integer maximum below.
- **Current remaining manpower** is the recruitment budget for this round, not the number of living troops. At the next settlement both budgets reset to the shared per-round manpower allowance.
- Changing the round length keeps the current countdown; the new length is used when that countdown resets. Changing starting values does not refill the current wallet, income or manpower.

## Numeric bounds and automatic clamping

| Field type | Range / rule |
|---|---|
| Money, income, cost, manpower, counts and integer frame counters | Up to **9,007,199,254,740,991** (`Number.MAX_SAFE_INTEGER`), normally starting at 0 |
| Positive counts/timers | Same integer maximum, but at least 1 where zero is invalid: spawn count, round lengths, recruitment interval, crystal cooldown and AI majority minimum |
| HP, armor, damage, movement, range and multipliers | Finite JavaScript numbers up to `Number.MAX_VALUE` (about `1.7976931348623157e308`); nonnegative, with maximum/initial HP strictly positive |
| Probability / IDs / speed | Semantic bounds remain: probability 0–1, unit ID 0–15, armor type 0 or 1, speed 0–100 |

Entering or pasting an excessive numeric value **immediately replaces it with that field's maximum**. You do not need to confirm and then dismiss an out-of-range error. Lower-bound normalization and integer truncation happen on commit, allowing partial decimal typing. Empty or nonnumeric text still needs correction. JSON imports remain strict: malformed, non-finite or out-of-range profiles are rejected rather than silently rewritten.

The custom runtime uses safe, saturating integer accounting instead of signed 32-bit wrapping. Adding income above the safe-integer ceiling leaves money at that ceiling; it does not become negative. Floating-point overflow is bounded to finite values, but extreme magnitudes still have ordinary floating-point precision limits and may produce impractical gameplay. A permitted value is not a performance guarantee.

## Automatic application, local saving and presets

**Confirm once, not twice.** Press Enter or leave a numeric field; selections and switches commit when changed. Incomplete, empty or invalid input does not replace valid active settings. Current-compatible rules apply now, starting-only fields automatically take effect next match. With no battle active, changes configure the next match without starting one.

The old **unsaved draft** label compared edits against the last loaded/saved editor baseline, not disk-write success. Edits could already have a local backup, and some pages applied live while others did not. The new UI removes that ambiguity: **Saving locally…**, **Saved locally**, or **Local save failed · export a backup** describe persistence; an unfinished input is identified separately from other saved settings.

| Action | Effect |
|---|---|
| Confirm unit/common/AI parameters | Automatically applies current-compatible fields, updates later-match rules and saves locally |
| Confirm starting-only parameters | Saves automatically for the next match; does not restart this one |
| Undo last settings change | Reapplies the previous settings, up to 30 changes; does not rewind troops, money, RNG or battle progress |
| Restore original defaults | Resets all exposed parameters and applies them; starting fields wait. Does not clear troops, delete presets or start a match |
| Start a new match with current settings | After confirmation, replaces this battle using current settings and the selected difficulty/mode |
| Return to main menu (end this match) | After confirmation, ends this battle but keeps current settings and presets; not a defaults reset |
| Save as new preset / overwrite preset | Makes a named reusable copy, not a necessary application step |
| Load and apply / import and apply JSON | Validates, applies and saves automatically; starting fields remain next-match only |
| Export JSON | Backs up or exchanges current settings; not a battle save |

Restoring original panel parameters retains the previously approved trajectory-hit/lifetime improvements and does not rewrite external `config/custom.json`. Reset also restores current recruitment on both sides and blue selection AI to enabled. It does not refill resources, remove armies, reset the current countdown or restart existing cooldowns. Already flying attacks retain their trajectory and remaining lifetime. Speed, pause and camera controls belong to the current session, not a rules preset.

### Unit changes, health and time

- A unit edit affects only the chosen side. Existing units receive combat-stat changes when confirmed; cost/manpower/income changes affect future recruits without refunds. Existing cooldowns are not restarted; new projectiles use the new hit delay.
- The panel always preserves the health ratio when changing initial/maximum HP: current HP / previous initial HP is mapped to the new initial HP. There is no health-policy dropdown. Dead units are not resurrected, and original overhealing is not automatically truncated. Crystal current HP and its maximum can be edited separately, but a destroyed crystal cannot be revived through the current-HP field.
- **30 logic frames = 1 game second.** Movement and range use their base values multiplied by the corresponding rule multiplier. Attack cooldown is `Math.trunc(base attack interval × attack-interval multiplier)` frames, bounded to a safe integer in the custom runtime. Targets, actions and hit delays also affect attacks: this is not a universal fixed attacks-per-second value.

## AI selection and editable parameters

The single-player blue AI reselects at round settlement. It uses a fixed candidate table and thresholds, **not learning or recalculation of counters from edited damage/armor stats**. Disabling selection AI leaves troop targeting, movement and attacks active.

Each of the four difficulty cards exposes its own probability, thresholds, candidate sets, majority minimum, forced-unit switches, counted elite IDs and forced target ID. Original probabilities are Easy 0%, Normal 50%, Hard 100%, Impossible 100%.

| Default decision | Original condition and choice |
|---|---|
| Enter counter branch | `counterSelectionProbability > random()` |
| Identify red main force | Most numerous recorded unit type, with at least 2 entries by default; ties retain the runtime's dictionary-order behavior |
| Main force is ID 0 (新兵) | Blue income **<200** selects 0; otherwise selects 3 |
| Other recognized main force | Uniformly choose from that ID's counter candidates |
| No usable counter candidate | Blue income **>1000** chooses uniformly from IDs 0–15; otherwise 0 |
| Non-counter branch | Blue income **>450** chooses uniformly from IDs 0–13; otherwise 0–7 |
| Final forced override | Blue money **>15030**, **or** counted red IDs 14/15 total **>2**, forces ID 15 (大领主) |

The `>` comparisons are strict, not `>=`. By default elite counting happens **only in the counter branch**; its switch can enable counting in both branches. The money and elite override switches are independent and combined with OR. The original lists can still contain dying units awaiting removal, so counts are not a separately filtered census of living troops. Uniform candidate selection does not guarantee that the selected unit is affordable.

The [default parameter reference](parameters.en.md#ai-counters-and-thresholds) lists the complete counter table and the [16 stable IDs](parameters.en.md#all-16-units-economy-and-combat). Counter candidates may be emptied to use the fallback branch; random/fallback candidate sets must contain at least one unit. Changing unit stats does not automatically update these sets.

## Spawn and clear

- Choose a unit and a **number of soldiers**, then click **Spawn red** or **Spawn blue**. The number is not manpower consumption. Sandbox spawning uses current applied unit rules, costs no money/manpower and grants no income.
- The old **100-per-action** and **500-entity** sandbox caps are removed. Requests can use the safe-integer range, but creation is incremental, with progress and **Cancel remaining**. Cancellation keeps troops already created.
- There are three direct clear buttons: **red troops**, **blue troops**, **both**, without a confirmation dialog. Living troops follow their original `dead()` path: HP becomes zero and they immediately leave combat/targeting lists, but remain in the scene for their original backward-fall death animation instead of vanishing.
- Clearing leaves crystals unharmed, removes associated attack objects, cancels a matching pending spawn job, gives no refunds and cannot be undone. Repeating it neither retriggers an existing corpse's death event nor resets its countdown. New matches/end-of-battle changes stop the old job.
- Animation follows the original simulation clock: default `deadTime = 25` decreases once per processing of that corpse, with removal at 1, meaning its **24th own processing update** by default. Global 30 Hz does not guarantee exact wall-clock duration because live-list ordering can skip an object's update. Speed affects waiting; pause, 0× and other simulation-blocking states defer animation until resumption. Clearing never forces the clock to run.
- Original death events and randomized death-sound choices remain; the existing audio layer coalesces sounds in a batch. No new assets or changes to normal combat death rules are introduced.
- Incremental creation prevents a single enormous creation loop; it does **not** make enormous armies cheap. Original target/separation work can grow roughly quadratically, and rendering/memory remain finite. Start small, watch actual rates, and cancel if needed. Even a single expensive simulation step can stall the interface.
- Construction, player-cast skills, fixed waves and scripted reinforcements are not original editable systems here; no invented controls are provided.

## Presets, migration and backups

Limits remain **25 named presets**, names of 1–80 characters, **256 KiB** per imported document and **2 MiB** per library. These are storage/validation limits, not resource or army limits. Profiles contain allowlisted data, never executable scripts.

| Storage | Contents / caveat |
|---|---|
| Desktop `userdata/custom-settings.json` | Current settings and named presets through restricted IPC, independent of temporary local HTTP ports; saved settings restore automatically on restart |
| Browser `localStorage` | Origin-specific settings/presets; changing address/port or clearing site data changes/removes storage |
| External `config/custom.json` | Startup overrides; the panel never rewrites this file |
| Exported JSON | Transferable settings for panel import/application, not a replacement startup file or a battle save |

The current-settings storage envelope now uses `schemaVersion: 2` plus a `template` marker to preserve the chosen configuration template across restarts. Valid legacy v1 local drafts also restore automatically. Version-1 profiles migrate to version 2: shared units/crystal values are copied to both sides and missing AI fields receive baseline defaults. Existing storage keys and the outer export/library envelope remain compatible; the inner profile reports `schemaVersion: 2`.

**Precedence:** startup reads `config/custom.json`, then restores locally saved panel settings. Saved values therefore override matching panel fields in the startup file; unexposed fields remain from the startup template. A developer API choice stored as `template: "original"` instead uses recovered baseline configuration. To adopt all startup-file panel values again, close the game, back up local data, then remove only the `miragine-custom-draft-v1` current-settings record. Keep the `miragine-custom-presets-v1` named-preset library; do not delete the entire `userdata/` directory.

Successfully saved current settings **restore automatically after restart**; loading a preset also applies it automatically. They are not battle saves: positions, current resources, RNG state and progress are absent. Speed/pause/camera/display targets are session controls, not rules-preset fields; a new session starts at 1×.

Storage errors show warnings and leave the valid in-memory settings exportable. Desktop saving requires backend acknowledgment. Back up custom files before upgrading and save important settings as named presets and export JSON for the simplest backup/switching workflow. Regenerating original assets does not overwrite custom files or presets.

## Development entry points

`src/customization/schema.mjs` defines editable fields and migration; `index.mjs` handles automatic application/persistence, undo, presets and spawn jobs; `numeric.mjs` and `runtime.mjs` contain custom safe arithmetic and per-side runtime behavior. UI lives in `src/app/settings-panel.mjs`, `custom-controls.mjs` and `game-text-controls.mjs`. The recovered core and generated defaults remain separate.

The customization API retains `health: 'absolute'` for developer integrations that intentionally preserve current HP; this is not a panel setting. Confirmed edits choose current-match or next-match application automatically; no separate Apply button remains.
