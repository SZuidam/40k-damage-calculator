import { describe, expect, it } from 'vitest';
import { noAbilities, type AttackPreset, type AttackRow, type StoredWeapon } from '../types';
import {
  materialiseRows,
  resolveRows,
  sameDefender,
  sameSnapshot,
  snapshotRows,
  weaponUsage,
} from './presets';

const none = noAbilities();
const boltRifle = (): StoredWeapon => ({ id: 'w-bolt', name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() });
const lascannon = (): StoredWeapon => ({ id: 'w-las', name: 'Lascannon', attacks: '1', skill: 3, strength: 12, ap: -3, damage: 'D6+1', abilities: noAbilities() });

function setup() {
  const library = [boltRifle(), lascannon()];
  const rows: AttackRow[] = [
    { id: 'r1', models: 10, weaponId: 'w-bolt' },
    { id: 'r2', models: 1, weaponId: 'w-las' },
    { id: 'r3', models: 5, weaponId: 'w-bolt' },
  ];
  return { library, rows };
}

describe('resolveRows', () => {
  it('turns rows into engine profiles with the row id and the library name', () => {
    const { library, rows } = setup();
    expect(resolveRows(rows, library)).toEqual([
      { id: 'r1', name: 'Bolt rifle', models: 10, attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: none },
      { id: 'r2', name: 'Lascannon', models: 1, attacks: '1', skill: 3, strength: 12, ap: -3, damage: 'D6+1', abilities: none },
      { id: 'r3', name: 'Bolt rifle', models: 5, attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: none },
    ]);
  });

  it('skips rows without a weapon or with a missing weapon', () => {
    const { library } = setup();
    const rows: AttackRow[] = [
      { id: 'a', models: 1, weaponId: null },
      { id: 'b', models: 1, weaponId: 'gone' },
      { id: 'c', models: 2, weaponId: 'w-las' },
    ];
    expect(resolveRows(rows, library).map((w) => w.id)).toEqual(['c']);
  });
});

describe('snapshots', () => {
  it('round trips: a snapshot materialises back into the same attack and library', () => {
    const { library, rows } = setup();
    const snap = snapshotRows(rows, library);
    expect(snap[0]).toEqual({ models: 10, weaponId: 'w-bolt', weapon: { name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: none } });
    expect(snap[0].weapon).not.toHaveProperty('id');

    const loaded = materialiseRows(snap, library, 'Intercessors');
    expect(loaded.library).toEqual(library);
    expect(loaded.rows.map((r) => [r.models, r.weaponId])).toEqual([
      [10, 'w-bolt'],
      [1, 'w-las'],
      [5, 'w-bolt'],
    ]);
    expect(sameSnapshot(snapshotRows(loaded.rows, loaded.library), snap)).toBe(true);
  });

  it('copies weapons, so editing the library does not change a saved preset but makes it dirty', () => {
    const { library, rows } = setup();
    const preset: AttackPreset = { id: 'p', name: 'Intercessors', rows: snapshotRows(rows, library) };
    expect(sameSnapshot(snapshotRows(rows, library), preset.rows)).toBe(true);

    library[0].strength = 5;
    expect(preset.rows[0].weapon.strength).toBe(4);
    expect(sameSnapshot(snapshotRows(rows, library), preset.rows)).toBe(false);
  });

  it('detects changed models, order and row count', () => {
    const { library, rows } = setup();
    const saved = snapshotRows(rows, library);
    expect(sameSnapshot(snapshotRows([{ ...rows[0], models: 9 }, rows[1], rows[2]], library), saved)).toBe(false);
    expect(sameSnapshot(snapshotRows([rows[1], rows[0], rows[2]], library), saved)).toBe(false);
    expect(sameSnapshot(snapshotRows(rows.slice(0, 2), library), saved)).toBe(false);
  });

  it('treats an ability change as a change, and keeps the preset copy of the abilities', () => {
    const { library, rows } = setup();
    const saved = snapshotRows(rows, library);
    library[0].abilities.lethalHits = true;
    expect(saved[0].weapon.abilities.lethalHits).toBe(false);
    expect(sameSnapshot(snapshotRows(rows, library), saved)).toBe(false);
    library[0].abilities = { ...none, sustainedHits: '1' };
    const sustained = snapshotRows(rows, library);
    expect(sameSnapshot(sustained, saved)).toBe(false);
    library[0].abilities = { ...none, sustainedHits: ' 1 ' };
    expect(sameSnapshot(snapshotRows(rows, library), sustained)).toBe(true);
  });

  it('ignores a rename of the library profile', () => {
    const { library, rows } = setup();
    const saved = snapshotRows(rows, library);
    library[0].name = 'Bolt rifle (Mk II)';
    expect(sameSnapshot(snapshotRows(rows, library), saved)).toBe(true);
  });

  it('compares defenders field by field', () => {
    const d = { models: 10, toughness: 4, save: 3, invuln: null, wounds: 2 };
    expect(sameDefender(d, { ...d })).toBe(true);
    expect(sameDefender(d, { ...d, invuln: 4 })).toBe(false);
    expect(sameDefender(d, { ...d, wounds: 3 })).toBe(false);
  });
});

