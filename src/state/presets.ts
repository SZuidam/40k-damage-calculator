import { KEYWORD_NAMES, copyAbilities, type AttackConditions, type AttackRow, type DefenderProfile, type RowSnapshot, type StoredWeapon, type WeaponProfile, type WeaponStats } from '../types';
import { MAX_WEAPON_NAME } from '../ui/validation';
import { abilitiesSummary, sameAbilities } from './abilities';
import { uid } from './ids';

/** Copy only the WeaponStats fields (drops `id` and anything else). The abilities are copied too. */
export function pickStats(w: WeaponStats): WeaponStats {
  return { name: w.name, attacks: w.attacks, skill: w.skill, strength: w.strength, ap: w.ap, damage: w.damage, abilities: copyAbilities(w.abilities) };
}

/** A copy of the defender that shares no arrays with `d`. */
export function copyDefender(d: DefenderProfile): DefenderProfile {
  return { ...d, keywords: [...d.keywords] };
}

/**
 * Whether two weapons fire the same: every stat and ability except the name. A renamed library
 * profile is still the same weapon, so it is not duplicated when rows are linked to the
 * library again (import, storage migration).
 */
export function sameCombatStats(a: WeaponStats, b: WeaponStats): boolean {
  return (
    a.attacks.trim().toUpperCase() === b.attacks.trim().toUpperCase() &&
    a.skill === b.skill &&
    a.strength === b.strength &&
    a.ap === b.ap &&
    a.damage.trim().toUpperCase() === b.damage.trim().toUpperCase() &&
    sameAbilities(a.abilities, b.abilities)
  );
}

export function findWeapon(library: StoredWeapon[], weaponId: string | null): StoredWeapon | undefined {
  return weaponId === null ? undefined : library.find((w) => w.id === weaponId);
}

/**
 * Engine input for attack rows. The row id becomes the weapon id (two rows may share
 * a library weapon) and the library name becomes the weapon name. Rows without a
 * library weapon are skipped; the UI only runs the engine once every row is valid.
 * Every weapon gets its own copy of the attack conditions.
 */
export function resolveRows(rows: AttackRow[], library: StoredWeapon[], conditions: AttackConditions): WeaponProfile[] {
  const out: WeaponProfile[] = [];
  for (const row of rows) {
    const weapon = findWeapon(library, row.weaponId);
    if (weapon) out.push({ ...pickStats(weapon), id: row.id, models: row.models, conditions: { ...conditions } });
  }
  return out;
}

/** Copy linked rows into self-contained snapshots (export). Rows without a library weapon are skipped. */
export function snapshotRows(rows: AttackRow[], library: StoredWeapon[]): RowSnapshot[] {
  const out: RowSnapshot[] = [];
  for (const row of rows) {
    const weapon = findWeapon(library, row.weaponId);
    if (weapon) out.push({ models: row.models, weaponId: weapon.id, weapon: pickStats(weapon) });
  }
  return out;
}

/** Whether two row lists describe the same attack: same models and weapon stats, in the same order. */
export function sameSnapshot(a: RowSnapshot[], b: RowSnapshot[]): boolean {
  return a.length === b.length && a.every((row, i) => row.models === b[i].models && sameCombatStats(row.weapon, b[i].weapon));
}

export function sameDefender(a: DefenderProfile, b: DefenderProfile): boolean {
  return (
    a.models === b.models &&
    a.toughness === b.toughness &&
    a.save === b.save &&
    (a.invuln ?? null) === (b.invuln ?? null) &&
    a.wounds === b.wounds &&
    a.keywords.length === b.keywords.length &&
    a.keywords.every((k) => b.keywords.includes(k))
  );
}

/**
 * Turn snapshot rows back into rows linked to the library (import, storage migration). Per snapshot:
 * 1. the library entry with the same id and the same stats;
 * 2. otherwise an entry with the same stats named like the snapshot weapon, or like a
 *    copy made by an earlier load (`Name (preset)`);
 * 3. otherwise the snapshot weapon is added to the library, under its original id when
 *    that id is free, else under a new id named `Name (preset)`.
 * Linking the same snapshots twice therefore never duplicates library entries.
 * Returns new arrays; the inputs are not changed.
 */
