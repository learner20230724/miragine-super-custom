# Custom settings and sandbox

[中文](custom-settings.zh-CN.md) · [Default parameter tables](parameters.en.md) · [Game clock](time-control.en.md)

This guide describes the current v4 source layout. Release availability and packaged verification are recorded separately. Defaults still come from the super version; optional edits are custom rules, not recovered original behavior.

## Open and navigate

- **F2 opens settings.** There is no permanent settings launcher over the battlefield. F2, Esc or the close control collapses the dock. Opening or closing it **does not pause or resume** the game.
- The dock reserves space alongside the game in wide windows, or below it in narrow windows. Its contents scroll; the game keeps its aspect ratio.
- **Time control comes first:** 0–20× speed in 0.1 increments, quick presets, a wide pause/resume button, and measured simulation/display rates.
- **View/display comes below time:** free observation, follow, compact overview, fullscreen and 30/60/120/240 FPS targets. Fullscreen also uses F11; overview is camera framing, not window fullscreen.
- The lower-left game controls are clear clickable text: **pause/resume, help, quit**. They are not the original blurry button bitmaps. Pause works without opening settings.

## Five pages

| Page | What it controls | When it changes the game |
|---|---|---|
| Current match / basics | Red and blue current money, income, remaining manpower, crystal current/max HP, crystal damage/range/cooldown; shared income/manpower limits, round/recruitment timing and multipliers | Numeric fields commit on Enter or leaving the field. Each rule edit applies only that field, not unrelated draft edits. Current-resource changes affect this match only |
| Units | All 16 units; red and blue values side by side, independently editable | Draft first; click **Apply settings** |
| Starting settings | Separate red/blue starting money, red starting income/manpower, blue starting income/manpower for each difficulty, initial wait, and starting automation choices | All fields here affect a new match only. Click **Apply settings** to use them next match, or choose difficulty using four visible buttons and start from the draft |
| Difficulty / AI | Four expanded cards, each with blue crystal attack values, counter-branch probability and detailed AI rules | Draft first; after application, only the current difficulty's profile affects this match. Editing another profile does not switch difficulty |
| Presets / files | Save, load, overwrite, delete, JSON import/export | Loading/importing changes the draft, not the battle; saving does not apply it |

Both sides are visible together on the homepage; no red/blue selector is needed. Recruitment switches, selected recruits and the blue selection-AI switch act immediately there. These live switches do not themselves save starting automation choices into a preset; set those on the starting page. Applying unit/AI drafts preserves the current recruitment and selection-AI switches; starting automation choices wait for a new match.

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
| Probability / IDs / speed | Semantic bounds remain: probability 0–1, unit ID 0–15, armor type 0 or 1, speed 0–20 |

Entering or pasting an excessive numeric value **immediately replaces it with that field's maximum**. You do not need to confirm and then dismiss an out-of-range error. Lower-bound normalization and integer truncation happen on commit, allowing partial decimal typing. Empty or nonnumeric text still needs correction. JSON imports remain strict: malformed, non-finite or out-of-range profiles are rejected rather than silently rewritten.

The custom runtime uses safe, saturating integer accounting instead of signed 32-bit wrapping. Adding income above the safe-integer ceiling leaves money at that ceiling; it does not become negative. Floating-point overflow is bounded to finite values, but extreme magnitudes still have ordinary floating-point precision limits and may produce impractical gameplay. A permitted value is not a performance guarantee.

## Apply, save and recover

