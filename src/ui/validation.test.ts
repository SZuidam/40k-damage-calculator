import { describe, expect, it } from 'vitest';
import { noAbilities, type StoredWeapon, type WeaponStats } from '../types';
import { abilityValueError, antiValueError, validateRow, validateWeaponStats } from './validation';

const stats: WeaponStats = { name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() };
const library: StoredWeapon[] = [
  { ...stats, id: 'w-ok' },
  { ...stats, id: 'w-bad', name: 'Broken', attacks: 'D7' },
];

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
    const errors = validateWeaponStats({ name: 'X', attacks: '', skill: 7, strength: 31, ap: 1, damage: '2D', abilities });
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

describe('validateRow', () => {
  it('accepts a row with valid models and a valid weapon', () => {
    expect(validateRow({ id: 'r', models: 10, weaponId: 'w-ok' }, library)).toEqual({});
  });

  it('requires a weapon to be chosen', () => {
    expect(validateRow({ id: 'r', models: 1, weaponId: null }, library).weaponId).toBe('Choose a weapon');
  });

  it('flags a missing or invalid weapon', () => {
    expect(validateRow({ id: 'r', models: 1, weaponId: 'gone' }, library).weaponId).toMatch(/not found/);
    expect(validateRow({ id: 'r', models: 1, weaponId: 'w-bad' }, library).weaponId).toMatch(/Broken/);
  });

  it('keeps the models limits', () => {
    expect(validateRow({ id: 'r', models: 0, weaponId: 'w-ok' }, library).models).toBeDefined();
    expect(validateRow({ id: 'r', models: 51, weaponId: 'w-ok' }, library).models).toBeDefined();
    expect(validateRow({ id: 'r', models: 1.5, weaponId: 'w-ok' }, library).models).toBeDefined();
    expect(validateRow({ id: 'r', models: 50, weaponId: 'w-ok' }, library)).toEqual({});
  });
});
