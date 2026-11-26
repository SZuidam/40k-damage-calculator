# Warhammer 40k Damage Calculator

This file is the starting point for picking the project up in a new session: what has been built, why it was built that way, and where to extend it.

## Goal

A single-page browser app. You enter one or more attacking weapon profiles and a defending unit, run N simulated dice rolls (Monte Carlo), and see the average result of each step plus the distribution of kills. v1 covers the core attack sequence only: hit → wound → save → damage. Abilities that change rolls come later, so the engine is built to be extended.

## Stack and commands

- **Vite 8 + vanilla TypeScript 7**, no UI framework. **Vitest 5** for the engine tests.
- `npm run dev`: dev server
- `npm test`: Vitest, run once (302 tests, about 9 s)
- `npm run test:watch`: Vitest in watch mode
- `npm run build`: `tsc --noEmit` + `vite build` to `dist/`
- `tsconfig.json` uses strict mode, `verbatimModuleSyntax` and `noUnusedLocals/Parameters`. Use `import type` for types.

## Layout

```
index.html              static shell: sticky app bar (☰), attacker panel (profile bar host, conditions, rows host, Add weapon… select, Optimise order), defender panel, run bar, results section
src/
  main.ts               app state, the working area and active profile, wiring of the main page (profile bar, rows, Add weapon…, Optimise order), the drawer and its tabs (Units · Weapons · Settings), optimiser debounce, simulate button
  style.css             design tokens on :root, dark mode, app bar, drawer + tabs, ⋯ menus, rows (container queries), chart, dialog styles
  types.ts              WeaponStats, WeaponAbilities (+ copyAbilities), AttackConditions (+ noConditions), DEFENDER_KEYWORDS / KEYWORD_NAMES, StoredWeapon, ProfileRow, Profile, RowSnapshot (v2 data / v1 export files only), DefenderPreset, WeaponProfile (engine input), DefenderProfile, Army, UnitStats, Unit, results
  engine/
    rng.ts              Rng type, mulberry32(seed), rollDie, d6 (default rng = Math.random)
    dice.ts             tryParseDice/parseDice, rollDice, diceDistribution (exact PMF), convolve, repeatDice, sums of expressions (rollDiceSum, diceSumDistribution, formatDiceSum)
    rules.ts            woundTarget, saveTarget, rollSucceeds, bonusAttacks, woundModifier, antiCriticalWound, AttackContext + step functions
    simulate.ts         Monte Carlo simulate(weapons, defender, iterations, rng), atLeast()
    exact.ts            exact Markov-chain expectation (weaponKernel, applyWeapon, exactResult)
    optimise.ts         optimiseOrder(): exhaustive for 7 or fewer weapons, greedy above that
    testFixtures.ts     shared weapon and defender fixtures for tests
    *.test.ts           tests next to each module
  state/                pure, DOM-free, unit-tested
    ids.ts              uid()
    storage.ts          loadState / saveState (key damage-calculator:v4), v3 → v4 (fromV3), v2 / v1 → v3 migration, shape checks (incl. toArmy / toUnit), defaults (incl. the attack conditions)
    legacy.ts           v3 linked rows (LinkedRow, LinkedAttack), findWeapon, snapshotRows, materialiseRows: only for the v2 → v3 step of the migration
    abilities.ts        ability labels, "Add ability…" choices, withAbilityValue, withAntiValue / withoutAnti, parseAntiValue, sameAbilities
    presets.ts          pickStats, copyDefender, sameCombatStats, resolveRows, copyRows, sameRows, sameDefender, uniqueName, byName, summaries (statLine, defenderSummary, …)
    units.ts            armies and units: newUnit, copyUnit, sameUnit, isNameTaken, unitSummary, groupUnits, unitsInArmy, deleteArmy
    share.ts            export file (build/serialise), parseShareText, planImport, applyImport (re-exports uniqueName)
  ui/
    dom.ts              h() element builder, field/select helpers, option lists
    validation.ts       validateWeaponStats / validateRow / validateDefender / validateIterations, abilityValueError, antiValueError, LIMITS
    modal.ts            openModal() around a native <dialog>, confirmDialog(), promptName() (optional validate)
    drawer.ts           Drawer class: the configuration <dialog> sliding in from the right, ARIA tabs (Units · Weapons · Settings), open(tab?)
    menu.ts             Menu class: ⋯ button + menu (arrow keys, Esc, click outside, disabled items with a reason)
    weaponModal.ts      openWeaponModal(initial?, { takenNames? }): create or edit a weapon profile
    abilityValuePopover.ts  openAbilityValuePopover(): small pop-up asking for the X of Sustained Hits / Blast / Cleave / Rapid Fire / Melta or the Y of Anti-X Y+
    statChips.ts        statChips(): read-only stat chips + ability text (Blast / Rapid Fire / Melta bonuses, active Anti / condition outlines) for the rows
    profileRows.ts      ProfileRows class: the working area on the main page (Models + weapon name + chips + ↑ ↓ ✕), add(weapon), reorder(), refreshStats()
    weaponsPanel.ts     WeaponsPanel class (Weapons tab): list, create, edit, delete (never blocked)
    unitsPanel.ts       UnitsPanel class (Units tab): army filter + ⋯ (New army… / Rename… / Delete), units grouped by army, unit editor on a draft with its own weapons
    statFields.ts       SAVE_OPTIONS / INVULN_OPTIONS and keywordToggles(), shared by the defender form and the unit editor
    presetBar.ts        PresetBar class: [Preset ▾] [⋯ Save / Save as… / Rename… / Delete] with dirty detection, for profiles and defender presets
    shareModal.ts       "Export…" (pick items, Copy / Download) and "Import…" (paste or file, review, import), opened from the Settings tab
    defenderForm.ts     renderDefenderForm() → { setValues() }: stats plus the keyword toggles
    conditionsForm.ts   renderAttackConditions() → { setValues() }: the "Within half range" / "Charged this turn" toggles
    results.ts          createResultsView(): summary tiles, step table (`10× Bolt rifle`), kill chart (SVG) + table view
```

## Rules implemented (confirmed with the user)

