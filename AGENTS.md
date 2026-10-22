# Super Miragine War reconstruction

- The binding acceptance criteria are the user's 14 requirements, recorded in `docs/requirements.json`.
- This project targets the **super** Flash version, not JKS or the C++ reimplementation.
- Baseline game SWF SHA-256: `6cd4a86045d828517c5eaabacfa04ae16719733778f8b20b3c855e5f03df7149`.
- Never edit the sibling `miragine-originals-20261022` archive or any zombie reconstruction project.
- Preserve byte-identical source evidence. Keep extraction / decompilation / manual porting provenance explicit.
- A SWF player wrapper is a reference oracle only, never acceptance of the reconstructed app.
- Do not invent stats, wave systems, cooldowns, levels, skills, buildings, or reinforcement rules absent from the original. Mark absent systems as not applicable.
- Separate core simulation, rendering, platform adapters, assets, generated data, custom configuration, extension code, tests, and documentation.
- Regeneration may update generated files only; it must never overwrite custom configuration or extension code.
- Preserve a faithful default profile. Optional enhancements must be separately enabled and tested.
- Runtime UI must show only the game. Use the full available viewport with aspect-preserving scaling and correctly transformed pointer coordinates.
- Chinese and English READMEs should focus on features, running, configuration, and development. Keep provenance and legal details in separate documents.
- Never stage `.local`, caches, complete chat exports, local absolute paths, usernames, tokens, or credentials. Scan public artifacts before publishing.
- User confirmed on 2026-10-23 that original assets and recovered code may be publicly redistributed. Record attribution and distinguish that permission statement from an original-author open-source release.
- Tests and claims must be supported by actual outputs. Packaging, full-match parity, custom config, resizing, and release installation are distinct acceptance gates.

## Coordination

Agents may work in parallel only in assigned nonoverlapping directories. Do not modify another agent's generated sources while it is exporting.
