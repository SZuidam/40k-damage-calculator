import { describe, expect, it } from 'vitest';
import { noAbilities, type StoredWeapon } from '../types';
import { materialiseRows, snapshotRows, type LinkedRow } from './legacy';
import { sameRows } from './presets';

const none = noAbilities();
const boltRifle = (): StoredWeapon => ({ id: 'w-bolt', name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() });
const lascannon = (): StoredWeapon => ({ id: 'w-las', name: 'Lascannon', attacks: '1', skill: 3, strength: 12, ap: -3, damage: 'D6+1', abilities: noAbilities() });

function setup() {
  const library = [boltRifle(), lascannon()];
  const rows: LinkedRow[] = [
    { id: 'r1', models: 10, weaponId: 'w-bolt' },
    { id: 'r2', models: 1, weaponId: 'w-las' },
    { id: 'r3', models: 5, weaponId: 'w-bolt' },
  ];
  return { library, rows };
}

describe('snapshotRows', () => {
  it('copies the linked weapons and skips rows without one', () => {
    const { library, rows } = setup();
    const snap = snapshotRows([...rows, { id: 'x', models: 1, weaponId: null }, { id: 'y', models: 1, weaponId: 'gone' }], library);
    expect(snap).toHaveLength(3);
    expect(snap[0]).toEqual({ models: 10, weaponId: 'w-bolt', weapon: { name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: none } });
    library[0].strength = 5;
    expect(snap[0].weapon.strength).toBe(4);
  });
});

describe('materialiseRows (v2 → v3 migration)', () => {
  it('links to the library entry with the same id and stats', () => {
    const { library, rows } = setup();
    const result = materialiseRows(snapshotRows(rows, library), library, 'P');
    expect(result.library).toEqual(library);
    expect(result.rows.map((r) => [r.models, r.weaponId])).toEqual([
      [10, 'w-bolt'],
      [1, 'w-las'],
      [5, 'w-bolt'],
    ]);
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
    expect(sameRows(snapshotRows(result.rows, result.library), snap)).toBe(true);
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
