import { describe, expect, it } from 'vitest';
import { noAbilities, type AbilityEffect, type Unit, type UnitAbility, type WeaponStats } from '../types';
import { abilityValueError, antiValueError, validateAbilities, validateAbility, validateAttackerModels, validateLoadoutRow, validateUnit, validateWeaponStats } from './validation';

const stats: WeaponStats = { name: 'Bolt rifle', type: 'ranged', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() };

describe('validateWeaponStats', () => {
  it('accepts a valid profile', () => {
    expect(validateWeaponStats(stats)).toEqual({});
  });

  it('requires a name', () => {
    expect(validateWeaponStats({ ...stats, name: '   ' }).name).toBeDefined();
    expect(validateWeaponStats({ ...stats, name: 'x'.repeat(41) }).name).toBeDefined();
  });

  it('flags each invalid stat', () => {
    const abilities = { ...noAbilities(), sustainedHits: 'D7' };
    const errors = validateWeaponStats({ name: 'X', type: 'ranged', attacks: '', skill: 7, strength: 31, ap: 1, damage: '2D', abilities });
    expect(Object.keys(errors).sort()).toEqual(['abilities', 'ap', 'attacks', 'damage', 'skill', 'strength']);
  });

  it('checks the Blast and Cleave values', () => {
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), blast: '2', cleave: '12' } })).toEqual({});
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), blast: 'D6+2', cleave: '2D6' } })).toEqual({});
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), blast: '0' } }).abilities).toBe('Blast: use 3, D3, D6, 2D6, D6+1, …');
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), cleave: '13' } }).abilities).toBe('Cleave: X can roll at most 12');
  });

  it('checks the Rapid Fire value', () => {
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), rapidFire: 'D3', lance: true } })).toEqual({});
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), rapidFire: 'D7' } }).abilities).toBe('Rapid Fire: use 3, D3, D6, 2D6, D6+1, …');
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), rapidFire: '3D6' } }).abilities).toBe('Rapid Fire: X can roll at most 12');
  });

  it('checks the Melta value', () => {
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), melta: 'D3+1' } })).toEqual({});
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), melta: '2' } })).toEqual({});
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), melta: 'D4' } }).abilities).toBe('Melta: use 3, D3, D6, 2D6, D6+1, …');
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), melta: 'D6-1' } }).abilities).toBe('Melta: use 3, D3, D6, 2D6, D6+1, …');
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), melta: '13' } }).abilities).toBe('Melta: X can roll at most 12');
  });

  it.each(['3', 'D3', 'd6+2', '2D6', '2D3+1', 'D6+6'])('accepts ability X %j', (x) => {
    expect(abilityValueError(x, 'Blast')).toBeUndefined();
  });

  it.each([
    ['3D6', 'Sustained Hits: X can roll at most 12'],
    ['D6+7', 'Sustained Hits: X can roll at most 12'],
    ['D8', 'Sustained Hits: use 3, D3, D6, 2D6, D6+1, …'],
    ['0', 'Sustained Hits: use 3, D3, D6, 2D6, D6+1, …'],
    ['abc', 'Sustained Hits: use 3, D3, D6, 2D6, D6+1, …'],
    ['', 'Sustained Hits is required'],
  ])('rejects ability X %j', (x, message) => {
    expect(abilityValueError(x, 'Sustained Hits')).toBe(message);
  });

  it('checks Y of every Anti ability', () => {
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), anti: { vehicle: 2, monster: 6 } } })).toEqual({});
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), anti: { vehicle: 4, monster: 7 } } }).abilities).toBe('Anti-Monster: Y must be between 2+ and 6+');
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), anti: { fly: 1 } } }).abilities).toBe('Anti-Fly: Y must be between 2+ and 6+');
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), anti: { psyker: 3.5 } } }).abilities).toBe('Anti-Psyker: Y must be between 2+ and 6+');
  });

  it.each(['2', '4+', ' 6 + '])('accepts Anti Y %j', (y) => {
    expect(antiValueError(y, 'Anti-Vehicle')).toBeUndefined();
  });

  it.each([
    ['', 'Anti-Vehicle: Y is required'],
    ['7', 'Anti-Vehicle: Y must be between 2+ and 6+'],
    ['1+', 'Anti-Vehicle: Y must be between 2+ and 6+'],
    ['abc', 'Anti-Vehicle: Y must be between 2+ and 6+'],
  ])('rejects Anti Y %j', (y, message) => {
    expect(antiValueError(y, 'Anti-Vehicle')).toBe(message);
  });

  it('accepts abilities with a valid Sustained Hits value', () => {
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), lethalHits: true, sustainedHits: '2', devastatingWounds: true } })).toEqual({});
  });
});

