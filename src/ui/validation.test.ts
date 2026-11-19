import { describe, expect, it } from 'vitest';
import type { StoredWeapon, WeaponStats } from '../types';
import { validateRow, validateWeaponStats } from './validation';

const stats: WeaponStats = { name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1' };
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
    const errors = validateWeaponStats({ name: 'X', attacks: '', skill: 7, strength: 31, ap: 1, damage: '2D' });
    expect(Object.keys(errors).sort()).toEqual(['ap', 'attacks', 'damage', 'skill', 'strength']);
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
