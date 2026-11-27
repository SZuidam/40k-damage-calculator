import { describe, expect, it } from 'vitest';
import { noAbilities, noConditions, type Army, type AttackerSelection, type DefenderSelection, type LoadoutRow, type StoredWeapon, type Unit, type UnitAbility } from '../types';
import {
  armyChoices,
  armyOf,
  carriedWeapons,
  defaultArmyId,
  defenderOf,
  leaderChoices,
  newLoadout,
  reconcileAttacker,
  reconcileDefender,
  reorderCarried,
  resolveLoadout,
  syncLoadout,
  unitsOfArmy,
} from './loadout';

const weapon = (id: string, name: string, attacks = '1'): StoredWeapon => ({ id, name, type: 'ranged', attacks, skill: 3, strength: 4, ap: 0, damage: '1', abilities: noAbilities() });

const unit = (overrides: Partial<Unit> = {}): Unit => ({
  id: 'u1',
  name: 'Intercessors',
  armyId: 'sm',
  toughness: 4,
  save: 3,
  invuln: null,
  wounds: 2,
  keywords: ['infantry'],
  weapons: [weapon('w-bolt', 'Bolt rifle', '2'), weapon('w-pistol', 'Bolt pistol'), weapon('w-ccw', 'Close combat weapon', '3')],
  abilities: [],
  ...overrides,
});

const armies = (): Army[] => [
  { id: 'sm', name: 'Space Marines', abilities: [] },
  { id: 'cd', name: 'Chaos Daemons', abilities: [] },
];

const row = (weaponId: string, carried: boolean, count: number): LoadoutRow => ({ weaponId, carried, count });

describe('newLoadout', () => {
  it('lists every weapon in the unit’s order, unticked, 5 each', () => {
    expect(newLoadout(unit())).toEqual([row('w-bolt', false, 5), row('w-pistol', false, 5), row('w-ccw', false, 5)]);
    expect(newLoadout(unit({ weapons: [] }))).toEqual([]);
  });
});

describe('syncLoadout', () => {
  it('keeps order, ticks and counts, drops removed weapons and duplicates, appends new weapons', () => {
    const rows = [row('w-ccw', true, 2), row('w-gone', true, 1), row('w-bolt', true, 8), row('w-ccw', false, 9)];
    const synced = syncLoadout(rows, unit());
    expect(synced).toEqual([row('w-ccw', true, 2), row('w-bolt', true, 8), row('w-pistol', false, 5)]);
    // Copies: editing the result leaves the input alone.
    synced[0].count = 3;
    expect(rows[0].count).toBe(2);
  });
});

describe('armies in the dropdown', () => {
  it('armyOf treats a missing army as "No army"', () => {
    expect(armyOf(unit(), armies())).toBe('sm');
    expect(armyOf(unit({ armyId: 'gone' }), armies())).toBeNull();
    expect(armyOf(unit({ armyId: null }), armies())).toBeNull();
  });

  it('lists the armies by name, with "No army" only when a unit has none or there are no armies', () => {
    expect(armyChoices(armies(), [unit()])).toEqual([
      { id: 'cd', name: 'Chaos Daemons' },
      { id: 'sm', name: 'Space Marines' },
    ]);
    expect(armyChoices(armies(), [unit(), unit({ id: 'u2', armyId: null })]).map((c) => c.id)).toEqual(['cd', 'sm', null]);
    expect(armyChoices([], [])).toEqual([{ id: null, name: 'No army' }]);
  });

  it('unitsOfArmy lists one army’s units (or those without an army) by name', () => {
    const units = [unit({ id: 'b', name: 'Hellblasters', abilities: [] }), unit({ id: 'a', name: 'Aggressors', abilities: [] }), unit({ id: 'c', name: 'Bloodletters', armyId: 'cd' }), unit({ id: 'd', name: 'Dummy', armyId: null })];
    expect(unitsOfArmy(units, armies(), 'sm').map((u) => u.id)).toEqual(['a', 'b']);
    expect(unitsOfArmy(units, armies(), 'cd').map((u) => u.id)).toEqual(['c']);
    expect(unitsOfArmy(units, armies(), null).map((u) => u.id)).toEqual(['d']);
  });

  it('starts on the first army by name that has units', () => {
    expect(defaultArmyId(armies(), [unit()])).toBe('sm');
    expect(defaultArmyId(armies(), [unit(), unit({ id: 'u2', armyId: 'cd' })])).toBe('cd');
    expect(defaultArmyId(armies(), [])).toBe('cd');
    expect(defaultArmyId([], [unit({ armyId: null })])).toBeNull();
  });
});

