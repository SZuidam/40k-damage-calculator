# Warhammer 40k Damage Calculator

This file is the starting point for picking the project up in a new session: what has been built, why it was built that way, and where to extend it.

## Goal

A single-page browser app. You enter one or more attacking weapon profiles and a defending unit, run N simulated dice rolls (Monte Carlo), and see the average result of each step plus the distribution of kills. v1 covers the core attack sequence only: hit → wound → save → damage. Abilities that change rolls come later, so the engine is built to be extended.

## Stack and commands

- **Vite 8 + vanilla TypeScript 7**, no UI framework. **Vitest 5** for the engine tests.
- `npm run dev`: dev server
- `npm test`: Vitest, run once (142 tests, about 3 s)
- `npm run test:watch`: Vitest in watch mode
- `npm run build`: `tsc --noEmit` + `vite build` to `dist/`
- `tsconfig.json` uses strict mode, `verbatimModuleSyntax` and `noUnusedLocals/Parameters`. Use `import type` for types.

## Layout

```
index.html              static shell: attacker panel, defender panel, run bar, results section
src/
  main.ts               app state, wiring of views and preset bars, optimiser debounce, simulate button
  style.css             design tokens on :root, dark mode, layout, chart, preset bar and dialog styles
  types.ts              WeaponStats, StoredWeapon, AttackRow, RowSnapshot, *Preset, WeaponProfile (engine input), DefenderProfile, results
  engine/
    rng.ts              Rng type, mulberry32(seed), rollDie, d6 (default rng = Math.random)
    dice.ts             tryParseDice/parseDice, rollDice, diceDistribution (exact PMF), convolve
    rules.ts            woundTarget, saveTarget, rollSucceeds, AttackContext + step functions
    simulate.ts         Monte Carlo simulate(weapons, defender, iterations, rng), atLeast()
    exact.ts            exact Markov-chain expectation (weaponKernel, applyWeapon, exactResult)
    optimise.ts         optimiseOrder(): exhaustive for 7 or fewer weapons, greedy above that
    testFixtures.ts     shared weapon and defender fixtures for tests
    *.test.ts           tests next to each module
  state/                pure, DOM-free, unit-tested
    ids.ts              uid()
    storage.ts          loadState / saveState (key damage-calculator:v2), v1 migration, shape checks, defaults
    abilities.ts        ability labels, "Add ability…" choices, sameAbilities
    presets.ts          resolveRows, snapshotRows, sameSnapshot, sameDefender, materialiseRows, weaponUsage, helpers
    share.ts            export file (build/serialise), parseShareText, planImport, applyImport, uniqueName
  ui/
    dom.ts              h() element builder, field/select helpers, option lists
    validation.ts       validateWeaponStats / validateRow / validateDefender / validateIterations, LIMITS
    modal.ts            openModal() around a native <dialog>, confirmDialog(), promptName()
    weaponModal.ts      openWeaponModal(initial?): create or edit a weapon profile
    libraryModal.ts     "Weapon profiles…": list, create, edit, delete (blocked while in use)
    attackList.ts       AttackList class: Models + weapon select + read-only stat chips + ✎; add / remove / move / reorder; compact mode
    presetBar.ts        PresetBar class: [Preset ▾] [Save] [Save as…] [Delete] with dirty detection
    unitModal.ts        "Units…": list, create, edit, delete attacking unit presets
    shareModal.ts       "Export…" (pick items, Copy / Download) and "Import…" (paste or file, review, import)
    defenderForm.ts     renderDefenderForm() → { setValues() }
    results.ts          createResultsView(): summary tiles, step table (`10× Bolt rifle`), kill chart (SVG) + table view
```

## Rules implemented (confirmed with the user)

