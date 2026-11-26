import { describe, expect, it } from 'vitest';
import { noAbilities, type DefenderProfile, type StoredWeapon } from '../types';
import { byName, pickStats, sameCombatStats, sameDefender, statLine, statsSummary } from './presets';

const boltRifle = (): StoredWeapon => ({ id: 'w-bolt', name: 'Bolt rifle', type: 'ranged', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() });

describe('sameCombatStats', () => {
  it('ignores the name and dice case or spacing, but not a stat or ability change', () => {
    const a = boltRifle();
    expect(sameCombatStats(a, { ...a, name: 'Renamed' })).toBe(true);
    expect(sameCombatStats({ ...a, attacks: 'd6+1' }, { ...a, attacks: ' D6+1 ' })).toBe(true);
    expect(sameCombatStats(a, { ...a, ap: -2 })).toBe(false);
    expect(sameCombatStats(a, { ...a, abilities: { ...noAbilities(), lethalHits: true } })).toBe(false);
    expect(sameCombatStats(a, { ...a, type: 'melee' })).toBe(false);
  });
});

describe('statsSummary', () => {
  it('reads BS for a ranged weapon and Melee · WS for a melee weapon', () => {
    expect(statsSummary(boltRifle())).toBe('A 2 · BS 3+ · S 4 · AP -1 · D 1');
    expect(statsSummary({ ...boltRifle(), type: 'melee' })).toBe('Melee · A 2 · WS 3+ · S 4 · AP -1 · D 1');
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

describe('names', () => {
  it('byName sorts case-insensitively with numbers in order, without changing the input', () => {
    const items = [{ name: 'b' }, { name: 'Squad 10' }, { name: 'A' }, { name: 'Squad 2' }];
    expect(byName(items).map((i) => i.name)).toEqual(['A', 'b', 'Squad 2', 'Squad 10']);
    expect(items[0].name).toBe('b');
  });
});

describe('copies', () => {
  it('pickStats shares no objects with the original', () => {
    const weapon = { ...boltRifle(), abilities: { ...noAbilities(), anti: { vehicle: 4 } } };
    const copy = pickStats(weapon);
    expect(copy).not.toHaveProperty('id');
    expect(copy.abilities).toEqual(weapon.abilities);
    expect(copy.abilities).not.toBe(weapon.abilities);
    expect(copy.abilities.anti).not.toBe(weapon.abilities.anti);
    copy.abilities.anti.monster = 3;
    expect(weapon.abilities.anti).toEqual({ vehicle: 4 });
  });
});

describe('statLine', () => {
  it('shows the stats, the invulnerable save and the keywords when there are any', () => {
    const d = { toughness: 10, save: 3, invuln: null, wounds: 12, keywords: [] };
    expect(statLine(d)).toBe('T10 · Sv 3+ · W12');
    expect(statLine({ ...d, save: 7, invuln: 4, keywords: ['vehicle', 'monster'] })).toBe('T10 · Sv – · Inv 4+ · W12 · Vehicle, Monster');
  });
});