describe('validateUnit', () => {
  const unit: Unit = { id: 'u1', name: 'Intercessors', armyId: 'sm', toughness: 4, save: 3, invuln: null, wounds: 2, keywords: ['infantry'], weapons: [{ ...stats, id: 'w1' }], abilities: [] };

  it('accepts a valid unit, also one without weapons', () => {
    expect(validateUnit(unit)).toEqual({});
    expect(validateUnit({ ...unit, weapons: [], save: 7, invuln: 4, toughness: 20, wounds: 40 })).toEqual({});
  });

  it('requires a name of at most 40 characters', () => {
    expect(validateUnit({ ...unit, name: '  ' }).name).toBe('Name is required');
    expect(validateUnit({ ...unit, name: 'x'.repeat(41) }).name).toBe('Name must be at most 40 characters');
  });

  it('rejects a name another unit in the same army has, ignoring case', () => {
    expect(validateUnit({ ...unit, name: ' intercessors ' }, ['Intercessors']).name).toBe('Another unit in this army already has this name');
    expect(validateUnit(unit, ['Terminators'])).toEqual({});
  });

  it('flags each invalid stat, without a models × wounds limit', () => {
    const errors = validateUnit({ ...unit, toughness: 0, save: 1, invuln: 7, wounds: 41 });
    expect(errors).toEqual({
      toughness: 'Toughness must be between 1 and 20',
      save: 'Save must be between 2 and 7',
      invuln: 'Invulnerable save must be between 2 and 6',
      wounds: 'Wounds must be between 1 and 40',
    });
  });

  it('flags an invalid weapon and two weapons with the same name', () => {
    expect(validateUnit({ ...unit, weapons: [{ ...stats, id: 'w1', attacks: 'D7' }] }).weapons).toBe('Bolt rifle: Attacks: use 3, D3, D6, 2D6, D6+1, …');
    expect(validateUnit({ ...unit, weapons: [{ ...stats, id: 'w1' }, { ...stats, id: 'w2', name: 'BOLT RIFLE ', ap: -2 }] }).weapons).toBe('Two weapons are named "BOLT RIFLE"');
  });
});

describe('validateLoadoutRow', () => {
  it('accepts a valid count and a valid weapon', () => {
    expect(validateLoadoutRow(5, stats)).toEqual({});
    expect(validateLoadoutRow(1, stats)).toEqual({});
    expect(validateLoadoutRow(50, stats)).toEqual({});
  });

  it('keeps the count between 1 and 50', () => {
    expect(validateLoadoutRow(0, stats).count).toBe('Count must be between 1 and 50');
    expect(validateLoadoutRow(51, stats).count).toBe('Count must be between 1 and 50');
    expect(validateLoadoutRow(1.5, stats).count).toBe('Count must be a whole number');
    expect(validateLoadoutRow(Number.NaN, stats).count).toBeDefined();
  });

  it('joins every error of an invalid weapon into one line', () => {
    expect(validateLoadoutRow(1, { ...stats, attacks: 'D7' })).toEqual({ weapon: 'Attacks: use 3, D3, D6, 2D6, D6+1, …' });
    expect(validateLoadoutRow(1, { ...stats, strength: 40, ap: 2 })).toEqual({ weapon: 'Strength must be between 1 and 30 · AP must be between -6 and 0' });
    expect(validateLoadoutRow(0, { ...stats, name: '' })).toEqual({ count: 'Count must be between 1 and 50', weapon: 'Name is required' });
  });
});