- **Hit:** d6 ≥ BS/WS. An unmodified 1 always fails.
- **Wound:** S ≥ 2T → 2+, S > T → 3+, S = T → 4+, S < T → 5+, T ≥ 2S → 6+. An unmodified 1 always fails.
- **Save:** armour target = Sv + |AP| (AP is entered as 0 or a negative number). Effective target = min(armour, Inv), and AP does not affect Inv. A target above 6 fails automatically (`IMPOSSIBLE = 7`). Sv 7 means no armour save. An unmodified 1 always fails.
- **Damage:** rolled separately for each failed save. Applied damage = min(damage, wounds left on the current model), and any excess is lost. The next failed save goes to the next model, which has full wounds. A partly wounded model carries over between weapons.
- **Critical hit / critical wound:** an unmodified roll of 6 that succeeds (`ctx.criticalHit` / `ctx.criticalWound`, both 6 for now).
- **Lethal Hits:** a critical hit wounds automatically; there is no wound roll. That auto-wound is **not** a critical wound, so Devastating Wounds can't trigger on it.
- **Sustained Hits X:** a critical hit scores X extra hits (X is stored as a dice expression; the UI offers 1 and 2 for now). The extra hits roll to wound normally. With Lethal Hits as well, the critical hit itself auto-wounds and only the extra hits roll.
- **Devastating Wounds:** a critical wound skips the saving throw (armour and invulnerable). Damage is applied as normal (excess lost, no spill-over), as per the current rules rather than the old mortal-wounds version.
- When every defending model is destroyed, damage stops being applied. Hits, wounds and unsaved wounds are still counted, so the per-step stats show the weapon's full output.
- **Weapon order:** weapons resolve top to bottom. The user can reorder them, and the "Optimise order" button can reorder them for the user.

## Inputs

- **Weapon profile** (library, edited in a modal): name (required, max 40), A (dice expression), BS/WS (2–6), S, AP (0 to -6), D (dice expression), abilities.
- **Abilities** (`WeaponAbilities` = `{ lethalHits, sustainedHits: string | null, devastatingWounds }`): in the modal an "Add ability…" dropdown plus a removable chip per ability. Choosing another Sustained Hits value replaces the current one. The options live in `state/abilities.ts` (`ABILITY_CHOICES`, `SUSTAINED_HITS_VALUES = ['1', '2']`: extend there for D3/D6 and higher numbers; the engine already handles any dice expression).
- **Attack row:** models + a weapon picked from the library. The row's stats are read-only chips with the abilities as read-only text below them; ✎ edits the linked profile.
- **Defender:** models, T, Sv (2–6, or 7 for none), Inv (none or 2–6), W.
- **Dice expressions:** `3`, `D3`, `D6`, `2D6`, `D6+1`, `2D3+2`. Case and spaces don't matter. Only **D3 and D6** are allowed, only a **`+` bonus** (no minus), at most 20 dice, and constants from 1 to 200.
- **Limits** (`ui/validation.ts`): weapon models 1–50, S 1–30, defender models 1–40, T 1–20, W 1–40, **models × wounds ≤ 400** (keeps the exact engine responsive), iterations 100 to 1,000,000 (default 10,000).

## Engine design

- **Extension point (`rules.ts`):** each step is a small function `(ctx: AttackContext, roll) => boolean`: `hitSucceeds`, `woundSucceeds` and `saveSucceeds`. `hitChance`/`woundChance`/`saveChance` work out their probabilities by running those same functions over all six die faces, so the simulation and the exact engine stay consistent. Put modifiers, rerolls, lethal hits and similar abilities here. Rerolls and lethal hits need a richer return value than a boolean.
- **simulate.ts:** each iteration rolls attacks per model, then hit, wound, save and damage per attack, and tracks `modelsLeft` and `woundsLeft`. It returns per-weapon and total averages, `killDistribution` (P(exactly k)) and `killAtLeast` (P(≥k)). It runs synchronously on the main thread (about 20 ms for 10k iterations). Move it to a Web Worker only if it gets slow.
- **exact.ts:**
  - The defender is a Markov chain over (modelsLeft, woundsLeftOnCurrent), plus an absorbing "all destroyed" state. The state vector's index 0 is "all destroyed", and index `1 + (m-1)·W + (w-1)` is the state (m, w).
  - For each weapon, the number of unsaved wounds K has an exact distribution: the per-attack unsaved-wound PMF (`rules.unsavedDistribution`, which covers Lethal / Sustained / Devastating) summed over the random number of attacks. Values at or above models × W are lumped into the last entry (the unit is gone either way), which keeps the kernel at most 401 entries long.
  - The state after a weapon is Σ P(K=k)·T^k(state). The loop stops early once all probability is in the "destroyed" state or k ≥ models×W.
  - The results are noise-free, so the optimiser uses them, and the tests use them as an oracle for the simulation.
