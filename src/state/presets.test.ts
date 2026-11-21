import { describe, expect, it } from 'vitest';
import { noAbilities, noConditions, type DefenderProfile, type Profile, type ProfileRow, type StoredWeapon } from '../types';
import { byName, copyDefender, copyRows, defenderSummary, pickStats, resolveRows, rowsSummary, sameDefender, sameRows, uniqueName } from './presets';

const none = noAbilities();
const boltRifle = (): StoredWeapon => ({ id: 'w-bolt', name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() });
const lascannon = (): StoredWeapon => ({ id: 'w-las', name: 'Lascannon', attacks: '1', skill: 3, strength: 12, ap: -3, damage: 'D6+1', abilities: noAbilities() });

function setup() {
  const library = [boltRifle(), lascannon()];
  const rows: ProfileRow[] = [
    { id: 'r1', models: 10, weapon: pickStats(library[0]) },
    { id: 'r2', models: 1, weapon: pickStats(library[1]) },
    { id: 'r3', models: 5, weapon: pickStats(library[0]) },
  ];
  return { library, rows };
}

describe('resolveRows', () => {
  it('turns rows into engine profiles with the row id and the weapon copy', () => {
    const { rows } = setup();
    const conditions = noConditions();
    expect(resolveRows(rows, conditions)).toEqual([
      { id: 'r1', name: 'Bolt rifle', models: 10, attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: none, conditions },
      { id: 'r2', name: 'Lascannon', models: 1, attacks: '1', skill: 3, strength: 12, ap: -3, damage: 'D6+1', abilities: none, conditions },
      { id: 'r3', name: 'Bolt rifle', models: 5, attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: none, conditions },
    ]);
  });

  it('gives every weapon its own copy of the attack conditions and abilities', () => {
    const { rows } = setup();
    const conditions = { halfRange: true, charged: true };
    const resolved = resolveRows(rows, conditions);
    expect(resolved.every((w) => w.conditions.halfRange && w.conditions.charged)).toBe(true);
    resolved[0].conditions.charged = false;
    expect(conditions.charged).toBe(true);
    expect(resolved[1].conditions.charged).toBe(true);
    resolved[0].abilities.lethalHits = true;
    expect(rows[0].weapon.abilities.lethalHits).toBe(false);
  });

  it('does not look at the library: rows fire their own copy', () => {
    const { library, rows } = setup();
    library[0].strength = 9;
    library.splice(1, 1);
    expect(resolveRows(rows, noConditions()).map((w) => [w.name, w.strength])).toEqual([
      ['Bolt rifle', 4],
      ['Lascannon', 12],
      ['Bolt rifle', 4],
    ]);
  });
});

describe('copyRows', () => {
  it('copies rows with new ids and deep copies of their weapons', () => {
    const { rows } = setup();
    rows[0].weapon.abilities.anti = { vehicle: 4 };
    const copies = copyRows(rows);
    expect(copies.map((r) => [r.models, r.weapon])).toEqual(rows.map((r) => [r.models, r.weapon]));
    expect(copies.every((c, i) => c.id !== rows[i].id && c !== rows[i] && c.weapon !== rows[i].weapon)).toBe(true);
    expect(new Set(copies.map((c) => c.id)).size).toBe(rows.length);
    copies[0].weapon.abilities.anti.monster = 3;
    copies[0].weapon.strength = 5;
    expect(rows[0].weapon.abilities.anti).toEqual({ vehicle: 4 });
    expect(rows[0].weapon.strength).toBe(4);
  });

  it('copies rows without ids (from an export file)', () => {
    const copies = copyRows([{ models: 3, weapon: pickStats(lascannon()) }]);
    expect(copies).toEqual([{ id: expect.any(String), models: 3, weapon: pickStats(lascannon()) }]);
  });
});

describe('sameRows', () => {
  it('is true for a copy, and ignores row ids and weapon names', () => {
    const { rows } = setup();
    expect(sameRows(rows, copyRows(rows))).toBe(true);
    const renamed = copyRows(rows);
    renamed[0].weapon.name = 'Bolt rifle (Mk II)';
    expect(sameRows(rows, renamed)).toBe(true);
  });

  it('detects changed models, order and row count', () => {
    const { rows } = setup();
    expect(sameRows([{ ...rows[0], models: 9 }, rows[1], rows[2]], rows)).toBe(false);
    expect(sameRows([rows[1], rows[0], rows[2]], rows)).toBe(false);
    expect(sameRows(rows.slice(0, 2), rows)).toBe(false);
    expect(sameRows([], [])).toBe(true);
  });

  it('treats a stat or ability change as a change, but not dice case or spacing', () => {
    const { rows } = setup();
    const changed = copyRows(rows);
    changed[1].weapon.abilities.lethalHits = true;
    expect(sameRows(changed, rows)).toBe(false);
    const sustained = copyRows(rows);
    sustained[0].weapon.abilities.sustainedHits = '1';
    const spaced = copyRows(sustained);
    spaced[0].weapon.abilities.sustainedHits = ' 1 ';
    spaced[1].weapon.damage = 'd6+1';
    expect(sameRows(sustained, rows)).toBe(false);
    expect(sameRows(spaced, sustained)).toBe(true);
    const anti = copyRows(rows);
    anti[0].weapon.abilities.anti = { vehicle: 4 };
    expect(sameRows(anti, rows)).toBe(false);
  });
});

