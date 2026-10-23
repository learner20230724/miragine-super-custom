# Custom settings and sandbox

[中文](custom-settings.zh-CN.md) · [Default parameter tables](parameters.en.md) · [Game clock](time-control.en.md)

This guide describes the v0.3.0-preview.1 source features. Actual packaged delivery and checks belong to the corresponding Release. Defaults still come from the super version; optional edits are not presented as recovered original rules.

## Open, pause and collapse

- Only compact settings/pause buttons remain at the lower left by default. F2 opens the dock alongside the game in wide windows, or below it in narrow windows; the game retains its aspect ratio rather than being covered by a large panel.
- Opening settings pauses combat by default. Camera observation and editing remain available. The header's resume button releases the editor pause so changes can be observed live.
- F2, Esc or the close button collapses settings. This releases only the editor pause, not a manual pause or selected 0× rate. At 0×, select a positive speed, or use the lower-left resume button to restore the previous positive speed.
- The speed slider/numeric input accepts **0–20 in 0.1 increments**; quick buttons are 0, 1, 2, 4, 8, 12, 20. Speed changes immediately without applying a draft and is not part of a rules preset.
- Display target, requested/measured rates and overview/follow controls live inside the dock. F11 is window fullscreen; overview changes camera framing.

## Editing, applying and saving are distinct

| Action | Effect on current match | Subsequent behavior |
|---|---|---|
| Edit a field, load preset or import JSON | None | Changes the draft and attempts to persist a draft backup |
| Undo | None | Undoes draft operations, up to 30 entries; not a battle rewind |
| Restore original defaults | None | Restores exposed editable fields in the draft; does not delete presets |
| Apply to current match | Explicitly updates applicable current properties | Also selects the profile for subsequent matches in this run; starting values wait for the next match |
| Set next-match rules | Leaves current match unchanged | Subsequent matches in this run use the draft; restarting does not automatically reactivate it |
| Start a new match from draft | Ends the current match and starts a new one | Uses the selected difficulty and single/local two-player mode; confirms replacement of an active match |
| Save new / overwrite selected preset | None | Persists a named profile for later loading; confirms overwrite |
| Return to original menu | Ends the match and restores the full recovered runtime configuration | Preserves draft/presets and leaves on-disk `config/custom.json` unchanged |

Restoring the default draft resets only exposed fields. Unexposed handwritten `config/custom.json` overrides survive subsequent application. To return this entire running session to recovered defaults, use return-to-original. Restarting still reads the on-disk startup configuration normally.

## Editable fields and application timing

| Section | Editable properties | Live-application timing / limits |
|---|---|---|
| Units: all 16, shared by red/blue | Name, description, HP, armor type/value, light/heavy damage, base movement/range/attack interval, hit delay, cost, population, recruitment income | Existing properties update; costs/population/income affect future recruits only, without refunds. Existing attack cooldowns remain; new projectiles use new delay |
| Economy / rounds | Income/population limits, starting money, red starting income, initial/subsequent round lengths, recruitment-check interval | Starting values wait for a new match. Current countdown, money, income and remaining population are not reset. Round length/population limit take effect at the next round settlement |
| Shared multipliers | Movement, range, attack interval | Apply through original formulas without changing the 30 Hz logic frequency |
| Crystals | Shared HP/range; red crystal's two damage values and attack interval | Update existing crystals using the chosen health policy; existing cooldowns remain |
| Difficulty / blue: four profiles | Blue initial income/population; blue crystal's two damage values/interval; AI counter-selection probability | Current difficulty's attack properties can update; initial resources wait for a new match; probability affects later AI selections |
| Automatic behavior | Red/blue recruitment and blue AI unit selection | Synchronize when applied. Disabling selection AI does not freeze existing soldiers' targeting, movement or attacks |

Field hints show units, allowed ranges and timing. See the [full parameter tables](parameters.en.md) for actual defaults and difficulty differences; editor validation ranges are not default values.

### Time, rounding and health

- **30 logic frames = 1 game second**. Round lengths and hit delays use game frames, not real milliseconds; speed changes the real wait, not the frame count.
- Effective movement = base movement × movement multiplier; range uses the corresponding range multiplier. A unit's attack cooldown is `Math.trunc(base attack interval × attack-interval multiplier)` frames. Existing cooldowns remain. Actual attacks also depend on targets, actions and hit delays; this is not a universal fixed attacks-per-second claim.
- The default ratio policy maps current HP / old maximum to the new maximum. The absolute policy changes only the maximum, preserving current HP. Both preserve possible original overhealing; neither resurrects dead units.
- Changing difficulty requires a new match; editing a different difficulty's profile does not silently switch the current match.

## Sandbox / spawning

Sandbox buttons act on **currently applied rules**, not an unapplied draft, and require an unfinished match.

- Choose red/blue, a unit and **1–100** troops per action. Original spawning is used with free sandbox accounting: no money/population charge and no income gain.
- Once custom rules or sandbox operations are explicitly enabled, manual/automatic spawning is capped at **500 troop entities**, including death animations awaiting removal. This is an opt-in custom safety ceiling, not a new cap on untouched original matches.
- Clearing one side/all troops confirms removal of troops and related attack objects, preserving crystals. It does not refund resources and cannot be undone.
- Current money/income can be set from 0–100,000,000; remaining population from 0–10,000. These are sandbox input bounds, not original resource limits.
- Current selected recruits, recruitment toggles and blue AI selection can be changed immediately. For reusable behavior, edit the automatic-behavior draft section and save a preset.
- Building construction, active skills, fixed level waves and scripted reinforcements do not exist as editable original systems here; no invented controls are provided.

## Presets, persistence and backups

The preset/file page loads drafts, saves/overwrites/deletes presets and imports/exports JSON. Limits: **25** named presets, names of 1–80 characters, **256 KiB** per imported document and **2 MiB** per library. Files contain allowlisted parameters, never executable scripts.

| Environment / file | Contents and caveats |
|---|---|
| Desktop `userdata/custom-settings.json` | Drafts/presets saved through restricted IPC, independent of the launcher's temporary local HTTP port |
| Browser `localStorage` | Drafts/presets scoped to that origin; changing address/port or clearing site data changes/removes the storage |
| External `config/custom.json` | Startup overrides, never rewritten by the panel or replaced by presets |
| Exported JSON | One transferable draft; import in the panel, not as a replacement for `config/custom.json` |

A draft backup is not a named preset, and neither is a match save: troop positions, current resources, RNG state and battle progress are not stored. Restored drafts/presets **never activate automatically after restart**. Speed, pause, display target and camera settings are not part of these rule files; startup defaults to 1× to avoid unexpectedly accelerated new sessions.

Storage errors or corrupted files show warnings; the in-memory draft remains exportable. A successful edit is not proof of durable storage: desktop saving requires backend acknowledgment. Back up both custom files before upgrading and export important profiles separately. Regenerating/extracting original assets does not overwrite these custom settings or presets.
