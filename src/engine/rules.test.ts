import { describe, expect, it } from 'vitest';
import { IMPOSSIBLE, createAttackContext, hitChance, rollSucceeds, saveChance, saveTarget, unsavedChance, woundChance, woundTarget } from './rules';

describe('woundTarget', () => {
  it.each([
    // S >= 2T → 2+
    [8, 4, 2],
    [10, 5, 2],
    [10, 4, 2],
    // S > T → 3+
    [5, 4, 3],
    [9, 5, 3],
    // S = T → 4+
    [4, 4, 4],
    // S < T → 5+
    [4, 5, 5],
    [4, 7, 5],
    // T >= 2S → 6+
    [3, 6, 6],
    [3, 7, 6],
    [4, 8, 6],
  ])('S%i vs T%i wounds on %i+', (s, t, expected) => {
    expect(woundTarget(s, t)).toBe(expected);
  });
});

describe('saveTarget', () => {
  it('adds AP to the armour save', () => expect(saveTarget(3, -2, null)).toBe(5));
  it('treats AP 0 as no modifier', () => expect(saveTarget(3, 0, null)).toBe(3));
  it('fails automatically when the armour target goes above 6', () => expect(saveTarget(4, -3, null)).toBe(IMPOSSIBLE));
  it('uses the invulnerable save when it is better', () => expect(saveTarget(2, -4, 4)).toBe(4));
  it('keeps the armour save when it is better than the invulnerable', () => expect(saveTarget(2, -1, 4)).toBe(3));
  it('fails automatically without any save', () => expect(saveTarget(7, 0, null)).toBe(IMPOSSIBLE));
  it('still allows an invulnerable save without an armour save', () => expect(saveTarget(7, -2, 5)).toBe(5));
});

describe('rollSucceeds', () => {
  it('fails on an unmodified 1 even with a 1+ target', () => expect(rollSucceeds(1, 1)).toBe(false));
  it('succeeds on target or higher', () => {
    expect(rollSucceeds(3, 3)).toBe(true);
    expect(rollSucceeds(2, 3)).toBe(false);
  });
  it('never succeeds on an impossible target', () => expect(rollSucceeds(6, IMPOSSIBLE)).toBe(false));
});

describe('step chances', () => {
  const ctx = createAttackContext(
    { id: 'a', name: 'Bolt rifle', models: 10, attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1' },
    { models: 10, toughness: 4, save: 3, invuln: null, wounds: 2 },
  );

  it('computes each step from the six die faces', () => {
    expect(hitChance(ctx)).toBeCloseTo(4 / 6);
    expect(woundChance(ctx)).toBeCloseTo(3 / 6);
    expect(saveChance(ctx)).toBeCloseTo(3 / 6);
    expect(unsavedChance(ctx)).toBeCloseTo((4 / 6) * (3 / 6) * (3 / 6));
  });
});