- **optimise.ts:**
  - Builds each weapon kernel once, then searches the permutations depth-first. Orders with the same prefix share the state computed for that prefix.
  - Score: expected models destroyed, with expected damage applied as the tie-break.
  - `beneficial` is true when the best order beats the current one by more than 0.01 expected models.
  - Worst case is about 250 ms for 7 weapons into 20×W6. The UI runs it with a 200 ms debounce whenever inputs change.

## Key finding: order is irrelevant for exactly two weapons

The kill count of a sequence of damage rolls (with excess damage lost) stays the same when the sequence is reversed. Damage rolls within a weapon are independent and identically distributed, so E[kills(A then B)] = E[kills(B then A)]. **With two weapons, order never changes expected kills.** It only changes the damage left on a partly wounded model. With **three or more weapons, order does matter**. Example fixture: bolt rifles → lascannon → heavy bolter into 5×W3 (T4 Sv3) gives 0.95 kills, and lascannon → bolt rifles → heavy bolter gives 1.07 (+0.12). A list and its reverse always give the same expected kills. The tests rely on all of this, so don't "fix" the optimiser to flag two-weapon lists.

## UI behaviour

- Edits mutate the state objects in place and call `onInputsChanged()`. That function saves to `localStorage` (key `damage-calculator:v2`), enables or disables Simulate, marks old results as stale, refreshes both preset bars (their dirty state can change) and schedules the optimiser. State arrays (`library`, `rows`, presets) are always mutated in place (`splice`), because the views hold references to them.
- All pop-ups are native `<dialog>`s through `ui/modal.ts` (Esc and backdrop click cancel, nested dialogs stack). Don't use `window.confirm`/`prompt`: they block browser automation.
- Invalid fields get `aria-invalid` and an error line under their row. Simulate is disabled until every field is valid.
- **Optimise order** is disabled with fewer than two weapons or while inputs are invalid. It gets the amber `.is-recommended` style and a badge (`+0.12 models`) when it would help. The status line explains the result, and the tooltip lists the best order. Clicking it applies `bestOrder`. When the gain is below the threshold, it only moves weapons if that applies more damage without changing kills.
- **Results:**
  - A headline average kills figure, plus stat tiles for damage applied, unsaved wounds and P(unit wiped out).
  - The "Average per step" table (one row per weapon plus a Total row).
  - A column chart of P(≥k destroyed) for k = 1..M, with a hover/focus tooltip that also shows P(exactly k), and a "Show as table" view.
  - The chart was built following the `dataviz` skill: one series in blue (`#2a78d6` light / `#3987e5` dark, both validated), columns at most 24px wide with a 4px rounded top, and hairline gridlines. It redraws on resize with a ResizeObserver.
- **Theme:** tokens on `:root`, dark mode through `prefers-color-scheme` and `:root[data-theme='dark']`. The layout works at 390px wide with no sideways scrolling.

## Weapon library and presets (session 2, 2026-11-19)

**Data model** (`types.ts`):

- `StoredWeapon` = `WeaponStats` (name, A, BS/WS, S, AP, D; no models) + `id`. The library is the list of these.
- `AttackRow` = `{ id, models, weaponId | null }`. Live rows are **linked** to the library: editing a profile changes every row that uses it straight away.
- `RowSnapshot` = `{ models, weaponId, weapon: WeaponStats }`. Presets hold **copies**: `AttackPreset` (the whole attack order), `UnitPreset` (a block of rows appended with "+ Add unit"), `DefenderPreset` (`{ defender }`).
- `WeaponProfile` stays the engine input. `resolveRows(rows, library)` builds it: row id → weapon id (two rows may share a weapon), library name → weapon name. The engine is unchanged.

