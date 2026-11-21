/**
 * Linked rows of the v3 storage format (sessions 11–12) and the helpers that convert v2 data
 * into them. Only the storage migration uses this: v2 → v3 → v4.
 */
import type { RowSnapshot, StoredWeapon } from '../types';
import { uid } from './ids';
import { pickStats, sameCombatStats } from './presets';

/** A v3 attack row: `models` models firing the library weapon `weaponId`. */
export interface LinkedRow {
  id: string;
  models: number;
  weaponId: string | null;
}

/** A v3 attack: rows linked to the library by `weaponId`. */
export interface LinkedAttack {
  id: string;
  name: string;
  rows: LinkedRow[];
}

export function findWeapon(library: StoredWeapon[], weaponId: string | null): StoredWeapon | undefined {
  return weaponId === null ? undefined : library.find((w) => w.id === weaponId);
}

/** Copy linked rows into self-contained snapshots. Rows without a library weapon are skipped. */
export function snapshotRows(rows: LinkedRow[], library: StoredWeapon[]): RowSnapshot[] {
  const out: RowSnapshot[] = [];
  for (const row of rows) {
    const weapon = findWeapon(library, row.weaponId);
    if (weapon) out.push({ models: row.models, weaponId: weapon.id, weapon: pickStats(weapon) });
  }
  return out;
}

/**
 * Turn snapshot rows back into rows linked to the library (v2 → v3 migration). Per snapshot:
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
): { rows: LinkedRow[]; library: StoredWeapon[] } {
  const lib = [...library];
  const rows: LinkedRow[] = snapshots.map((snap) => {
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