- **Hit:** d6 ≥ BS/WS. An unmodified 1 always fails.
- **Wound:** S ≥ 2T → 2+, S > T → 3+, S = T → 4+, S < T → 5+, T ≥ 2S → 6+. An unmodified 1 always fails. A wound roll modifier (`ctx.woundModifier`, capped at -1 / +1 by `MAX_ROLL_MODIFIER`) is added to the roll before it is compared with the S vs T target; critical wounds are always judged on the **unmodified** roll.
- **Save:** armour target = Sv + |AP| (AP is entered as 0 or a negative number). Effective target = min(armour, Inv), and AP does not affect Inv. A target above 6 fails automatically (`IMPOSSIBLE = 7`). Sv 7 means no armour save. An unmodified 1 always fails.
- **Damage:** rolled separately for each failed save. Applied damage = min(damage, wounds left on the current model), and any excess is lost. The next failed save goes to the next model, which has full wounds. A partly wounded model carries over between weapons.
- **Critical hit / critical wound:** an unmodified roll that succeeds and is at least `ctx.criticalHit` / `ctx.criticalWound`. Both are 6, except that Anti-X Y+ lowers `criticalWound`.
- **Lethal Hits:** a critical hit wounds automatically; there is no wound roll. That auto-wound is **not** a critical wound, so Devastating Wounds can't trigger on it.
- **Sustained Hits X:** a critical hit scores X extra hits (X is a dice expression, rolled per critical hit). The extra hits roll to wound normally. With Lethal Hits as well, the critical hit itself auto-wounds and only the extra hits roll.
- **Devastating Wounds:** a critical wound skips the saving throw (armour and invulnerable). Damage is applied as normal (excess lost, no spill-over), as per the current rules rather than the old mortal-wounds version.
- **Blast X:** each model makes X extra attacks for every 5 models in the target unit (rounded down), on top of the weapon's A. X is a dice expression rolled **independently per block of 5 and per attacking model**: Blast D6+2 into 10 models adds 2D6+4 attacks per model (`rules.bonusAttacks` returns one `DiceExpr` per ability via `repeatDice`; `ctx.attacks` stays the base A and `attacksPerModel(ctx)` = A plus those terms, rolled with `rollDiceSum` / convolved with `diceSumDistribution`). The unit size is the defender's **starting** model count, as when targets are picked: models destroyed by earlier weapons in the list don't lower it.
- **Cleave X:** the melee version of Blast X. The app doesn't tell ranged and melee apart, so it works exactly like Blast. A weapon with both rolls both.
- **Anti-X Y+:** against a target with keyword X, an unmodified wound roll of Y+ is a critical wound and always wounds, whatever S vs T says (`woundSucceeds`: `roll !== 1 && (roll + woundModifier >= woundTarget || roll >= criticalWound)`). With several matching Anti abilities the lowest Y counts (`antiCriticalWound`). Devastating Wounds then triggers on Y+ as well. Lethal Hits auto-wounds stay non-critical.
- **Rapid Fire X:** while the attack condition *Within half range* is on, each model makes X extra attacks (a dice expression rolled once per attacking model; the defender's size doesn't matter). It is one more `bonusAttacks` term, so it stacks with Blast / Cleave.
- **Melta X:** while the attack condition *Within half range* is on, X is added to the Damage characteristic of every unsaved wound (a dice expression rolled with each damage roll, so Melta D3 on D6 is D6+D3 per wound). `rules.bonusDamage` returns the term, `ctx.damage` stays the base D and `damagePerWound(ctx)` = D plus that term, rolled with `rollDiceSum` / convolved with `diceSumDistribution` into the exact engine's damage PMF. Excess damage is still lost, as for any damage.
- **Lance:** while the attack condition *Charged this turn* is on, +1 to the wound roll (`woundModifier`). S4 vs T4 goes from 4+ to 3+, S4 vs T8 from 6+ to 5+, a 2+ still fails on a 1. Lance never makes a critical wound on its own: Devastating Wounds and Anti still use the unmodified roll.
- **Twin-linked:** a failed wound roll is re-rolled once, and the re-roll stands whether it passes or fails (a die is never re-rolled twice). Only failed rolls are re-rolled, so a successful non-critical wound is never re-rolled to fish for a Devastating Wounds 6. The re-rolled die counts as an unmodified roll: it gets the same Lance modifier, and a re-rolled 6 (or Y+ with Anti) is a critical wound. Lethal Hits auto-wounds make no wound roll, so there is nothing to re-roll. In the maths, `woundRollFaces(ctx)` gives the probability of each final face, P(f) = [f wounds]/6 + P(first roll fails)/6, and `woundChance` / `unsavedPerWoundRoll` weigh the faces with it; S4 vs T4 goes from 1/2 to 3/4, in general p + (1 − p)·p.
- When every defending model is destroyed, damage stops being applied. Hits, wounds and unsaved wounds are still counted, so the per-step stats show the weapon's full output.
- **Weapon order:** weapons resolve top to bottom. The user can reorder the rows on the main page, and the "Optimise order" button under them can reorder them for the user.

## Inputs

