import type { AttackRow, DefenderProfile, RowSnapshot, StoredWeapon, WeaponProfile, WeaponStats } from '../types';
import { uid } from './ids';

/** Copy only the WeaponStats fields (drops `id` and anything else). */
export function pickStats(w: WeaponStats): WeaponStats {
  return { name: w.name, attacks: w.attacks, skill: w.skill, strength: w.strength, ap: w.ap, damage: w.damage };
}

/**
 * Whether two weapons fire the same: every stat except the name. A renamed library
 * profile is still the same weapon, so it neither makes a preset dirty nor duplicates
 * itself when a preset is loaded.
 */
export function sameCombatStats(a: WeaponStats, b: WeaponStats): boolean {
  return (
    a.attacks.trim().toUpperCase() === b.attacks.trim().toUpperCase() &&
    a.skill === b.skill &&
    a.strength === b.strength &&
    a.ap === b.ap &&
    a.damage.trim().toUpperCase() === b.damage.trim().toUpperCase()
  );
}

export function findWeapon(library: StoredWeapon[], weaponId: string | null): StoredWeapon | undefined {
  return weaponId === null ? undefined : library.find((w) => w.id === weaponId);
}

/**
 * Engine input for the live rows. The row id becomes the weapon id (two rows may share
 * a library weapon) and the library name becomes the weapon name. Rows without a
 * library weapon are skipped; the UI only runs the engine once every row is valid.
 */
export function resolveRows(rows: AttackRow[], library: StoredWeapon[]): WeaponProfile[] {
  const out: WeaponProfile[] = [];
  for (const row of rows) {
    const weapon = findWeapon(library, row.weaponId);
    if (weapon) out.push({ ...pickStats(weapon), id: row.id, models: row.models });
  }
  return out;
}

/** Copy the live rows into preset rows. Rows without a library weapon are skipped. */
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
    a.wounds === b.wounds
  );
}

/**
 * Turn preset rows back into live rows linked to the library. Per snapshot:
 * 1. the library entry with the same id and the same stats;
 * 2. otherwise an entry with the same stats named like the snapshot weapon, or like a
 *    copy made by an earlier load (`Name (preset)`);
 * 3. otherwise the snapshot weapon is added to the library, under its original id when
 *    that id is free, else under a new id named `Name (preset)`.
 * Loading the same preset twice therefore never duplicates library entries.
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
        ? { ...pickStats(snap.weapon), id: uid('weapon'), name: uniqueName(lib, copyName) }
        : { ...pickStats(snap.weapon), id: snap.weaponId };
      lib.push(match);
    }
    return { id: uid('row'), models: snap.models, weaponId: match.id };
  });
  return { rows, library: lib };
}

/** `Name (preset)` or a numbered `Name (preset) 2` from uniqueName(). */
function isCopyName(name: string, copyName: string): boolean {
  return name === copyName || (name.startsWith(`${copyName} `) && /^\d+$/.test(name.slice(copyName.length + 1)));
}

function uniqueName(library: StoredWeapon[], name: string): string {
  const taken = new Set(library.map((w) => w.name));
  if (!taken.has(name)) return name;
  for (let n = 2; ; n += 1) if (!taken.has(`${name} ${n}`)) return `${name} ${n}`;
}

/** Number of live rows that use a library weapon. */
export function weaponUsage(weaponId: string, rows: AttackRow[]): number {
  return rows.filter((r) => r.weaponId === weaponId).length;
}

/** Library sorted by name, for selects and lists. */
export function sortedLibrary(library: StoredWeapon[]): StoredWeapon[] {
  return [...library].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

/** Short stats line: "A 2 · BS 3+ · S 4 · AP -1 · D 1". */
export function statsSummary(w: WeaponStats): string {
  return `A ${w.attacks} · BS ${w.skill}+ · S ${w.strength} · AP ${w.ap} · D ${w.damage}`;
}

/** "10× Bolt rifle, 1× Plasma gun". */
export function rowsSummary(rows: RowSnapshot[]): string {
  return rows.map((r) => `${r.models}× ${r.weapon.name}`).join(', ');
}