| Action | Current match | Later behavior |
|---|---|---|
| Edit a unit/AI/start field, load a preset or import JSON | No automatic change | Updates the draft and attempts a local draft backup |
| Edit a homepage rule field | Applies that field immediately | Also updates that field in the draft and next-match rules |
| Edit current money/income/manpower/current crystal HP | Immediate | Not a starting-value edit or match save |
| Undo | Does not rewind live edits or combat | Undoes draft edits, up to 30 entries |
| Restore original defaults | Does not change this battle | Resets exposed draft fields; keeps presets |
| Apply settings | During a battle, applies current-compatible draft rules without resetting resources/countdown/automation switches; starting fields wait | Selects the draft for later matches in this run. Without an active battle, the same button applies next-match settings without starting combat |
| Start a new match from draft | Replaces the current battle after confirmation | Uses the selected difficulty and single/local-two-player mode |
| Save or overwrite a preset | No effect | Stores a named draft for later loading |
| Return to original menu | Ends the battle and restores the recovered runtime configuration | Keeps draft/presets; does not rewrite `config/custom.json` |

Every page has the same compact footer: **Undo**, **Restore original defaults**, and one **Apply settings** action. Without an active battle its label becomes **Apply next-match settings**. Homepage fields remain live; the footer applies any remaining draft changes from other pages. Even when clicked on the starting page, it applies current-compatible drafts from other pages now and defers starting fields until the next match. The apply button's hover hint explains this timing. Restoring the default draft resets exposed fields only: unexposed handwritten `config/custom.json` overrides survive later application. Return-to-original restores the entire running configuration; a restart still reads the external startup file normally.

### Unit changes, health and time

- A unit edit affects only the chosen side. Existing units receive combat-stat changes when applied; cost/manpower/income changes affect future recruits without refunds. Existing cooldowns are not restarted; new projectiles use the new hit delay.
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
- There are three direct clear buttons: **red troops**, **blue troops**, **both**. Clearing preserves crystals, removes associated attack objects, cancels a matching pending spawn job, gives no refunds and cannot be undone. New matches/end-of-battle changes stop the old job.
- Incremental creation prevents a single enormous creation loop; it does **not** make enormous armies cheap. Original target/separation work can grow roughly quadratically, and rendering/memory remain finite. Start small, watch actual rates, and cancel if needed. Even a single expensive simulation step can stall the interface.
- Construction, player-cast skills, fixed waves and scripted reinforcements are not original editable systems here; no invented controls are provided.

## Presets, migration and backups

Limits remain **25 named presets**, names of 1–80 characters, **256 KiB** per imported document and **2 MiB** per library. These are storage/validation limits, not resource or army limits. Profiles contain allowlisted data, never executable scripts.

| Storage | Contents / caveat |
|---|---|
| Desktop `userdata/custom-settings.json` | Drafts and presets through restricted IPC, independent of temporary local HTTP ports |
| Browser `localStorage` | Origin-specific drafts/presets; changing address/port or clearing site data changes/removes storage |
| External `config/custom.json` | Startup overrides; the panel never rewrites this file |
| Exported JSON | Transferable draft for panel import, not a replacement startup file |

Version-1 profiles migrate to version 2: shared units/crystal values are copied to both sides and missing AI fields receive baseline defaults. Existing storage keys and the outer export/library envelope remain compatible; the inner profile reports `schemaVersion: 2`.

Restored drafts/presets **never activate automatically after restart**. They are not battle saves: positions, current resources, RNG state and progress are absent. Speed/pause/camera/display targets are session controls, not rules-preset fields; a new session starts at 1×.

Storage errors show warnings and leave the in-memory draft exportable. Desktop saving requires backend acknowledgment. Back up custom files before upgrading and export important profiles separately. Regenerating original assets does not overwrite custom files or presets.

## Development entry points

`src/customization/schema.mjs` defines editable fields and migration; `index.mjs` handles drafts/live edits/spawn jobs; `numeric.mjs` and `runtime.mjs` contain custom safe arithmetic and per-side runtime behavior. UI lives in `src/app/settings-panel.mjs`, `custom-controls.mjs` and `game-text-controls.mjs`. The recovered core and generated defaults remain separate.

The customization API retains `health: 'absolute'` for developer integrations that intentionally preserve current HP; this is not a panel setting. The single panel action chooses current-match or next-match application automatically.