describe('reconcile', () => {
  it('syncs the attacker’s loadout and moves its army to the unit’s army', () => {
    const sel: AttackerSelection = { armyId: 'cd', unitId: 'u1', leaderId: null, rows: [row('w-pistol', true, 2), row('w-gone', true, 1)] };
    reconcileAttacker(sel, armies(), [unit()]);
    expect(sel).toEqual({ armyId: 'sm', unitId: 'u1', leaderId: null, rows: [row('w-pistol', true, 2), row('w-bolt', false, 5), row('w-ccw', false, 5)] });
  });

  it('unpicks a deleted unit and keeps the army dropdown on an existing choice', () => {
    const sel: AttackerSelection = { armyId: 'gone', unitId: 'gone', leaderId: null, rows: [row('w-bolt', true, 5)] };
    reconcileAttacker(sel, armies(), [unit()]);
    expect(sel).toEqual({ armyId: 'sm', unitId: null, leaderId: null, rows: [] });

    const kept: AttackerSelection = { armyId: 'cd', unitId: null, leaderId: null, rows: [] };
    reconcileAttacker(kept, armies(), [unit()]);
    expect(kept.armyId).toBe('cd');
  });

  it('does the same for the defender and keeps its model count', () => {
    const sel: DefenderSelection = { armyId: null, unitId: 'u1', models: 10 };
    reconcileDefender(sel, armies(), [unit()]);
    expect(sel).toEqual({ armyId: 'sm', unitId: 'u1', models: 10 });
    reconcileDefender(sel, armies(), []);
    expect(sel).toEqual({ armyId: 'sm', unitId: null, models: 10 });
  });
});

describe('the attack', () => {
  const rows = () => [row('w-ccw', true, 2), row('w-pistol', false, 5), row('w-bolt', true, 8)];

  it('carriedWeapons lists only the ticked rows with their weapons, in order', () => {
    expect(carriedWeapons(unit(), rows()).map(({ row: r, weapon: w }) => [w.name, r.count])).toEqual([
      ['Close combat weapon', 2],
      ['Bolt rifle', 8],
    ]);
    expect(carriedWeapons(unit(), [row('w-gone', true, 1)])).toEqual([]);
  });

  it('resolveLoadout fires each carried weapon with its count and copies of weapon and conditions', () => {
    const u = unit();
    const conditions = { halfRange: true, charged: false };
    const profiles = resolveLoadout(u, rows(), conditions);
    expect(profiles.map((p) => [p.id, p.name, p.models, p.attacks])).toEqual([
      ['w-ccw', 'Close combat weapon', 2, '3'],
      ['w-bolt', 'Bolt rifle', 8, '2'],
    ]);
    expect(profiles[0].conditions).toEqual(conditions);
    expect(profiles[0].conditions).not.toBe(conditions);
    expect(profiles[0].abilities).not.toBe(u.weapons[2].abilities);
  });

  it('defenderOf combines the unit’s stat line with the model count', () => {
    const u = unit({ invuln: 4, keywords: ['infantry', 'fly'] });
    const d = defenderOf(u, 10);
    expect(d).toEqual({ models: 10, toughness: 4, save: 3, invuln: 4, wounds: 2, keywords: ['infantry', 'fly'] });
    d.keywords.push('vehicle');
    expect(u.keywords).toEqual(['infantry', 'fly']);
  });

  it('reorderCarried moves the carried rows between their own slots and leaves the others in place', () => {
    const all = [row('a', true, 1), row('b', false, 1), row('c', true, 1), row('d', true, 1), row('e', false, 1)];
    expect(reorderCarried(all, [2, 0, 1]).map((r) => r.weaponId)).toEqual(['d', 'b', 'a', 'c', 'e']);
    expect(reorderCarried(all, [0, 1, 2]).map((r) => r.weaponId)).toEqual(['a', 'b', 'c', 'd', 'e']);
  });
});

