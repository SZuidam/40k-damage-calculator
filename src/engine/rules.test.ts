import { describe, expect, it } from 'vitest';
import type { WeaponAbilities } from '../types';
import {
  IMPOSSIBLE,
  bonusAttacks,
  createAttackContext,
  hitChance,
  isCriticalHit,
  isCriticalWound,
  rollSucceeds,
  saveChance,
  saveTarget,
  unsavedDistribution,
  unsavedPerAttack,
  woundChance,
  woundTarget,
} from './rules';
import { weapon } from './testFixtures';

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
  const ctx = createAttackContext(weapon('Bolt rifle', 10, '2', 3, 4, -1, '1'), { models: 10, toughness: 4, save: 3, invuln: null, wounds: 2 });

  it('computes each step from the six die faces', () => {
    expect(hitChance(ctx)).toBeCloseTo(4 / 6);
    expect(woundChance(ctx)).toBeCloseTo(3 / 6);
    expect(saveChance(ctx)).toBeCloseTo(3 / 6);
    const p = (4 / 6) * (3 / 6) * (3 / 6);
    const pmf = unsavedDistribution(ctx);
    expect(pmf).toHaveLength(2);
    expect(pmf[0]).toBeCloseTo(1 - p, 12);
    expect(pmf[1]).toBeCloseTo(p, 12);
  });
});

describe('abilities', () => {
  // BS 3+, S4 vs T4 (4+), Sv 3+ with AP 0: a hit that rolls to wound is unsaved with q = 1/2 · 1/3 = 1/6.
  const marines = { models: 10, toughness: 4, save: 3, invuln: null, wounds: 2 };
  const ctxWith = (abilities: Partial<WeaponAbilities>) => createAttackContext(weapon('Gun', 1, '1', 3, 4, 0, '1', abilities), marines);

  it('treats only a successful unmodified 6 as critical', () => {
    const ctx = ctxWith({});
    expect([1, 2, 3, 4, 5, 6].filter((r) => isCriticalHit(ctx, r))).toEqual([6]);
    expect([1, 2, 3, 4, 5, 6].filter((r) => isCriticalWound(ctx, r))).toEqual([6]);
  });

  it('Lethal Hits: a critical hit skips the wound roll', () => {
    // 3 normal hit faces · 1/6 + 1 critical face · P(save fails) 1/3
    expect(unsavedPerAttack(ctxWith({ lethalHits: true }))).toBeCloseTo((3 / 6) * (1 / 6) + (1 / 6) * (1 / 3), 12);
    expect(unsavedPerAttack(ctxWith({}))).toBeCloseTo((4 / 6) * (1 / 6), 12);
  });

  it('Devastating Wounds: a critical wound skips the save', () => {
    // wound faces 4 and 5 → unsaved 1/3; face 6 → always unsaved
    const q = (2 / 6) * (1 / 3) + 1 / 6;
    expect(unsavedPerAttack(ctxWith({ devastatingWounds: true }))).toBeCloseTo((4 / 6) * q, 12);
  });

  it('Lethal Hits auto-wounds are not critical wounds, so Devastating Wounds does not trigger on them', () => {
    const q = (2 / 6) * (1 / 3) + 1 / 6;
    const expected = (3 / 6) * q + (1 / 6) * (1 / 3);
    expect(unsavedPerAttack(ctxWith({ lethalHits: true, devastatingWounds: true }))).toBeCloseTo(expected, 12);
  });

  it('Sustained Hits 1: a critical hit adds one hit that rolls to wound', () => {
    const pmf = unsavedDistribution(ctxWith({ sustainedHits: '1' }));
    // A critical hit gives two independent q = 1/6 chances: P(2) = 1/6 · 1/36.
    expect(pmf).toHaveLength(3);
    expect(pmf[2]).toBeCloseTo(1 / 216, 12);
    expect(pmf[1]).toBeCloseTo((3 / 6) * (1 / 6) + (1 / 6) * (10 / 36), 12);
    expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(unsavedPerAttack(ctxWith({ sustainedHits: '1' }))).toBeCloseTo((5 / 6) * (1 / 6), 12);
  });

  it('Sustained Hits 2 with Lethal Hits: the critical hit auto-wounds and both extra hits roll to wound', () => {
    const mean = unsavedPerAttack(ctxWith({ sustainedHits: '2', lethalHits: true }));
    expect(mean).toBeCloseTo((3 / 6) * (1 / 6) + (1 / 6) * (1 / 3 + 2 * (1 / 6)), 12);
  });

  it('Blast X: X extra attacks per model for every 5 models in the target unit, rounded down', () => {
    const gun = (abilities: Partial<WeaponAbilities>) => weapon('Gun', 3, 'D6', 3, 4, 0, '1', abilities);
    const unit = (models: number) => ({ ...marines, models });
    expect(createAttackContext(gun({ blast: 1 }), unit(4)).attacks).toEqual({ count: 1, sides: 6, bonus: 0 });
    expect(createAttackContext(gun({ blast: 1 }), unit(5)).attacks).toEqual({ count: 1, sides: 6, bonus: 1 });
    expect(createAttackContext(gun({ blast: 1 }), unit(14)).bonusAttacks).toBe(2);
    expect(createAttackContext(gun({ blast: 2 }), unit(10)).attacks.bonus).toBe(4);
    expect(bonusAttacks(gun({}), unit(20))).toBe(0);
  });

  it('Cleave X works the same as Blast X, and the two add up', () => {
    const unit = { ...marines, models: 10 };
    expect(bonusAttacks(weapon('Axe', 1, '2', 3, 4, 0, '1', { cleave: 1 }), unit)).toBe(2);
    expect(bonusAttacks(weapon('Axe', 1, '2', 3, 4, 0, '1', { blast: 1, cleave: 2 }), unit)).toBe(6);
  });

  it('supports a dice expression for Sustained Hits', () => {
    // E[D3] = 2 extra hits per critical hit
    expect(unsavedPerAttack(ctxWith({ sustainedHits: 'D3' }))).toBeCloseTo((4 / 6) * (1 / 6) + (1 / 6) * 2 * (1 / 6), 12);
  });
});