**Storage** (`state/storage.ts`): one key, `damage-calculator:v2`, holding `{ library, rows, defender, iterations, attackPresets, unitPresets, defenderPresets, activeAttackPresetId, activeDefenderPresetId }`. Every read and write is wrapped in try/catch, and everything is shape-checked on load: corrupt JSON → defaults; empty library → default library + rows (presets kept); rows pointing at a missing weapon → `weaponId: null`; stale active ids → null. If v2 is missing and `damage-calculator:v1` exists, each v1 weapon becomes a library entry (deduplicated by name + stats) plus a row. The v1 key is left in place. Default: one "Bolt rifle" profile, a row of 10 models, 10 MEQ.

**Preset semantics** (`state/presets.ts`):

- Presets are snapshots: editing a library profile never changes a saved preset. They change only through Save, Save as, or Save in the unit editor.
- **Dirty** means the workspace differs from the active preset. For attacks, `sameSnapshot` compares row count, order, models and the **combat stats** (A, BS, S, AP, D; dice compared case- and space-insensitively). The weapon **name and id are ignored**, so a rename or a suffixed copy (below) doesn't count as a change. A row without a weapon also counts as dirty. Defenders compare field by field. While dirty, the select shows `Name (modified)` and Save is enabled.
- **Loading** (`materialiseRows(snapshots, library, presetName)`), per snapshot: the entry with the same id and the same combat stats; else an entry with the same combat stats named like the snapshot or like an earlier copy (`Name (preset)`, or `Name (preset) 2`…); else the snapshot weapon is added, under its original id if that is free (this restores a deleted profile), otherwise under a new id named `Name (preset)`. Loading the same preset twice never duplicates entries.
- Selecting "— Unsaved —" only detaches from the preset (nothing is discarded). Switching to another preset while dirty asks "Discard changes to X?". "Save as" with an existing name asks to overwrite. Save and Save as are disabled while inputs are invalid.
- To revert a modified preset: select "— Unsaved —", then the preset again.
- A library profile can't be deleted while a live row uses it (`weaponUsage`). Presets don't count, because they hold copies.
- The unit editor works on live draft rows (the same `AttackList` in compact mode). Opening an existing unit materialises its rows, which may restore weapons into the library; Save snapshots them.

## Verification status (end of v1 session, 2026-11-19)

- `npm test`: 77/77 pass. The tests cover:
  - wound and save tables, including edge cases
  - dice parsing and distributions
  - exact engine against hand calculations
  - seeded simulation against the exact engine (100k iterations, within 1%): overkill, carry-over between weapons, random attack counts with an invulnerable save, and a vehicle
  - optimiser: best order, no flag on an already-optimal order, no flag on two-weapon lists, the threshold, and the greedy fallback
- `npm run build`: clean.
- Manual check in headless Chrome: 10 bolt rifles into 10 MEQ gave ≈ 3.33 unsaved wounds as expected. The optimiser highlight, reorder, stale notice, validation, tooltip, dark mode and mobile layout were all checked.

**Session 2 (library and presets):** `npm test` 106/106 (the 77 engine tests unchanged, plus `state/presets.test.ts`, `state/storage.test.ts` and `ui/validation.test.ts`). `npm run build` is clean. Checked in Chrome: v1 → v2 migration with dedupe; "+ New weapon profile…" from a row select, with validation; ✎ updates every row using the profile; a saved preset turns "(modified)" after a library edit, and reloading it brings the old stats back as `Bolt rifles (Squad A)`; defender presets, including the discard prompt; a unit created from the current attack and appended; delete blocked for in-use profiles; Optimise order reorders rows; Simulate gives 20 / 13.33 / 6.67 / 3.33 for 10 bolt rifles into 10 MEQ, the same as v1; dark, light and 390px, including the modals; no console errors.

