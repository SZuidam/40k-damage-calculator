import { describe, expect, it } from 'vitest';
import { noAbilities, type StoredWeapon, type WeaponStats } from '../types';
import { validateRow, validateWeaponStats } from './validation';

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
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), blast: 2, cleave: 10 } })).toEqual({});
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), blast: 0 } }).abilities).toBe('Blast must be between 1 and 10');
    expect(validateWeaponStats({ ...stats, abilities: { ...noAbilities(), cleave: 11 } }).abilities).toBe('Cleave must be between 1 and 10');
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
