import { describe, expect, it } from 'vitest';
import { noAbilities, type Army, type StoredWeapon, type Unit } from '../types';
import { defenderSummary } from './presets';
import { copyUnit, deleteArmy, groupUnits, isNameTaken, newUnit, sameUnit, unitSummary, unitsInArmy } from './units';

const bolt = (): StoredWeapon => ({ id: 'w-bolt', name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() });
const pistol = (): StoredWeapon => ({ id: 'w-pistol', name: 'Bolt pistol', attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', abilities: noAbilities() });

const unit = (overrides: Partial<Unit> = {}): Unit => ({
  id: 'u1',
  name: 'Intercessors',
  armyId: 'sm',
  toughness: 4,
  save: 3,
  invuln: null,
  wounds: 2,
  keywords: ['infantry'],
  weapons: [bolt(), pistol()],
  ...overrides,
});

const armies = (): Army[] => [
  { id: 'sm', name: 'Space Marines' },
  { id: 'cd', name: 'Chaos Daemons' },
];

describe('newUnit', () => {
  it('starts empty, in the given army', () => {
    const u = newUnit('sm');
    expect(u).toMatchObject({ name: '', armyId: 'sm', invuln: null, keywords: [], weapons: [] });
    expect(newUnit().armyId).toBeNull();
    expect(newUnit().id).not.toBe(u.id);
  });
});

describe('copyUnit', () => {
  it('copies everything and shares no arrays or objects', () => {
    const original = unit({ weapons: [{ ...bolt(), abilities: { ...noAbilities(), anti: { vehicle: 4 } } }] });
    const copy = copyUnit(original);
    expect(copy).toEqual(original);
    expect(copy.keywords).not.toBe(original.keywords);
    expect(copy.weapons).not.toBe(original.weapons);
    expect(copy.weapons[0]).not.toBe(original.weapons[0]);
    expect(copy.weapons[0].abilities.anti).not.toBe(original.weapons[0].abilities.anti);
    copy.weapons[0].strength = 8;
    copy.keywords.push('vehicle');
    expect(original.weapons[0].strength).toBe(4);
    expect(original.keywords).toEqual(['infantry']);
  });
});

describe('sameUnit', () => {
  it('is true for a copy and false after any change', () => {
    const a = unit();
    expect(sameUnit(a, copyUnit(a))).toBe(true);
    expect(sameUnit(a, { ...copyUnit(a), name: 'Assault Intercessors' })).toBe(false);
    expect(sameUnit(a, { ...copyUnit(a), armyId: null })).toBe(false);
    expect(sameUnit(a, { ...copyUnit(a), invuln: 4 })).toBe(false);
    expect(sameUnit(a, { ...copyUnit(a), keywords: [] })).toBe(false);
    expect(sameUnit(a, { ...copyUnit(a), weapons: [bolt()] })).toBe(false);
    expect(sameUnit(a, { ...copyUnit(a), weapons: [{ ...bolt(), name: 'Bolt rifles' }, pistol()] })).toBe(false);
    expect(sameUnit(a, { ...copyUnit(a), weapons: [{ ...bolt(), ap: -2 }, pistol()] })).toBe(false);
  });
});

describe('isNameTaken', () => {
  it('ignores case and surrounding spaces', () => {
    expect(isNameTaken(['Bolt rifle'], '  bolt RIFLE ')).toBe(true);
    expect(isNameTaken(['Bolt rifle'], 'Bolt rifles')).toBe(false);
    expect(isNameTaken([], 'Bolt rifle')).toBe(false);
  });
});

describe('unitSummary', () => {
  it('shows the stat line and the weapon count', () => {
    expect(unitSummary(unit())).toBe('T4 · Sv 3+ · W2 · Infantry · 2 weapons');
    expect(unitSummary(unit({ save: 2, invuln: 5, wounds: 12, keywords: ['vehicle', 'monster'], weapons: [bolt()] }))).toBe('T4 · Sv 2+ · Inv 5+ · W12 · Vehicle, Monster · 1 weapon');
    expect(unitSummary(unit({ save: 7, keywords: [], weapons: [] }))).toBe('T4 · Sv – · W2 · no weapons');
  });

  it('leaves the defender summary as it was', () => {
    expect(defenderSummary({ models: 5, toughness: 8, save: 2, invuln: 4, wounds: 10, keywords: ['vehicle'] })).toBe('5 models · T8 · Sv 2+ · Inv 4+ · W10 · Vehicle');
    expect(defenderSummary({ models: 1, toughness: 4, save: 7, invuln: null, wounds: 1, keywords: [] })).toBe('1 model · T4 · Sv – · W1');
  });
});

describe('groupUnits', () => {
  const units = [
    unit({ id: 'a', name: 'Terminators', armyId: 'sm' }),
    unit({ id: 'b', name: 'Bloodletters', armyId: 'cd' }),
    unit({ id: 'c', name: 'Intercessors', armyId: 'sm' }),
    unit({ id: 'd', name: 'Test dummy', armyId: null }),
    unit({ id: 'e', name: 'Orphan', armyId: 'gone' }),
  ];
  const shape = (groups: ReturnType<typeof groupUnits>) => groups.map((g) => [g.army?.name ?? null, g.units.map((u) => u.name)]);

  it('groups by army in name order, units by name, "No army" last', () => {
    expect(shape(groupUnits(units, armies(), 'all'))).toEqual([
      ['Chaos Daemons', ['Bloodletters']],
      ['Space Marines', ['Intercessors', 'Terminators']],
      [null, ['Orphan', 'Test dummy']],
    ]);
  });

  it('filters on one army or on "No army"', () => {
    expect(shape(groupUnits(units, armies(), 'sm'))).toEqual([['Space Marines', ['Intercessors', 'Terminators']]]);
    expect(shape(groupUnits(units, armies(), 'none'))).toEqual([[null, ['Orphan', 'Test dummy']]]);
  });

  it('leaves out armies without units', () => {
    expect(shape(groupUnits([units[3]], armies(), 'all'))).toEqual([[null, ['Test dummy']]]);
    expect(groupUnits([], armies(), 'all')).toEqual([]);
    expect(groupUnits(units, armies(), 'unknown')).toEqual([]);
  });
});

describe('deleteArmy', () => {
  it('removes the army in place and moves its units to "No army"', () => {
    const list = armies();
    const units = [unit({ id: 'a', armyId: 'sm' }), unit({ id: 'b', armyId: 'cd' }), unit({ id: 'c', armyId: 'sm' })];
    expect(unitsInArmy(units, 'sm')).toBe(2);
    expect(deleteArmy(list, units, 'sm')).toBe(2);
    expect(list.map((a) => a.id)).toEqual(['cd']);
    expect(units.map((u) => u.armyId)).toEqual([null, 'cd', null]);
    expect(deleteArmy(list, units, 'missing')).toBe(0);
    expect(list).toHaveLength(1);
  });
});