## Weapon abilities (session 3, 2026-11-19)

- `abilities` is a required field on `WeaponStats` and `WeaponProfile`. Storage fills in "no abilities" for weapons saved before (library, presets, v1 migration) and repairs malformed values, so the storage key stays `damage-calculator:v2`.
- `sameCombatStats` compares abilities too: an ability change makes a preset "(modified)", and loading a preset whose weapon differs only in abilities creates a `Name (preset)` copy.
- `statsSummary` (library modal) appends the abilities. Results count Sustained Hits extra hits under Hits, and Lethal Hits auto-wounds under Wounds.
- `npm test` 131/131 (new: ability rules against hand calculations, sim vs exact for each ability and a combined loadout, the kernel cap, storage, presets, validation, `state/abilities.test.ts`). `npm run build` is clean. Checked in Chrome: add, replace (SH1 → SH2), remove, save, read-only row text, localStorage, and 10 bolt rifles with all three abilities into 10 MEQ: hits 16.67, wounds 9.97 (expected 10.0), unsaved 6.08 (expected 6.11); no console errors.

## Import and export (session 4, 2026-11-19)

- **Export…** / **Import…** buttons sit in the page header. Export lists attack profiles, units, defenders and weapon profiles as grouped checkboxes (all checked, a select-all box per group) and offers **Copy** (clipboard) and **Download** (`damage-calculator-YYYY-MM-DD.json`).
- **File format** (`state/share.ts`): `{ format: "damage-calculator-share", version: 1, exportedAt, attacks, units, defenders, weapons }`. Presets travel without ids (the importer assigns new ones) and keep their `RowSnapshot` weapon copies, so they are self-contained. Weapon profiles keep their ids so preset rows link to them when loaded.
- **Parsing** reuses the storage shape checks (`isRecord`, `list`, `toWeaponStats`, `toSnapshot`, `toDefender` are now exported): malformed entries are dropped, missing abilities are filled in, names are trimmed and cut to 40 characters. Clear errors for empty input, invalid JSON, a non-export, a newer version, or nothing to import. Max 1,000,000 characters.
- **Review** (`planImport`) tags each item: new; **Already saved** (same name, case-insensitive, and same content: not selectable); **Name in use** (same name, different content); invalid (fails `ui/validation`, with the first error shown: not selectable). When a selected item has a name clash, a choice appears: **Keep both** (imported as `Name (2)`, `Name (3)`…) or **Replace the saved item** (a replaced weapon keeps its library id, so rows using it change straight away). Clashes inside one import are always renamed.
- `applyImport` mutates the state arrays in place (weapons first), then `main.ts` re-renders the unit select, the rows and the preset bars and saves.
- `npm test` 142/142 (new `state/share.test.ts`). `npm run build` is clean. Checked in Chrome: invalid JSON error, review tags, import with a rename, loading the imported attack profile links its rows to the imported weapon and restores the missing Lascannon, export lists the result; no console errors.

## Housekeeping

- The repo is on GitHub (`origin`, branch `master`). The remote also has an unrelated `main` branch from when the repo was created; `master` is the working branch.
- `.gitattributes` keeps text files on LF line endings on every OS. `.gitignore` covers `node_modules`, `dist`, `*.local`, `*.log` and `*.stackdump` (Git Bash crash dumps).

## Ideas for next steps

- More Sustained Hits values (3–6, D3, D6): only `SUSTAINED_HITS_VALUES` needs to grow.
- More abilities through the `AttackContext` step functions: hit/wound modifiers, rerolls (1s or all), Anti-X (lowers `criticalWound`), Twin-linked, Torrent, Feel No Pain, damage reduction, cover.
- Show the exact expected values next to the simulated ones, or offer an "exact only" mode.
- A Web Worker for large iteration counts.
- A share link (export encoded in the URL hash) next to Copy / Download.
- A "Revert" button on the preset bar instead of the detach-and-reselect workaround.