describe('profiles keep their own copies', () => {
  it('editing or deleting a library weapon changes neither a profile nor the working area', () => {
    const library = [boltRifle()];
    const profile: Profile = { id: 'p', name: 'Bolters', rows: [{ id: 'r', models: 10, weapon: pickStats(library[0]) }] };
    const working = copyRows(profile.rows);
    library[0].ap = -2;
    library[0].abilities.lethalHits = true;
    expect(profile.rows[0].weapon).toEqual(pickStats(boltRifle()));
    expect(sameRows(working, profile.rows)).toBe(true);
    library.splice(0, 1);
    expect(resolveRows(working, noConditions())[0].ap).toBe(-1);
  });

  it('saving copies the working area, so later edits make the profile dirty again', () => {
    const { rows } = setup();
    const profile: Profile = { id: 'p', name: 'Gunline', rows: copyRows(rows) };
    rows[0].models = 8;
    expect(sameRows(rows, profile.rows)).toBe(false);
    profile.rows = copyRows(rows);
    expect(sameRows(rows, profile.rows)).toBe(true);
    rows[0].models = 7;
    expect(profile.rows[0].models).toBe(8);
  });
});

describe('defenders', () => {
  it('compares defenders field by field', () => {
    const d = { models: 10, toughness: 4, save: 3, invuln: null, wounds: 2, keywords: [] };
    expect(sameDefender(d, { ...d })).toBe(true);
    expect(sameDefender(d, { ...d, invuln: 4 })).toBe(false);
    expect(sameDefender(d, { ...d, wounds: 3 })).toBe(false);
  });

  it('compares defender keywords, whatever their order', () => {
    const d: DefenderProfile = { models: 1, toughness: 10, save: 3, invuln: null, wounds: 12, keywords: ['vehicle'] };
    expect(sameDefender(d, { ...d, keywords: ['vehicle'] })).toBe(true);
    expect(sameDefender(d, { ...d, keywords: [] })).toBe(false);
    expect(sameDefender(d, { ...d, keywords: ['monster'] })).toBe(false);
    expect(sameDefender(d, { ...d, keywords: ['vehicle', 'fly'] })).toBe(false);
    expect(sameDefender({ ...d, keywords: ['vehicle', 'fly'] }, { ...d, keywords: ['fly', 'vehicle'] })).toBe(true);
  });
});

describe('summaries', () => {
  it('rowsSummary names the weapon copies', () => {
    const { library, rows } = setup();
    expect(rowsSummary(rows)).toBe('10× Bolt rifle, 1× Lascannon, 5× Bolt rifle');
    library[0].name = 'Renamed';
    expect(rowsSummary(rows.slice(0, 1))).toBe('10× Bolt rifle');
    expect(rowsSummary([{ models: 2, weapon: pickStats(lascannon()) }])).toBe('2× Lascannon');
    expect(rowsSummary([])).toBe('');
  });
});

describe('names', () => {
  it('uniqueName numbers taken names case-insensitively and stays within 40 characters', () => {
    expect(uniqueName([], 'Gunline')).toBe('Gunline');
    expect(uniqueName(['gunline'], 'Gunline')).toBe('Gunline (2)');
    expect(uniqueName(['Gunline', 'Gunline (2)'], 'Gunline')).toBe('Gunline (3)');
    expect(uniqueName([], 'y'.repeat(50))).toBe('y'.repeat(40));
  });

  it('byName sorts case-insensitively with numbers in order, without changing the input', () => {
    const items = [{ name: 'b' }, { name: 'Squad 10' }, { name: 'A' }, { name: 'Squad 2' }];
    expect(byName(items).map((i) => i.name)).toEqual(['A', 'b', 'Squad 2', 'Squad 10']);
    expect(items[0].name).toBe('b');
  });
});

describe('copies', () => {
  it('pickStats and copyDefender share no objects with the original', () => {
    const weapon = { ...boltRifle(), abilities: { ...noAbilities(), anti: { vehicle: 4 } } };
    const copy = pickStats(weapon);
    expect(copy).not.toHaveProperty('id');
    expect(copy.abilities).toEqual(weapon.abilities);
    expect(copy.abilities).not.toBe(weapon.abilities);
    expect(copy.abilities.anti).not.toBe(weapon.abilities.anti);
    copy.abilities.anti.monster = 3;
    expect(weapon.abilities.anti).toEqual({ vehicle: 4 });

    const d: DefenderProfile = { models: 1, toughness: 10, save: 3, invuln: null, wounds: 12, keywords: ['vehicle'] };
    const dc = copyDefender(d);
    expect(dc).toEqual(d);
    dc.keywords.push('fly');
    expect(d.keywords).toEqual(['vehicle']);
  });
});

describe('defenderSummary', () => {
  it('lists the keywords when there are any', () => {
    const d: DefenderProfile = { models: 1, toughness: 10, save: 3, invuln: null, wounds: 12, keywords: [] };
    expect(defenderSummary(d)).toBe('1 model · T10 · Sv 3+ · W12');
    expect(defenderSummary({ ...d, keywords: ['vehicle', 'monster'] })).toBe('1 model · T10 · Sv 3+ · W12 · Vehicle, Monster');
  });
});