describe('materialiseRows', () => {
  it('links to the library entry with the same id and stats', () => {
    const { library, rows } = setup();
    const result = materialiseRows(snapshotRows(rows, library), library, 'P');
    expect(result.library).toHaveLength(2);
    expect(result.rows.every((r, i) => r.weaponId === rows[i].weaponId)).toBe(true);
    expect(new Set(result.rows.map((r) => r.id)).size).toBe(3);
  });

  it('links to an entry with the same name and stats when the id differs', () => {
    const { library, rows } = setup();
    const snap = snapshotRows(rows, library);
    const other: StoredWeapon[] = [{ ...boltRifle(), id: 'w-bolt-2' }, lascannon()];
    const result = materialiseRows(snap, other, 'P');
    expect(result.library).toHaveLength(2);
    expect(result.rows[0].weaponId).toBe('w-bolt-2');
  });

  it('restores a deleted weapon under its original id', () => {
    const { library, rows } = setup();
    const snap = snapshotRows(rows, library);
    const withoutLas = library.filter((w) => w.id !== 'w-las');
    const result = materialiseRows(snap, withoutLas, 'P');
    expect(result.library.find((w) => w.id === 'w-las')).toEqual(lascannon());
    expect(result.rows[1].weaponId).toBe('w-las');
    expect(withoutLas).toHaveLength(1);
  });

  it('adds a changed weapon as a copy suffixed with the preset name', () => {
    const { library, rows } = setup();
    const snap = snapshotRows(rows, library);
    library[0].strength = 5;
    const result = materialiseRows(snap, library, 'Intercessors');
    expect(result.library).toHaveLength(3);
    const copy = result.library[2];
    expect(copy.name).toBe('Bolt rifle (Intercessors)');
    expect(copy.strength).toBe(4);
    expect(copy.id).not.toBe('w-bolt');
    expect(result.rows[0].weaponId).toBe(copy.id);
    expect(result.rows[2].weaponId).toBe(copy.id);
    expect(result.library[0].strength).toBe(5);
    expect(sameSnapshot(snapshotRows(result.rows, result.library), snap)).toBe(true);
  });

  it('adds no duplicates when the same preset is loaded twice', () => {
    const { library, rows } = setup();
    const snap = snapshotRows(rows, library);
    library[0].strength = 5;
    const once = materialiseRows(snap, library.filter((w) => w.id !== 'w-las'), 'Intercessors');
    const twice = materialiseRows(snap, once.library, 'Intercessors');
    expect(once.library).toHaveLength(3);
    expect(twice.library).toEqual(once.library);
    expect(twice.rows.map((r) => r.weaponId)).toEqual(once.rows.map((r) => r.weaponId));
  });

  it('numbers a copy when the suffixed name is taken by a different weapon', () => {
    const { library, rows } = setup();
    const snap = snapshotRows(rows.slice(0, 1), library);
    library[0].strength = 5;
    library.push({ ...boltRifle(), id: 'w-x', name: 'Bolt rifle (P)', strength: 6 });
    const once = materialiseRows(snap, library, 'P');
    expect(once.library.at(-1)?.name).toBe('Bolt rifle (P) 2');
    expect(materialiseRows(snap, once.library, 'P').library).toHaveLength(once.library.length);
  });
});

describe('weaponUsage', () => {
  it('counts the live rows that use a weapon', () => {
    const { rows } = setup();
    expect(weaponUsage('w-bolt', rows)).toBe(2);
    expect(weaponUsage('w-las', rows)).toBe(1);
    expect(weaponUsage('w-none', rows)).toBe(0);
  });
});