describe('validateAbility', () => {
  const unit: Unit = { id: 'u1', name: 'Intercessors', armyId: 'sm', toughness: 4, save: 3, invuln: null, wounds: 2, keywords: [], weapons: [], abilities: [] };
  const ability = (overrides: Partial<UnitAbility> = {}): UnitAbility => ({
    id: 'a1',
    name: 'Shock Assault',
    description: '',
    appliesTo: 'unit',
    when: { toggle: false, conditions: ['charged'], weaponType: 'melee', targetKeyword: null },
    effects: [{ kind: 'stat', stat: 'attacks', amount: 1 }],
    ...overrides,
  });

  it('accepts a valid ability', () => {
    expect(validateAbility(ability())).toEqual({});
  });

  it('requires a unique name of at most 40 characters and at least one effect', () => {
    expect(validateAbility(ability({ name: ' ' })).name).toBe('Name is required');
    expect(validateAbility(ability({ name: 'x'.repeat(41) })).name).toMatch(/at most 40/);
    expect(validateAbility(ability(), ['shock assault ']).name).toMatch(/already has this name/);
    expect(validateAbility(ability({ effects: [] })).effects).toBe('Add at least one effect');
  });

  it('checks amounts, thresholds and granted abilities', () => {
    const effectError = (effect: AbilityEffect) => validateAbility(ability({ effects: [effect] })).effects;
    expect(effectError({ kind: 'stat', stat: 'attacks', amount: 7 })).toMatch(/between 1 and 6/);
    expect(effectError({ kind: 'ap', amount: 0 })).toMatch(/between 1 and 6/);
    expect(effectError({ kind: 'roll', roll: 'hit', amount: 2 })).toMatch(/\+1 or -1/);
    expect(effectError({ kind: 'roll', roll: 'hit', amount: -1 })).toBeUndefined();
    expect(effectError({ kind: 'critical', roll: 'wound', on: 1 })).toMatch(/2\+ to 6\+/);
    expect(effectError({ kind: 'grant', abilities: noAbilities() })).toMatch(/at least one/);
    expect(effectError({ kind: 'grant', abilities: { ...noAbilities(), sustainedHits: '2D6+1' } })).toMatch(/Sustained Hits/);
    expect(effectError({ kind: 'grant', abilities: { ...noAbilities(), anti: { vehicle: 9 } } })).toMatch(/Anti-Vehicle/);
  });

  it('checks the roll and the mortal wounds per success of Inflict mortal wounds', () => {
    const effectError = (effect: AbilityEffect) => validateAbility(ability({ effects: [effect] })).effects;
    expect(effectError({ kind: 'mortalWounds', on: 4, perSuccess: '1' })).toBeUndefined();
    expect(effectError({ kind: 'mortalWounds', on: 2, perSuccess: 'D3' })).toBeUndefined();
    expect(effectError({ kind: 'mortalWounds', on: 6, perSuccess: 'd6+1' })).toBeUndefined();
    expect(effectError({ kind: 'mortalWounds', on: 1, perSuccess: '1' })).toMatch(/2\+ to 6\+/);
    expect(effectError({ kind: 'mortalWounds', on: 4.5, perSuccess: '1' })).toMatch(/2\+ to 6\+/);
    expect(effectError({ kind: 'mortalWounds', on: 4, perSuccess: '' })).toBe('Mortal wounds per success must be a number or dice like D3');
    expect(effectError({ kind: 'mortalWounds', on: 4, perSuccess: '0' })).toBe('Mortal wounds per success must be a number or dice like D3');
    expect(effectError({ kind: 'mortalWounds', on: 4, perSuccess: 'D7' })).toBe('Mortal wounds per success must be a number or dice like D3');
    expect(effectError({ kind: 'mortalWounds', on: 4, perSuccess: '2D6+1' })).toMatch(/at most 12/);
  });

  it('allows descriptions of up to 2000 characters', () => {
    expect(validateAbility(ability({ description: 'x'.repeat(2000) }))).toEqual({});
    expect(validateAbility(ability({ description: 'x'.repeat(2001) })).description).toMatch(/at most 2000/);
  });

  it('flags invalid and duplicate abilities of a unit', () => {
    expect(validateAbilities([ability(), ability({ id: 'a2', name: 'SHOCK assault' })])).toMatch(/Two abilities/);
    expect(validateUnit({ ...unit, abilities: [ability({ effects: [] })] }).abilities).toMatch(/^Shock Assault: Add at least one effect/);
  });
});

describe('validateAttackerModels', () => {
  it('keeps the attacker models a whole number between 1 and 40', () => {
    expect(validateAttackerModels(1)).toBeUndefined();
    expect(validateAttackerModels(40)).toBeUndefined();
    expect(validateAttackerModels(0)).toMatch(/between 1 and 40/);
    expect(validateAttackerModels(41)).toMatch(/between 1 and 40/);
    expect(validateAttackerModels(2.5)).toMatch(/whole number/);
    expect(validateAttackerModels(Number.NaN)).toMatch(/whole number/);
  });
});