export function materialiseRows(
  snapshots: RowSnapshot[],
  library: StoredWeapon[],
  presetName: string,
): { rows: AttackRow[]; library: StoredWeapon[] } {
  const lib = [...library];
  const rows: AttackRow[] = snapshots.map((snap) => {
    const copyName = `${snap.weapon.name} (${presetName})`;
    const byId = lib.find((w) => w.id === snap.weaponId);
    let match: StoredWeapon | undefined = byId && sameCombatStats(byId, snap.weapon) ? byId : undefined;
    match ??= lib.find((w) => sameCombatStats(w, snap.weapon) && (w.name === snap.weapon.name || isCopyName(w.name, copyName)));
    if (!match) {
      match = byId
        ? { ...pickStats(snap.weapon), id: uid('weapon'), name: uniqueWeaponName(lib, copyName) }
        : { ...pickStats(snap.weapon), id: snap.weaponId };
      lib.push(match);
    }
    return { id: uid('row'), models: snap.models, weaponId: match.id };
  });
  return { rows, library: lib };
}

/** `Name (preset)` or a numbered `Name (preset) 2` from uniqueWeaponName(). */
function isCopyName(name: string, copyName: string): boolean {
  return name === copyName || (name.startsWith(`${copyName} `) && /^\d+$/.test(name.slice(copyName.length + 1)));
}

function uniqueWeaponName(library: StoredWeapon[], name: string): string {
  const taken = new Set(library.map((w) => w.name));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n += 1) if (!taken.has(`${name} ${n}`)) return `${name} ${n}`;
}

/**
 * `name`, or `Name (2)`, `Name (3)`, … when it is taken (case-insensitive), cut so the
 * result stays within the 40-character name limit.
 */
export function uniqueName(taken: string[], name: string): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  const base = name.slice(0, MAX_WEAPON_NAME).trimEnd();
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${base.slice(0, MAX_WEAPON_NAME - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Number of rows, across all attacks, that use a library weapon. */
export function weaponUsage(weaponId: string, profiles: readonly { rows: AttackRow[] }[]): number {
  return profiles.reduce((sum, p) => sum + p.rows.filter((r) => r.weaponId === weaponId).length, 0);
}

/** Copies of `rows` with new row ids, linked to the same weapons (duplicate an attack). */
export function copyRows(rows: AttackRow[]): AttackRow[] {
  return rows.map((r) => ({ id: uid('row'), models: r.models, weaponId: r.weaponId }));
}

/** Sort by name for selects and lists (case-insensitive, numbers in numeric order). */
export function byName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

/** Library sorted by name, for selects and lists. */
export function sortedLibrary(library: StoredWeapon[]): StoredWeapon[] {
  return byName(library);
}

/** Short stats line: "A 2 · BS 3+ · S 4 · AP -1 · D 1", plus " · Lethal Hits, …" when it has abilities. */
export function statsSummary(w: WeaponStats): string {
  const abilities = abilitiesSummary(w.abilities);
  return `A ${w.attacks} · BS ${w.skill}+ · S ${w.strength} · AP ${w.ap} · D ${w.damage}${abilities ? ` · ${abilities}` : ''}`;
}

/** "10× Bolt rifle, 1× Plasma gun" for linked rows; a row without a library weapon reads "1× (no weapon)". */
export function rowsSummary(rows: AttackRow[], library: StoredWeapon[]): string {
  return rows.map((r) => `${r.models}× ${findWeapon(library, r.weaponId)?.name ?? '(no weapon)'}`).join(', ');
}

/** "10× Bolt rifle, 1× Plasma gun" for the snapshot rows of an import. */
export function snapshotsSummary(rows: RowSnapshot[]): string {
  return rows.map((r) => `${r.models}× ${r.weapon.name}`).join(', ');
}

/** "10 models · T4 · Sv 3+ · Inv 4+ · W2", plus " · Vehicle, Monster" when it has keywords. */
export function defenderSummary(d: DefenderProfile): string {
  const save = d.save >= 7 ? 'Sv –' : `Sv ${d.save}+`;
  const invuln = d.invuln === null ? '' : ` · Inv ${d.invuln}+`;
  const keywords = d.keywords.length === 0 ? '' : ` · ${d.keywords.map((k) => KEYWORD_NAMES[k]).join(', ')}`;
  return `${d.models} model${d.models === 1 ? '' : 's'} · T${d.toughness} · ${save}${invuln} · W${d.wounds}${keywords}`;
}