- **Weapon profile** (library, edited in a modal): name (required, max 40), A (dice expression), BS/WS (2–6), S, AP (0 to -6), D (dice expression), abilities.
- **Abilities** (`WeaponAbilities` = `{ lethalHits, sustainedHits, devastatingWounds, blast, cleave, anti, rapidFire, melta, lance, twinLinked }`, the X fields `string | null` dice expressions, `anti` a `Partial<Record<DefenderKeyword, number>>` of Y per keyword, e.g. `{ vehicle: 4, monster: 4 }`): in the modal an "Add ability…" dropdown with one entry per ability (`ABILITY_CHOICES` in `state/abilities.ts`) plus a removable chip per ability. Picking `Sustained Hits X…`, `Blast X…`, `Cleave X…`, `Rapid Fire X…` or `Melta X…` opens a small pop-up beside the dropdown (`ui/abilityValuePopover.ts`) with a text input that takes the same dice expressions as A and D; OK is disabled while the value is invalid, Enter confirms without submitting the weapon form, Esc / Cancel / a click outside closes only the pop-up. Clicking the label of an X chip reopens the pop-up prefilled to change X. Values are stored normalised (`withAbilityValue`: ` d6 + 2 ` → `D6+2`). Validation (`abilityValueError`): the expression must parse and its highest roll must be at most 12 (`LIMITS.abilityValue.max`, allows 2D6 / D6+6 and keeps the exact engine's attack PMF small).
- **Attack conditions** (`AttackConditions` = `{ halfRange, charged }`): two pill toggles, "Within half range" and "Charged this turn", in their own segment of the Attacker panel between the profile bar and the rows. They apply to every weapon and are situational: saved with the page state (`StoredState.conditions`) but not in profiles or exports.
- **Row** (main page): models + a **copy** of a library weapon, added with "Add weapon…". Only the models can change; the copy's stats are read-only chips with the abilities as read-only text below them. Editing the library never changes a row.
- **Defender:** models, T, Sv (2–6, or 7 for none), Inv (none or 2–6), W, and keywords (Vehicle, Monster, Psyker, Infantry, Fly; `DefenderProfile.keywords`, always in `DEFENDER_KEYWORDS` order without duplicates) as pill-shaped checkbox toggles under the stats.
- **Dice expressions:** `3`, `D3`, `D6`, `2D6`, `D6+1`, `2D3+2`. Case and spaces don't matter. Only **D3 and D6** are allowed, only a **`+` bonus** (no minus), at most 20 dice, and constants from 1 to 200.
- **Limits** (`ui/validation.ts`): weapon models 1–50, S 1–30, defender models 1–40, T 1–20, W 1–40, **models × wounds ≤ 400** (keeps the exact engine responsive), iterations 100 to 1,000,000 (default 10,000).

## Engine design

- **Extension point (`rules.ts`):** each step is a small function `(ctx: AttackContext, roll) => boolean`: `hitSucceeds`, `woundSucceeds` and `saveSucceeds`. `hitChance`/`woundChance`/`saveChance` work out their probabilities by running those same functions over all six die faces, so the simulation and the exact engine stay consistent. Put modifiers, rerolls, lethal hits and similar abilities here. Wound re-rolls go through `woundRollFaces(ctx)` (the final-face distribution after re-rolls); a hit re-roll would get a matching `hitRollFaces` that `unsavedDistribution` weighs its per-face outcomes with instead of 1/6.
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

- Edits mutate the state objects in place and call `onInputsChanged()`. That function saves to `localStorage` (key `damage-calculator:v4`), refreshes the rows' chips and validation, enables or disables Simulate (the run status says why it is disabled), marks old results as stale, refreshes the profile and defender preset bars (their dirty state can change) and schedules the optimiser. Library changes call `onLibraryChanged()` instead (save, refresh the Add weapon… select and the Weapons tab): rows hold copies, so nothing else changes. State arrays (`library`, `rows`, `profiles`, `defenderPresets`) are always mutated in place (`splice`), because the views hold references to them; loading a profile splices copies into `state.rows` and calls `profileRows.render()`.
- All pop-ups are native `<dialog>`s through `ui/modal.ts` (Esc and backdrop click cancel, nested dialogs stack), and so is the configuration drawer (`ui/drawer.ts`). Don't use `window.confirm`/`prompt`: they block browser automation.
- Invalid fields get `aria-invalid` and an error line under their row. Simulate is disabled until every field is valid.
- **Optimise order** (main page, under the rows) is disabled with fewer than two weapons or while inputs are invalid. It gets the amber `.is-recommended` style and a badge (`+0.12 models`) when it would help. The status line explains the result, and the tooltip lists the best order. Clicking it applies `bestOrder`. When the gain is below the threshold, it only moves weapons if that applies more damage without changing kills.
- **Results:**
  - A headline average kills figure, plus stat tiles for damage applied, unsaved wounds and P(unit wiped out).
  - The "Average per step" table (one row per weapon plus a Total row).
  - A column chart of P(≥k destroyed) for k = 1..M, with a hover/focus tooltip that also shows P(exactly k), and a "Show as table" view.
  - The chart was built following the `dataviz` skill: one series in blue (`#2a78d6` light / `#3987e5` dark, both validated), columns at most 24px wide with a 4px rounded top, and hairline gridlines. It redraws on resize with a ResizeObserver.
- **Theme:** tokens on `:root`, dark mode through `prefers-color-scheme` and `:root[data-theme='dark']`. The layout works at 390px wide with no sideways scrolling.

## Weapon library and presets (session 2, 2026-11-19)

> Superseded for attacks and units by the profile rework (session 11), then by the UX rework (session 13): profiles hold their own weapon copies again and the main page is a working area with Save / Save as…, but without "(modified)" in the select. Defender presets still work as described here.

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

## Blast and Cleave (session 5, 2026-11-19)

- `blast` / `cleave` are new fields on `WeaponAbilities` (`number | null`). Storage fills in `null` for older saves and repairs anything that isn't a whole number ≥ 1, so the key stays `damage-calculator:v2`. `sameAbilities` compares both, so presets and the import review see them as changes.
- The engine only changes in `createAttackContext`: the extra attacks are added to the attacks dice expression, so the simulation, the exact engine and the optimiser pick it up unchanged. The extra attacks count under Attacks in the results.
- **A chip:** when Blast / Cleave applies to the current defender, the row's A chip reads `A 4+2` with the `+2` in the accent blue (`.chip-bonus`), and the tooltip names the source and the model count. Nothing is shown below 5 defending models or while the defender's model count is invalid. `AttackList.refreshStats()` updates the chips without re-rendering (so focus stays put); `main.ts` calls it from `onInputsChanged`, and passes `defenderModels` to the main list only (the compact unit editor shows no chips).
- `npm test` 149/149 (new: bonus attack counts, Blast + Cleave stacking, starting unit size after earlier weapons destroyed models, sim vs exact for Blast and Blast + Cleave, storage round trip and repair, validation, ability choices). `npm run build` is clean. Checked in Chrome: the dropdown lists Blast 1/2 and Cleave 1/2, the chip and row text show "Blast 1", localStorage holds `blast: 1`, and 10 bolt rifles with Blast 1 into 10 MEQ give 40 attacks and 6.68 unsaved (expected 6.67); no console errors.

## Ability X as a dice expression (session 6, 2026-11-19)

- `blast` / `cleave` changed from `number | null` to `string | null` (dice expressions, like `sustainedHits`). Storage (`toAbilityDice`) keeps non-empty strings and turns whole numbers ≥ 1 into text (`blast: 1` → `'1'`), so older saves and exports load unchanged and the key stays `damage-calculator:v2`. `sameAbilities` compares all three X values case- and space-insensitively.
- The dropdown now has one entry per ability; X is typed in the pop-up described under Inputs. The pop-up is appended to `.ability-editor` (positioned) so it stays inside the weapon `<dialog>`'s top layer. It sits to the right of the dropdown or chip when that fits, otherwise below it, or above it when there is no room below; it slides up so it never makes the dialog scroll (always below/above at ≤ 480px). It is placed once, when it opens, and doesn't move while the user types: the error line always reserves two lines (`.ability-popover-error` min-height), so an error appearing doesn't change the panel's height.
- **A chip:** the bonus part is `formatDiceSum(bonusAttacks(...))`, e.g. `A 2+2D6+6` for A 2, Blast D6+2 and Cleave 1 into 10 models; the tooltip names the sources. Nothing is shown while an X is invalid.
- `npm test` 177/177 (new: `repeatDice`, dice sums and `formatDiceSum`; `bonusAttacks` as dice terms incl. per-block rolls and stacking; sim vs exact for Blast D6+2 and Blast D3 + Cleave 1 on D6 attacks; mean attacks for Blast D6+2; storage migration; ability choices and `withAbilityValue`; validation of X). `npm run build` is clean. Checked in Chrome: a save with `blast: 1` loads as Blast 1 (`A 2+2`); `2D8` and `3D6` show an error and disable OK, Enter doesn't submit; `d6+2` + Enter gives chip "Blast D6+2"; Esc closes only the pop-up; clicking the chip reopens it prefilled; Sustained Hits D3 and Cleave 1 added the same way; a click outside cancels; localStorage holds the strings; 10 bolt rifles with SH D3, Blast D6+2 and Cleave 1 into 10 models give 149.99 attacks (expected 150) and 149.96 hits (expected 150); no console errors. The ≤ 480px placement was not checked in the browser (the window could not be resized).

## Anti-X Y+ and defender keywords (session 7, 2026-11-19)

- **Data:** `DefenderProfile.keywords: DefenderKeyword[]` and `WeaponAbilities.anti`. `copyAbilities` / `copyDefender` copy the nested object / array, and are used by `pickStats`, preset save / save as / load, the simulation input and share import / export, so copies never share them. Storage (`toKeywords`, `toAnti`) keeps known keywords (deduplicated, canonical order) and known Anti keys with a finite number; anything missing becomes `[]` / `{}`, so older saves and exports load unchanged and neither the storage key nor `SHARE_VERSION` changed. A Y out of range is kept and flagged by validation (`Anti-Vehicle: Y must be between 2+ and 6+`).
- **Engine:** only `createAttackContext` (`criticalWound: antiCriticalWound(...) ?? 6`) and `woundSucceeds` changed; `unsavedDistribution`, the simulation, the exact engine and the optimiser pick it up through the step functions.
- **Weapon modal:** the dropdown has one entry per keyword (`Anti-Vehicle Y+…` … `Anti-Fly Y+…`, after Devastating Wounds). Picking one opens the same pop-up asking only for Y (`2`–`6`, with or without `+`; placeholder `e.g. 4+`). Keywords with the same Y share one chip, `Anti-Vehicle/Monster 4+`; clicking it changes Y for the whole group (which may merge it with another group; focus follows the chip holding its first keyword), ✕ removes the whole group.
- **Attack row:** an Anti ability whose keywords include one of the defender's is outlined in the accent colour (`.ability-active`), with "Active: the target has the Vehicle keyword." in its tooltip and a visually hidden "(active)". `AttackList` now takes `defender: () => Pick<DefenderProfile, 'models' | 'keywords'>` instead of `defenderModels`.
- `defenderSummary` appends the keywords (`5 models · T8 · Sv 2+ · W10 · Vehicle`), so the export and import lists show them; `sameDefender` compares them, so a toggle makes a defender preset "(modified)" and an import differing only in keywords is a "Name in use" conflict.
- `npm test` 212/212 (new: Anti wound chances and critical faces for 6+ and 2+ wound targets, lowest Y, Anti + Devastating Wounds, sim vs exact for Anti + DW and Anti + Lethal + DW, Lethal auto-wounds non-critical; choices, grouping, labels, `withAntiValue` / `withoutAnti`, `parseAntiValue`, `sameAbilities`; storage round trip and repair; `sameDefender`, copies, `defenderSummary`; share export / import / conflicts; validation). `npm run build` is clean. Checked in Chrome: `7` and `abc` disable OK with the error shown, `4+` + Enter gives `Anti-Vehicle 4+` without submitting the form; adding Monster 4+ merges into `Anti-Vehicle/Monster 4+`, Psyker 4+ makes a second chip, changing it to 3+ after the group went to 3+ merges all three with focus on the merged chip; ✕ removes the group. 10× A1 S4 AP0 D1 with Anti-Vehicle 4+ and Devastating Wounds into 5× T8 Sv2+ W10: wounds 1.13 without the keyword (expected 1.11) and 3.35 with Vehicle (expected 3.33), all unsaved; the row outline follows the Vehicle toggle; a defender preset keeps its keywords, turns "(modified)" on a toggle and back when undone, reloads with the toggle set; the export JSON holds `"keywords": ["vehicle"]` and `"anti": { "vehicle": 4 }` and importing it into cleared storage restores both; no console errors. Light mode, keyboard focus on the toggles and the 390px layout were not checked in the browser.

## Rapid Fire, Lance and attack conditions (session 8, 2026-11-19)

- **Data:** `WeaponAbilities.rapidFire: string | null` and `lance: boolean`; storage reads them with `toAbilityDice` / `=== true`, so older saves and exports load with neither. `StoredState.conditions: AttackConditions` defaults to `noConditions()` and is repaired flag by flag (`toConditions`); the storage key stays `damage-calculator:v2` and `SHARE_VERSION` didn't change.
- **Engine:** `WeaponProfile` (engine input) has a required `conditions`; `resolveRows(rows, library, conditions)` gives each weapon its own copy. `createAttackContext` reads it: `bonusAttacks` adds the Rapid Fire term while `halfRange`, and `woundModifier` is +1 for Lance while `charged`. `simulate`, `exactResult`, `weaponKernel` and `optimiseOrder` kept their signatures.
- **Weapon modal:** `Rapid Fire X…` (pop-up for X, same validation as the other X values) and `Lance` (added straight away) come after Cleave in the dropdown.
- **Attack row:** within half range the A chip reads `A 2+1`, with "plus 1 from Rapid Fire 1 (within half range)" in its tooltip (Blast / Cleave sources are listed with the model count, joined with "and"). `ActiveAbility.condition` marks Rapid Fire (`halfRange`) and Lance (`charged`); while that condition is on the ability is outlined like an active Anti (`.ability-active`, "Active: the bearer charged this turn.", visually hidden "(active)"). `AttackList` takes `conditions: () => AttackConditions`; `refreshStats()` from `onInputsChanged` updates the chips.
- **Styles:** the defender keyword toggle classes were renamed to generic ones (`.toggle-group`, `.toggle-pills`, `.toggle-pill`, `.toggle-input`), shared by both forms. `.attack-conditions` floats the legend so it sits on the same line as the pills; it wraps above them when there is no room.
- `npm test` 234/234 (new: Rapid Fire terms only within half range, fixed and D3, stacking with Blast; Lance wound chances 4+→3+, 6+→5+, a 1 still failing, Lance + Devastating Wounds and Lance + Anti; sim vs exact for Rapid Fire D3 + Lance with carry-over; 20 vs 30 attacks for Rapid Fire 1; choices, labels, conditions, `sameAbilities`, `withoutAbility`; storage round trip, missing fields and condition repair; `resolveRows` conditions and `sameSnapshot` independence; validation; share round trip). `npm run build` is clean. Checked in Chrome: Rapid Fire 1 added through the pop-up and Lance as a flag; 10 bolt rifles into 10 MEQ make 20.00 attacks / 6.66 wounds, 30.00 / 10.03 within half range, and 13.37 wounds out of 20.05 hits after a charge too (2/3); the A chip reads `A 2+1` and the abilities are outlined while their condition is on; the "Rapid lances" preset stays unmodified and holds no conditions; the toggles persist after a reload and work with Tab / Space with a visible focus ring; at 390px (same-origin iframe, the window can't be resized) the legend wraps above the pills without sideways scroll; dark and light mode both fine; no console errors.

## Twin-linked (session 9, 2026-11-19)

- **Data:** `WeaponAbilities.twinLinked: boolean`; storage reads it with `=== true`, so older saves and exports load without it. No condition, no X.
- **Engine:** `AttackContext.rerollFailedWounds` (from `twinLinked`). `woundRollFaces(ctx)` returns the six final-face probabilities; `woundChance` and `unsavedPerWoundRoll` use it, so `unsavedDistribution` and the exact engine pick it up through `q` (Lethal Hits auto-wounds still use `failSave` directly, Sustained Hits extra hits roll with the re-roll). `simulate` rolls a second d6 when the first wound roll fails and keeps it.
- **Weapon modal:** `Twin-linked` (added straight away) comes after Lance in the dropdown and the chip list.
- `npm test` 247/247 (new: wound chance p + (1 − p)·p for 2+ to 6+, final faces only boost failed faces and sum to 1, re-rolled 6 with Devastating Wounds, Anti and Lance combined, Lethal Hits auto-wounds not re-rolled; sim 3/4 wound rate for S4 vs T4; sim vs exact for Twin-linked + Devastating Wounds + Sustained Hits and Twin-linked + Lethal Hits + Anti; choices, labels, `withoutAbility`, `sameAbilities`; storage round trip and missing field; share round trip). `npm run build` is clean. Not checked in the browser.

## Melta (session 10, 2026-11-20)

- **Data:** `WeaponAbilities.melta: string | null`; storage reads it with `toAbilityDice`, so older saves and exports load without it and a whole number becomes text. No new storage key or `SHARE_VERSION`.
- **Engine:** `AttackContext.bonusDamage` (from `bonusDamage(weapon)`, only while `conditions.halfRange`) and `damagePerWound(ctx)`. `simulate` rolls `rollDiceSum(damagePerWound(ctx))` per unsaved wound and `weaponKernel` uses `diceSumDistribution(damagePerWound(ctx))` as the damage PMF, so the exact engine and the optimiser pick it up unchanged.
- **Weapon modal:** `Melta X…` comes after Rapid Fire X in the dropdown and the chip list, with the same pop-up and validation (`abilityValueError`, highest roll at most 12).
- **Attack row:** within half range the D chip reads `D D6+2` with the `+2` in the accent blue (`.chip-bonus`, like the A chip), tooltip "Damage: D6, plus 2 from Melta 2 (within half range)" (`damageBonus` in `ui/attackList.ts`); nothing is shown while X is invalid. `ActiveAbility.condition` is `halfRange`, so the ability is outlined while the condition is on.
- `npm test` 258/258 (new: `bonusDamage` / `damagePerWound` only within half range and with dice X, rolls and attacks unchanged; sim and exact damage 10·5/6·2/6 × 3.5 vs × 5.5 for Melta 2 on D6; sim vs exact for Melta D3 with carry-over; choices, labels, condition, `withoutAbility`, `sameAbilities`; storage round trip, missing field and number repair; share round trip; validation). `npm run build` is clean. Checked in Chrome: `d6+7` shows "Melta X: X can roll at most 12" and blocks OK, `d3 + 1` + Enter gives chip "Melta D3+1" without submitting; localStorage holds `melta: "D3+1"`; within half range the D chip reads `D 1+D3+1` with the tooltip and the ability is outlined, both gone when the toggle is off; 10 bolt rifles with Melta D3+1 into 10 MEQ (W2) give 3.32 kills and 6.65 damage (expected 3.33 / 6.67); no console errors.

## Profile rework (session 11, 2026-11-20)

> Units, as described in this section (`UnitProfile`, the Units tab, "+ Add unit", `units` in storage and exports), were removed in session 12; see "Units removed" below. Linked rows, the Attacks tab, the roster and ✎ Edit attack were replaced in session 13; see "UX rework" below. The v3 storage format described here is still read for migration.

**Goal:** a mostly read-only main page (pick an attack, see it, toggle conditions, edit the defender, simulate) and all creating / editing / deleting of attacks, weapons and units in a configuration drawer.

**Data model** (`types.ts`):

- `AttackProfile` / `UnitProfile` = `{ id, name, rows: AttackRow[] }`. Rows link to the library by `weaponId`, like the old live rows. **Editing a weapon profile changes every attack and unit that uses it** (intended: profiles no longer hold frozen copies).
- **Attack profiles are the attack.** There is no live workspace: the main page shows the active attack (`StoredState.activeAttackId`, always valid) and the editor changes it directly, so there is no Save / Save as / "(modified)" for attacks. Defender presets keep the workspace model (the form is the workspace, the ⋯ menu saves it).
- `RowSnapshot` only remains as the export / import format (and to read v2 presets during migration).

**Storage v3** (`state/storage.ts`, key `damage-calculator:v3`): `{ library, attacks, activeAttackId, units, defender, defenderPresets, activeDefenderPresetId, conditions, iterations }`.

- `loadState`: v3 → `normalise`; else v2 → `migrateV2`; else v1 → `migrateV1` (v1 → a v2-shaped state → the same conversion). Old keys are left in place.
- `normalise`: rows pointing at a missing weapon → `weaponId: null` (attacks and units); empty library → the default library (and the default attack if there are no attacks); no attacks → one attack "Attack" with 1× the first weapon; stale `activeAttackId` → the first attack; stale defender preset id → null.
- **v2 → v3** (`fromV2`): attack and unit presets become linked profiles (same ids and names) through `materialiseRows`, which reuses library entries with the same stats, adds a changed weapon once as `Name (preset)` and restores a deleted one under its own id. The live rows: when the active attack preset is clean (no unlinked row and `sameSnapshot`, the same check v2's "(modified)" used), that preset keeps the live rows as is and becomes active; otherwise a new attack `Preset (modified)` (cut to 40 characters) or `Current attack` (unique name) holds the live rows and becomes active, so no work is lost.
- Default: one "Bolt rifle", one attack "Bolt rifles" (10× Bolt rifle), 10 MEQ.

**Share** (`state/share.ts`, file format and `SHARE_VERSION` unchanged): `ShareState` = `{ library, attacks, units, defenderPresets }`. Export snapshots the linked rows (`snapshotRows(profile.rows, library)`), so files stay self-contained. The review compares `snapshotRows(saved.rows, library)` with the file, so a saved attack whose weapon changed in the library is now a "Name in use" conflict rather than "Already saved". Apply imports weapons first and records where each file weapon ended up (added, renamed, replaced or already saved); attack and unit rows are remapped to those ids and linked with `materialiseRows`, so they link to the renamed `Bolt rifle (2)` instead of creating `Bolt rifle (Gunline)`. A row whose weapon wasn't imported brings its copy into the library.

**UI:**

- **App bar:** sticky, title + subtitle (hidden ≤ 600px) and ☰ ("Open configuration"). Import / Export moved to the Settings tab.
- **Attacker panel:** attack select (shared with the editor), **✎ Edit attack** (opens the drawer on Attacks), conditions, the read-only roster (`ui/attackRoster.ts`: `1  10× Bolt rifle  [A 2] [BS 3+] …` with abilities and bonuses from `ui/statChips.ts`; invalid rows get a red edge and their error; an empty attack says to add weapons with ✎), and the optimiser hint.
- **Defender panel:** preset select + ⋯ menu (Save, Save as…, Delete; disabled items show why), then the form. Behaviour (dirty, discard prompt, overwrite prompt) unchanged.
- **Run bar:** Simulate + status only (iterations moved to Settings).
- **Drawer** (`ui/drawer.ts`): one persistent `<dialog class="drawer">`, `showModal()` (focus trap, Esc, backdrop click; weapon / confirm dialogs stack on top), slides in from the right with `@starting-style` + `transition-behavior: allow-discrete` (off under `prefers-reduced-motion`), `width: min(560px, 100%)`, full height, only the panel area scrolls. ARIA tablist with roving tabindex, arrow keys / Home / End switch tabs; `open(tab?)` reopens the last tab; focus returns to the opener on close. Tabs keep their state while closed (a half-edited unit stays open).
  - **Attacks** (`ui/attackEditor.ts`): attack select + ⋯ (New attack… starts empty, Rename…, Duplicate as `Name (2)` with new row ids, Delete with confirm, blocked for the last attack); `AttackList` with `minRows: 0`; + Add weapon; + Add unit (appends `copyRows` of the unit); Optimise order with badge and status.
  - **Weapons** (`ui/weaponsPanel.ts`): the old library modal as a panel. Usage counts rows across attacks and units (`weaponUsage(id, [...attacks, ...units])`); a used weapon shows "Used by Gunline, Devastators (unit)" and can't be deleted.
  - **Units** (`ui/unitsPanel.ts`): list + editor on a draft copy of the rows (Back discards); "Copy rows from current attack" copies the active attack with new row ids; units save linked rows.
  - **Settings:** Iterations, Import… / Export….
- **⋯ menus** (`ui/menu.ts`): `aria-haspopup="menu"`, ↓ / ↑ on the button open it on the first / last item, arrow keys / Home / End move, Esc closes only the menu (stops propagation so the drawer stays open) and refocuses ⋯, Tab and a click outside close it. Disabled items keep focus but use `aria-disabled` and a reason tooltip.
- **Rows:** `.weapon-list` and `.roster` are inline-size containers; the editor rows have three layouts by container width (> 680px one line; ≤ 680px actions beside the weapon and chips on their own line, as in the drawer; ≤ 440px models + weapon, chips, actions), the roster wraps chips below the name at ≤ 520px.

**Verification:** `npm test` 277/277 (storage rewritten for v3: round trip, repair, v2 → v3 with clean / modified / no active preset, unlinked live row, name clash and 40-character cut, units, library dedupe with a changed and a deleted weapon, v1 → v3, old keys kept; share: linked export snapshots, import links to imported / saved weapons and to renamed copies, replace keeps the unit object; presets: `weaponUsage` across profiles, `copyRows`, `rowsSummary` / `snapshotsSummary`, `uniqueName`, `byName`). Engine tests unchanged. `npm run build` is clean. Checked in Chrome: a v2 save with a modified active preset migrates to "Gunline (modified)" (active, live rows) next to "Gunline" and "Bolters", the unit linked, no duplicate weapons, the v2 key kept; ✎ opens the drawer on Attacks; Optimise order reorders and the main roster and hint follow; Rename / Duplicate / Delete (confirm stacks over the drawer) keep both selects in sync; + Add unit and + Add weapon; editing Bolt rifle in the Weapons tab updates the roster; delete blocked with "Used by …"; a unit created from the current attack; iterations 50 blocks Simulate with a Settings hint; Export lists attacks with linked summaries; importing a file with a conflicting Bolt rifle links the new attack to "Bolt rifle (2)" and restores the Meltagun; defender ⋯ Save as / "(modified)" / Save / Delete; Esc closes the menu, then the drawer (focus back on ✎ Edit attack); backdrop click closes it; tab arrow keys; 10 bolt rifles into 10 MEQ give 20.00 / 13.35 / 6.67 / 3.32 (expected 20 / 13.33 / 6.67 / 3.33); dark and light; 390px in a same-origin iframe (the window can't be resized) with no sideways scroll on the page or in the full-width drawer; no console errors.

## Units removed (session 12, 2026-11-20)

**Why:** after the profile rework an attack and a unit had the same shape (`{ id, name, rows }`) and only differed in that a unit's rows could be appended to an attack with "+ Add unit". Two names for one thing confused more than it helped, so there is now one concept: **an attack is the complete attack of a unit**. To build a variant, Duplicate an attack and edit it.

**Removed:** `UnitProfile`, `ui/unitsPanel.ts` and the Units drawer tab (tabs are now Attacks · Weapons · Settings), "+ Add unit" in the Attacks tab, `AttackList`'s compact mode, `StoredState.units`, `units` in `ShareKind` / `ShareData` / `ShareState` / the export picker, and the CSS that only served them (`.unit-editor*`, `.weapon-row--compact`, `.button-select`). `weaponUsage` and "Used by …" in the Weapons tab count attacks only. `copyRows` stays (Duplicate uses it).

**Existing unit data is dropped silently** (user decision): v2 `unitPresets` are not migrated (so a weapon that only lived in a unit preset is not restored into the library), a v3 save's `units` key is ignored on load and disappears on the next save, and `units` in an export file are ignored on import (a file with only units says "This export contains nothing to import."). The storage key stays `damage-calculator:v3` and `SHARE_VERSION` stays 1: v3 with units was never released, and a file without `units` still parses in older builds.

**Verification:** `npm test` 281/281 (unit cases removed or moved to attacks; new: a v3 save with `units` loads without them and saves without them, v2 unit presets are dropped without restoring their weapon, an export has no `units` key, a units-only file has nothing to import, a file with attacks + units imports only the attacks). `npm run build` is clean. Checked in Chrome: a v3 save with a `units` key loads and the key is gone from localStorage; the drawer shows Attacks · Weapons · Settings with arrow / End keys wrapping; the Attacks tab has + Add weapon and Optimise order only; Duplicate and Delete work; Weapons shows "Used by Bolt rifles, Gunline" and blocks delete; Export lists Attacks and Weapon profiles only; importing a file with attacks + units imports the attack and its weapon ("Imported 2 items") and ignores the unit; 10 bolt rifles into 10 MEQ give 20.00 / 13.34 / 6.68 / 3.34 (expected 20 / 13.33 / 6.67 / 3.33); no console errors.

## UX rework (session 13, 2026-11-21)

**Why:** after using the app, the user reversed parts of session 11. Weapons could only be added in the drawer, and only to a selected attack; "attack" was a misleading name; and linked rows meant editing a weapon silently changed every saved attack. Now the main page is a working area where weapons are added straight away, with or without a profile, and **a row is a frozen copy of the weapon**.

**Data model** (`types.ts`): `ProfileRow` = `{ id, models, weapon: WeaponStats }` (no `weaponId`); `Profile` = `{ id, name, rows }`. `AttackConditions` keeps its name (it describes the situation, not the profile). The v3 linked types moved to `state/legacy.ts` as `LinkedRow` / `LinkedAttack`, together with `findWeapon`, `snapshotRows` and `materialiseRows`, which only the v2 → v3 step still uses.

**Storage v4** (`damage-calculator:v4`): `{ library, rows (the working area), profiles, activeProfileId: string | null, defender, defenderPresets, activeDefenderPresetId, conditions, iterations }`.

- `loadState`: v4 → `normalise`; else v3 → `normaliseV3` → `fromV3`; else v2 → `migrateV2` → `fromV3`; else v1 → `migrateV1` → `fromV3`. `migrateV2` / `migrateV1` are unchanged and return a `V3State`. Old keys are left in place.
- `fromV3`: each attack becomes a profile with the same id and name, each row copies `pickStats` of its library weapon (rows whose weapon is missing are dropped); the working area gets `copyRows` of the active attack, which stays active.
- `normalise`: rows go through `toWeaponStats` (missing abilities filled in, a row without a usable weapon copy dropped, a missing row id generated); profiles may be empty; a stale `activeProfileId` becomes null. An empty library is kept (nothing depends on it); only a brand-new state gets the defaults: library [Bolt rifle], profile "Bolt rifles" (10× a copy), the working area a copy of it, active.

**Pure helpers** (`state/presets.ts`): `resolveRows(rows, conditions)` builds the engine input from the copies (no library); `copyRows` gives new row ids and deep weapon copies (also takes export rows without ids); `sameRows(a, b)` = same length, order, models and `sameCombatStats` (names and ids ignored) drives Save enablement, the discard prompt and the import review; `rowsSummary(rows)` reads the copies. `materialiseRows`, `weaponUsage`, `snapshotRows`, `sameSnapshot` and `snapshotsSummary` are gone from presets.

**Share** (`SHARE_VERSION` 2): profile rows are written as `{ models, weapon }`. The parser still reads version 1 files: `attacks` rows with a `weaponId` are taken as copies and the id is ignored; the file key `attacks` stays so one parser reads both. `ShareState` = `{ library, profiles, defenderPresets }`. Importing a profile copies its rows as they are and adds nothing to the library; weapons import into the library on their own as before (a replaced weapon keeps its library id). The review compares with `sameRows` on the saved profile's own copies, so a library edit no longer turns a saved profile into a conflict. Labels: "Profiles", "Profiles include their own copy of every weapon".

**Validation:** `validateRow(row)` = models 1–50 plus every `validateWeaponStats(row.weapon)` error joined into one `weapon` line, which catches invalid imported or stored copies. The import review shows `Weapon name: error`, an empty profile "Has no weapons".

**UI:**

- **Profile bar** (`PresetBar`, shared with the defender): new options `noun` ("profile" in the dialogs), `deleteNote`, `markModified: false` (no "(modified)" in the select; Save still says "No changes to save"), `onRename` (adds Rename…, unique name via `uniqueName`), `hasUnsavedWork` and `saveBlockedReason` (replaces `canSave`; "Add weapons first" / "Fix the highlighted rows first"). Load copies the profile's rows into the working area; Save writes a copy of the working area into the profile; Save as… creates a profile or overwrites one with the same name after a confirm; Rename…; Delete removes the profile and leaves the rows (no "last one" block); "— Unsaved —" detaches without discarding. Switching profiles with changes asks "Discard changes to X?". **Addition beyond the plan:** loading a profile while detached also asks "Discard the unsaved changes and load X?" when the rows match no saved profile, so detached work isn't lost silently.
- **Rows** (`ui/profileRows.ts`, `ProfileRows`): Models input (`aria-label` "Models firing X"), the weapon name as text (`.row-name`), `statChips` + abilities, ↑ ↓ ✕. No weapon select, no ✎. An invalid copy gets a red left edge and its error line. Removing the last row moves focus to Add weapon… (or the profile select when that is disabled). The same container-query layouts as before.
- **Add weapon…:** a select listing `sortedLibrary`; picking one appends a row (1 model, `pickStats` copy), resets the select and focuses the new Models field. Disabled with the hint "Create weapon profiles under ☰ → Weapons." while the library is empty.
- **Optimise order:** button, badge and status under the rows on the main page (same logic in `main.ts`); `#optimise-hint` is gone.
- **Drawer:** Weapons · Settings (`DrawerTab` = `'weapons' | 'settings'`); ☰ opens on the last shown tab, Weapons at first. Weapons tab: delete is never blocked, hint "Rows and saved profiles keep their own copy, so editing a profile here doesn't change them."
- **Removed:** `ui/attackEditor.ts`, `ui/attackRoster.ts`, `ui/attackList.ts`, `#edit-attack`, the Attacks tab, and their CSS (`.roster*`, `.optimise-hint`, `.link-button`, `.attack-editor`, `.editor-actions`, `.manage-usage`, `.row-actions-sep`, `.button.small`).
- **Texts:** Simulate blocked: "Add weapons to simulate." / "Fix the highlighted rows to simulate."; empty results: "Pick a profile or add weapons, then press Simulate."

**Verification:** `npm test` 284/284 (storage rewritten for v4: round trip under the v4 key only, empty library / profiles kept, row repair and drops, stale ids; v3 → v4 copies, dropped missing weapon, active id and working area, empty v3 fallback, v3 key kept; v2 / v1 → v4 through v3 with the modified / unsaved / name-clash cases and the materialised copies; presets: `resolveRows` from copies, `copyRows` deep copy, `sameRows`, a library edit or delete not changing a profile or the working area; new `state/legacy.test.ts` keeps the `materialiseRows` cases; share: v2 export rows have no ids, a v1 file imports as copies without touching the library, conflicts use `sameRows` on the saved copies; validation: `validateRow`). Engine tests unchanged. `npm run build` is clean. Checked in Chrome: a v3 save migrates (profiles appear, the active one is loaded, the row with a deleted weapon dropped, the v3 key kept); with "— Unsaved —" Add weapon… appends a row and focuses its Models field; Models, ↑ ↓ ✕ work; Save as… creates a profile, a models change enables Save, switching asks to discard (Cancel keeps the rows), Save, Rename… and Delete work, a detached unsaved working area asks before loading; editing Bolt rifle (S8) in the Weapons tab leaves the rows and profiles at S4, deleting it is allowed and the rows keep it; Optimise order on a 3-weapon list shows "+0.07 models" and reorders; an export holds version 2 rows `{ models, weapon }` and re-importing it shows everything "Already saved"; a version 1 file imports as a profile with copies; empty library disables Add weapon… with the hint; no rows → "Add weapons to simulate."; 10 bolt rifles into 10 MEQ give 20.00 / 13.33 / 6.65 / 3.32 (expected 20 / 13.33 / 6.67 / 3.33); dark and light; 390px in a same-origin iframe with no sideways scroll; no console errors.

## Army configuration (session 14, 2026-11-26, branch `armyconfig`)

**Why:** the user wants to move to a unit-centric model that will eventually replace the Weapons tab (global library) and the defender form. The user defines **armies** (free-text names: Space Marines, Chaos Daemons, …; no data source) and **units**, which can belong to an army (for filtering later). A unit has a name, T, Sv, Inv, W, keywords and **its own weapons**. Weapons are never shared: two units can both have a "Bolt rifle", each with its own profile. This first step is **configuration only** (user decision): nothing on the main page, the simulation, profiles or export/import uses armies or units yet.

**Data model** (`types.ts`): `Army` = `{ id, name }`; `UnitStats` = `Omit<DefenderProfile, 'models'>` (no model count: it isn't part of the stat line and is chosen when a unit is used); `Unit` = `UnitStats` + `{ id, name, armyId: string | null, weapons: StoredWeapon[] }`.

**Rules:** army names unique (case-insensitive); unit names unique **within an army** (the same name may exist in two armies); weapon names unique **within a unit**. Names at most 40 characters. Unit stats use the defender limits (T 1–20, Sv 2–7, Inv 2–6 or none, W 1–40) without the models × wounds rule.

**Storage:** `StoredState.armies` / `units`, still under `damage-calculator:v4` (older v4 saves, the v3 / v2 / v1 migrations and the defaults give `[]`). `toArmy` drops entries without an id or name; `toUnit` reuses the number checks of `toDefender` and `toKeywords`, drops malformed weapons, generates missing unit and weapon ids, and moves a unit whose army is gone to "No army". The old session-11/12 row-based units are unrelated and are still never migrated.

**UI (`ui/unitsPanel.ts`, first drawer tab "Units"):**

- List view: `Army` filter (All armies, the armies by name, No army) with a ⋯ menu: **New army…** and **Rename…** use `promptName` with a `validate` callback (a duplicate name shows an error and blocks confirming); **Delete** confirms and moves the army's units to "No army". Rename / Delete are disabled with "Select an army first" for All armies / No army. Units are listed grouped by army (armies by name, "No army" last), sorted by name, with `unitSummary` (`T4 · Sv 3+ · W2 · Infantry · 2 weapons`), ✎ and ✕ (confirm).
- Editor view (replaces the list in the same panel): works on a `copyUnit` draft. `‹ Back` asks "Discard …?" when `sameUnit` says the draft changed; Create / Save is disabled while `validateUnit` fails, with the errors under the keywords. Fields: Name, Army, T, Sv, Inv, W, keyword toggles. Weapons section: the unit's weapons (`statsSummary`), ✎ / ✕ (confirm) and `+ New weapon`, all through `openWeaponModal(…, { takenNames })`, which shows "This unit already has a weapon with this name" and blocks saving. A saved unit that moved out of the filtered army switches the filter to All armies so it stays visible. Like the other tabs, a half-edited unit stays open while the drawer is closed.
- Shared with the defender form: `ui/statFields.ts` (save / invuln options and `keywordToggles`). `statLine` in `state/presets.ts` is shared by `defenderSummary` and `unitSummary`.

**Deferred:** using units on the main page (attacker rows from a unit's weapons, the defender from a unit's stat line), replacing the Weapons tab and the defender form, and armies / units in export / import.

**Verification:** `npm test` 302/302 (new `state/units.test.ts`: `newUnit`, `copyUnit` deep copy, `sameUnit`, `isNameTaken`, `unitSummary` and an unchanged `defenderSummary`, `groupUnits` ordering / filters / empty groups, `deleteArmy`; storage: defaults and an older v4 save without armies / units, round trip with weapons and abilities, repair of stale army ids, missing ids, unknown keywords and broken weapons; validation: `validateUnit` names, limits and weapon errors; two old "no `units` property" assertions now check that `units` is `[]`). `npm run build` is clean. Checked in Chrome: the drawer opens on Units; New army… creates "Space Marines" and blocks a second "space marines " with an error; "Chaos Daemons" created; + New unit while Space Marines is filtered preselects that army; Intercessors (T4 Sv3+ W2, Infantry) with a Bolt rifle and a Bolt pistol, a second "BOLT RIFLE" blocked; the list shows `T4 · Sv 3+ · W2 · Infantry · 2 weapons`; localStorage holds the armies and the unit with its own weapons while the library still only has its Bolt rifle; deleting Space Marines (confirm "Its unit stays, without an army.") moves Intercessors to No army, which survives a reload; editing the name and pressing Back asks "Discard the changes to "Intercessors"?", and discarding keeps the old name and focuses its ✎; no console errors. Not checked in the browser: light mode and the 390px layout.

## Housekeeping

- The repo is on GitHub (`origin`, branch `master`). The remote also has an unrelated `main` branch from when the repo was created; `master` is the working branch.
- `.gitattributes` keeps text files on LF line endings on every OS. `.gitignore` covers `node_modules`, `dist`, `*.local`, `*.log` and `*.stackdump` (Git Bash crash dumps).
- **GitHub Pages:** `.github/workflows/deploy.yml` runs `npm ci`, `npm test` and `npm run build` on every push to `master` (or by hand) and deploys `dist` with `actions/deploy-pages`. The repo's Pages source must be set to "GitHub Actions"; "Deploy from a branch" serves the raw `index.html`, whose `/src/main.ts` the browser can't run. `vite.config.ts` sets `base: './'` so the built asset URLs are relative and work under `https://szuidam.github.io/40k-damage-calculator/`.

## Ideas for next steps

- More abilities through the `AttackContext` step functions: hit modifiers (and more wound modifiers, which already go through `woundModifier`), rerolls (1s or all, hit or wound), Torrent, Feel No Pain, damage reduction, cover.
- Show the exact expected values next to the simulated ones, or offer an "exact only" mode.
- A Web Worker for large iteration counts.
- A share link (export encoded in the URL hash) next to Copy / Download.
- Undo for row edits on the main page.