describe('abilities in the loadout', () => {
  const shock: UnitAbility = {
    id: 'a-shock',
    name: 'Shock Assault',
    description: '',
    appliesTo: 'unit',
    when: { toggle: false, conditions: ['charged'], weaponType: 'melee', targetKeyword: null },
    effects: [{ kind: 'stat', stat: 'attacks', amount: 1 }],
  };
  const oath: UnitAbility = { ...shock, id: 'a-oath', name: 'Oath', when: { toggle: true, conditions: [], weaponType: 'any', targetKeyword: null }, effects: [{ kind: 'reroll', roll: 'hit', which: 'failed' }] };
  const squad = () => {
    const u = unit();
    u.weapons[2].type = 'melee';
    return u;
  };
  const allCarried = (u: Unit) => newLoadout(u).map((r) => ({ ...r, carried: true }));

  it('applies an ability only to the weapons it is active for', () => {
    const u = squad();
    const charged = { halfRange: false, charged: true };
    const profiles = resolveLoadout(u, allCarried(u), charged, { abilities: [shock], toggles: [], keywords: ['infantry'] });
    expect(profiles.map((p) => p.attacks)).toEqual(['2', '1', '4']);
    expect(resolveLoadout(u, allCarried(u), noConditions(), { abilities: [shock], toggles: [], keywords: null }).map((p) => p.attacks)).toEqual(['2', '1', '3']);
  });

  it('applies an ability switched on by hand only while its toggle is on', () => {
    const u = squad();
    const off = resolveLoadout(u, allCarried(u), noConditions(), { abilities: [oath], toggles: [], keywords: null });
    const on = resolveLoadout(u, allCarried(u), noConditions(), { abilities: [oath], toggles: ['a-oath'], keywords: null });
    expect(off.every((p) => p.modifiers.rerollHits === 'none')).toBe(true);
    expect(on.every((p) => p.modifiers.rerollHits === 'failed')).toBe(true);
  });

  it('passes the damage re-roll thresholds of the Settings on', () => {
    const u = squad();
    u.weapons[0].damage = 'D3';
    u.weapons[1].damage = 'D6+1';
    const reroll: UnitAbility = { ...shock, id: 'a-dmg', when: { toggle: false, conditions: [], weaponType: 'any', targetKeyword: null }, effects: [{ kind: 'rerollDamage' }] };
    const profiles = resolveLoadout(u, allCarried(u), noConditions(), { abilities: [reroll], toggles: [], keywords: null, damageRerolls: { d3: 3, d6: 5 } });
    expect(profiles.map((p) => p.modifiers.rerollDamageBelow)).toEqual([3, 5, 0]);
  });

  it('offers the units of the same army that can lead', () => {
    const lead: UnitAbility = { ...shock, id: 'a-lead', appliesTo: 'ledUnit' };
    const captain = unit({ id: 'cap', name: 'Captain', abilities: [lead] });
    const chaplain = unit({ id: 'chap', name: 'Chaplain', abilities: [lead] });
    const outsider = unit({ id: 'lord', name: 'Daemon Prince', armyId: 'cd', abilities: [lead] });
    const plain = unit({ id: 'tac', name: 'Tacticals' });
    const units = [unit(), chaplain, captain, outsider, plain];
    expect(leaderChoices(units[0], armies(), units).map((u) => u.id)).toEqual(['cap', 'chap']);
  });
});
