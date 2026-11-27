import { describe, expect, it } from 'vitest';
import { noAbilities, type WeaponAbilities } from '../types';
import {
  IMPOSSIBLE,
  abilitiesAgainst,
  antiCriticalWound,
  attacksPerModel,
  bonusAttacks,
  bonusDamage,
  createAttackContext,
  damageDistribution,
  damagePerWound,
  damageRerollBelow,
  damageRollDistribution,
  hitChance,
  hitRollFaces,
  hitSucceeds,
  isCriticalHit,
  isMonsterOrVehicle,
  isCriticalWound,
  rollSucceeds,
  saveChance,
  saveTarget,
  unsavedDistribution,
  unsavedPerAttack,
  unsavedPerWoundRoll,
  woundChance,
  woundRollFaces,
  woundTarget,
} from './rules';
import { defender, weapon } from './testFixtures';

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
  const ctx = createAttackContext(weapon('Bolt rifle', 10, '2', 3, 4, -1, '1'), { models: 10, toughness: 4, save: 3, invuln: null, wounds: 2, keywords: [] });

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
  const marines = { models: 10, toughness: 4, save: 3, invuln: null, wounds: 2, keywords: [] };
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
    expect(createAttackContext(gun({ blast: '1' }), unit(4)).bonusAttacks).toEqual([]);
    expect(createAttackContext(gun({ blast: '1' }), unit(5)).bonusAttacks).toEqual([{ count: 0, sides: 0, bonus: 1 }]);
    expect(createAttackContext(gun({ blast: '1' }), unit(14)).bonusAttacks).toEqual([{ count: 0, sides: 0, bonus: 2 }]);
    expect(createAttackContext(gun({ blast: '2' }), unit(10)).bonusAttacks).toEqual([{ count: 0, sides: 0, bonus: 4 }]);
    expect(bonusAttacks(gun({}), unit(20))).toEqual([]);
  });

  it('keeps the base attacks apart from the Blast extra attacks', () => {
    const ctx = createAttackContext(weapon('Gun', 3, 'D6', 3, 4, 0, '1', { blast: '1' }), { ...marines, models: 10 });
    expect(ctx.attacks).toEqual({ count: 1, sides: 6, bonus: 0 });
    expect(attacksPerModel(ctx)).toEqual([
      { count: 1, sides: 6, bonus: 0 },
      { count: 0, sides: 0, bonus: 2 },
    ]);
  });

  it('Blast with dice rolls X separately for every block of 5 models', () => {
    // Blast D6+2 into 10 models: two blocks, so 2D6+4 extra attacks per model.
    expect(bonusAttacks(weapon('Frag', 1, '1', 3, 4, 0, '1', { blast: 'D6+2' }), { ...marines, models: 10 })).toEqual([{ count: 2, sides: 6, bonus: 4 }]);
    expect(bonusAttacks(weapon('Frag', 1, '1', 3, 4, 0, '1', { blast: 'd3' }), { ...marines, models: 15 })).toEqual([{ count: 3, sides: 3, bonus: 0 }]);
  });

  it('Cleave X works the same as Blast X, and the two stack', () => {
    const unit = { ...marines, models: 10 };
    expect(bonusAttacks(weapon('Axe', 1, '2', 3, 4, 0, '1', { cleave: '1' }), unit)).toEqual([{ count: 0, sides: 0, bonus: 2 }]);
    expect(bonusAttacks(weapon('Axe', 1, '2', 3, 4, 0, '1', { blast: 'D3', cleave: '2' }), unit)).toEqual([
      { count: 2, sides: 3, bonus: 0 },
      { count: 0, sides: 0, bonus: 4 },
    ]);
  });

  it('supports a dice expression for Sustained Hits', () => {
    // E[D3] = 2 extra hits per critical hit
    expect(unsavedPerAttack(ctxWith({ sustainedHits: 'D3' }))).toBeCloseTo((4 / 6) * (1 / 6) + (1 / 6) * 2 * (1 / 6), 12);
  });
});

describe('Anti-X Y+', () => {
  const faces = [1, 2, 3, 4, 5, 6];
  // Sv 2+ with AP 0: a normal wound fails its save on a 1 only (1/6).
  const vehicle = defender(1, 8, 2, 12, null, ['vehicle']);
  const infantry = defender(1, 8, 2, 12, null, ['infantry']);
  const gun = (strength: number, abilities: Partial<WeaponAbilities>) => weapon('Gun', 1, '1', 3, strength, 0, '1', abilities);

  it('S4 vs T8 Vehicle with Anti-Vehicle 4+: wounds and is critical on 4+', () => {
    const ctx = createAttackContext(gun(4, { anti: { vehicle: 4 } }), vehicle);
    expect(ctx.woundTarget).toBe(6);
    expect(ctx.criticalWound).toBe(4);
    expect(woundChance(ctx)).toBeCloseTo(3 / 6);
    expect(faces.filter((r) => isCriticalWound(ctx, r))).toEqual([4, 5, 6]);
  });

  it('does nothing against a target without the keyword', () => {
    const ctx = createAttackContext(gun(4, { anti: { vehicle: 4 } }), infantry);
    expect(ctx.criticalWound).toBe(6);
    expect(woundChance(ctx)).toBeCloseTo(1 / 6);
    expect(faces.filter((r) => isCriticalWound(ctx, r))).toEqual([6]);
  });

  it('S8 vs T4 (2+) with Anti 4+: the wound chance stays 5/6, criticals are 4-6', () => {
    const ctx = createAttackContext(gun(8, { anti: { vehicle: 4 } }), { ...vehicle, toughness: 4 });
    expect(woundChance(ctx)).toBeCloseTo(5 / 6);
    expect(faces.filter((r) => isCriticalWound(ctx, r))).toEqual([4, 5, 6]);
  });

  it('an unmodified 1 still fails with Anti 2+', () => {
    const ctx = createAttackContext(gun(4, { anti: { vehicle: 2 } }), vehicle);
    expect(faces.filter((r) => isCriticalWound(ctx, r))).toEqual([2, 3, 4, 5, 6]);
    expect(woundChance(ctx)).toBeCloseTo(5 / 6);
  });

  it('uses the lowest Y when several Anti keywords match', () => {
    const both = defender(1, 8, 2, 12, null, ['vehicle', 'monster']);
    expect(antiCriticalWound({ anti: { vehicle: 4, monster: 2 } }, both.keywords)).toBe(2);
    expect(antiCriticalWound({ anti: { vehicle: 4, monster: 2 } }, ['vehicle'])).toBe(4);
    expect(antiCriticalWound({ anti: { psyker: 3 } }, both.keywords)).toBeNull();
    expect(antiCriticalWound({ anti: {} }, both.keywords)).toBeNull();
    expect(createAttackContext(gun(4, { anti: { vehicle: 5, monster: 3 } }), both).criticalWound).toBe(3);
  });

  it('with Devastating Wounds, a critical wound on Y+ skips the save', () => {
    // S4 vs T8: faces 4-6 are critical wounds, never saved.
    expect(unsavedPerWoundRoll(createAttackContext(gun(4, { anti: { vehicle: 4 }, devastatingWounds: true }), vehicle))).toBeCloseTo(3 / 6, 12);
    // Without Devastating Wounds they still have to get past the 2+ save.
    expect(unsavedPerWoundRoll(createAttackContext(gun(4, { anti: { vehicle: 4 } }), vehicle))).toBeCloseTo((3 / 6) * (1 / 6), 12);
    // Without the keyword only a 6 wounds, and it is the only critical wound.
    expect(unsavedPerWoundRoll(createAttackContext(gun(4, { anti: { vehicle: 4 }, devastatingWounds: true }), infantry))).toBeCloseTo(1 / 6, 12);
  });
});

describe('Rapid Fire X', () => {
  const marines = defender(10, 4, 3, 2);
  const rifle = (abilities: Partial<WeaponAbilities>, halfRange: boolean) => weapon('Rifle', 10, '2', 3, 4, -1, '1', abilities, { halfRange });

  it('adds X attacks per model only while the target is within half range', () => {
    expect(bonusAttacks(rifle({ rapidFire: '1' }, false), marines)).toEqual([]);
    expect(bonusAttacks(rifle({ rapidFire: '1' }, true), marines)).toEqual([{ count: 0, sides: 0, bonus: 1 }]);
    expect(attacksPerModel(createAttackContext(rifle({ rapidFire: '1' }, true), marines))).toEqual([
      { count: 0, sides: 0, bonus: 2 },
      { count: 0, sides: 0, bonus: 1 },
    ]);
  });

  it('rolls a dice X once per model, whatever the size of the target unit', () => {
    expect(bonusAttacks(rifle({ rapidFire: 'D3' }, true), { models: 1 })).toEqual([{ count: 1, sides: 3, bonus: 0 }]);
    expect(bonusAttacks(rifle({ rapidFire: 'D3' }, true), { models: 20 })).toEqual([{ count: 1, sides: 3, bonus: 0 }]);
  });

  it('stacks with Blast', () => {
    expect(bonusAttacks(rifle({ rapidFire: 'D3', blast: '1' }, true), marines)).toEqual([
      { count: 0, sides: 0, bonus: 2 },
      { count: 1, sides: 3, bonus: 0 },
    ]);
    expect(bonusAttacks(rifle({ rapidFire: 'D3', blast: '1' }, false), marines)).toEqual([{ count: 0, sides: 0, bonus: 2 }]);
  });
});

describe('Melta X', () => {
  const meltagun = (melta: string | null, halfRange: boolean) => weapon('Meltagun', 1, '1', 3, 9, -4, 'D6', { melta }, { halfRange });

  it('adds X to the damage only while the target is within half range', () => {
    expect(bonusDamage(meltagun('2', false))).toEqual([]);
    expect(bonusDamage(meltagun('2', true))).toEqual([{ count: 0, sides: 0, bonus: 2 }]);
    expect(bonusDamage(meltagun(null, true))).toEqual([]);
    expect(damagePerWound(createAttackContext(meltagun('2', true), defender(1, 10, 3, 12)))).toEqual([
      { count: 1, sides: 6, bonus: 0 },
      { count: 0, sides: 0, bonus: 2 },
    ]);
    expect(damagePerWound(createAttackContext(meltagun('2', false), defender(1, 10, 3, 12)))).toEqual([{ count: 1, sides: 6, bonus: 0 }]);
  });

  it('takes a dice expression for X', () => {
    expect(bonusDamage(meltagun('D3+1', true))).toEqual([{ count: 1, sides: 3, bonus: 1 }]);
  });

  it('changes neither the attacks nor the rolls', () => {
    const vehicle = defender(1, 10, 3, 12);
    const near = createAttackContext(meltagun('2', true), vehicle);
    const far = createAttackContext(meltagun('2', false), vehicle);
    expect(attacksPerModel(near)).toEqual(attacksPerModel(far));
    expect(unsavedDistribution(near)).toEqual(unsavedDistribution(far));
  });
});

describe('Lance', () => {
  const faces = [1, 2, 3, 4, 5, 6];
  const lance = (strength: number, charged: boolean, abilities: Partial<WeaponAbilities> = {}) =>
    weapon('Lance', 1, '1', 3, strength, 0, '1', { lance: true, ...abilities }, { charged });

  it('adds 1 to the wound roll only while the bearer charged', () => {
    const t4 = defender(1, 4, 3, 2);
    expect(createAttackContext(lance(4, false), t4).woundModifier).toBe(0);
    expect(createAttackContext(lance(4, true), t4).woundModifier).toBe(1);
    expect(createAttackContext(weapon('Spear', 1, '1', 3, 4, 0, '1', {}, { charged: true }), t4).woundModifier).toBe(0);
    // S4 vs T4: 4+ becomes 3+.
    expect(woundChance(createAttackContext(lance(4, false), t4))).toBeCloseTo(3 / 6);
    expect(woundChance(createAttackContext(lance(4, true), t4))).toBeCloseTo(4 / 6);
  });

  it('S4 vs T8: 6+ becomes 5+', () => {
    const t8 = defender(1, 8, 3, 2);
    expect(woundChance(createAttackContext(lance(4, false), t8))).toBeCloseTo(1 / 6);
    expect(woundChance(createAttackContext(lance(4, true), t8))).toBeCloseTo(2 / 6);
  });

  it('an unmodified 1 still fails on a 2+ wound roll', () => {
    const ctx = createAttackContext(lance(8, true), defender(1, 4, 3, 2));
    expect(ctx.woundTarget).toBe(2);
    expect(woundChance(ctx)).toBeCloseTo(5 / 6);
  });

  it('with Devastating Wounds, only unmodified 6s skip the save', () => {
    const ctx = createAttackContext(lance(4, true, { devastatingWounds: true }), defender(1, 4, 2, 2));
    expect(faces.filter((r) => isCriticalWound(ctx, r))).toEqual([6]);
    // 3-5 wound and fail the 2+ save on a 1; a 6 is never saved.
    expect(unsavedPerWoundRoll(ctx)).toBeCloseTo((3 / 6) * (1 / 6) + 1 / 6, 12);
  });

  it('works together with Anti-X Y+', () => {
    // S4 vs T8 Vehicle with Anti-Vehicle 4+: 5+ from Lance, but 4+ is a critical wound anyway.
    const vehicle = defender(1, 8, 2, 12, null, ['vehicle']);
    const ctx = createAttackContext(lance(4, true, { anti: { vehicle: 4 } }), vehicle);
    expect(woundChance(ctx)).toBeCloseTo(3 / 6);
    expect(faces.filter((r) => isCriticalWound(ctx, r))).toEqual([4, 5, 6]);
    // Anti-Vehicle 6+ (the default) with Lance: 5+ wounds, only a 6 is critical.
    const ctx6 = createAttackContext(lance(4, true, { anti: { vehicle: 6 } }), vehicle);
    expect(woundChance(ctx6)).toBeCloseTo(2 / 6);
    expect(faces.filter((r) => isCriticalWound(ctx6, r))).toEqual([6]);
  });
});

describe('Twin-linked', () => {
  const faces = [1, 2, 3, 4, 5, 6];
  const twin = (strength: number, abilities: Partial<WeaponAbilities> = {}, charged = false) =>
    weapon('Twin', 1, '1', 3, strength, 0, '1', { twinLinked: true, ...abilities }, { charged });

  it('re-rolls a failed wound roll once: P = p + (1 - p) · p', () => {
    for (const [toughness, p] of [
      [2, 5 / 6],
      [3, 4 / 6],
      [4, 3 / 6],
      [5, 2 / 6],
      [8, 1 / 6],
    ]) {
      const ctx = createAttackContext(twin(4), defender(1, toughness, 3, 2));
      expect(ctx.rerollWounds).toBe('failed');
      expect(woundChance(ctx)).toBeCloseTo(p + (1 - p) * p, 12);
    }
    expect(createAttackContext(weapon('Single', 1, '1', 3, 4, 0, '1'), defender(1, 4, 3, 2)).rerollWounds).toBe('none');
  });

  it('only failed faces are re-rolled, and the final faces sum to 1', () => {
    // S4 vs T4: 1-3 fail (1/2), so every face gains 1/12 and 4-6 keep their first 1/6.
    const ctx = createAttackContext(twin(4), defender(1, 4, 3, 2));
    const final = woundRollFaces(ctx);
    [1, 2, 3].forEach((f) => expect(final[f - 1]).toBeCloseTo(1 / 12, 12));
    [4, 5, 6].forEach((f) => expect(final[f - 1]).toBeCloseTo(1 / 6 + 1 / 12, 12));
    expect(final.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    // Without Twin-linked every face is 1/6.
    expect(woundRollFaces(createAttackContext(weapon('Single', 1, '1', 3, 4, 0, '1'), defender(1, 4, 3, 2)))).toEqual(new Array(6).fill(1 / 6));
  });

  it('a re-rolled 6 is a critical wound for Devastating Wounds', () => {
    // S4 vs T8 (6+), Sv 2+: every wound is a 6, unsaved; 6 on the first roll or on the re-roll.
    const ctx = createAttackContext(twin(4, { devastatingWounds: true }), defender(1, 8, 2, 2));
    expect(faces.filter((r) => isCriticalWound(ctx, r))).toEqual([6]);
    expect(unsavedPerWoundRoll(ctx)).toBeCloseTo(1 / 6 + (5 / 6) * (1 / 6), 12);
  });

  it('re-rolls against the Anti-X Y+ critical threshold', () => {
    // S4 vs T8 Vehicle with Anti-Vehicle 4+: 4+ wounds, a failed 1-3 is re-rolled.
    const ctx = createAttackContext(twin(4, { anti: { vehicle: 4 } }), defender(1, 8, 2, 12, null, ['vehicle']));
    expect(woundChance(ctx)).toBeCloseTo(3 / 6 + (3 / 6) * (3 / 6), 12);
  });

  it('re-rolls with the Lance modifier applied', () => {
    // S4 vs T4 after a charge: 3+, so a 1-2 is re-rolled.
    const ctx = createAttackContext(twin(4, { lance: true }, true), defender(1, 4, 3, 2));
    expect(woundChance(ctx)).toBeCloseTo(4 / 6 + (2 / 6) * (4 / 6), 12);
  });

  it('Lethal Hits auto-wounds make no wound roll; only normal hits benefit', () => {
    // BS 3+, S4 vs T4, no save: normal hits (3/6) wound on 4+ with a re-roll (3/4), critical hits (1/6) always.
    const ctx = createAttackContext(twin(4, { lethalHits: true }), defender(1, 4, 7, 2));
    expect(unsavedPerAttack(ctx)).toBeCloseTo((3 / 6) * (3 / 4) + 1 / 6, 12);
  });
});

describe('roll modifiers from abilities', () => {
  const faces = [1, 2, 3, 4, 5, 6];
  const target = defender(1, 4, 7, 2);
  const ctxOf = (skill: number, modifiers: Parameters<typeof weapon>[9], abilities: Partial<WeaponAbilities> = {}, strength = 4, d = target) =>
    createAttackContext(weapon('W', 1, '1', skill, strength, 0, '1', abilities, {}, modifiers), d);

  it('+1 to hit moves the roll against BS, but critical hits stay on an unmodified 6', () => {
    const ctx = ctxOf(4, { hit: 1 });
    expect(faces.filter((r) => hitSucceeds(ctx, r))).toEqual([3, 4, 5, 6]);
    expect(faces.filter((r) => isCriticalHit(ctx, r))).toEqual([6]);
    expect(hitChance(ctx)).toBeCloseTo(4 / 6, 12);
  });

  it('caps the summed hit modifier at -1 / +1, and an unmodified 6 always hits', () => {
    expect(ctxOf(4, { hit: 3 }).hitModifier).toBe(1);
    const ctx = ctxOf(6, { hit: -2 });
    expect(ctx.hitModifier).toBe(-1);
    expect(faces.filter((r) => hitSucceeds(ctx, r))).toEqual([6]);
  });

  it('an unmodified 1 always fails, even at +1 to hit on 2+', () => {
    expect(hitSucceeds(ctxOf(2, { hit: 1 }), 1)).toBe(false);
  });

  it('adds the wound modifier to Lance and caps the sum', () => {
    const charged = (modifiers: Parameters<typeof weapon>[9]) => createAttackContext(weapon('W', 1, '1', 3, 4, 0, '1', { lance: true }, { charged: true }, modifiers), target);
    expect(charged({ wound: 1 }).woundModifier).toBe(1);
    expect(charged({ wound: -1 }).woundModifier).toBe(0);
    expect(ctxOf(3, { wound: 1 }).woundModifier).toBe(1);
  });

  it('critical hits on 5+: always hit and trigger Sustained Hits', () => {
    const ctx = ctxOf(3, { criticalHit: 5 }, { sustainedHits: '1' });
    expect(faces.filter((r) => isCriticalHit(ctx, r))).toEqual([5, 6]);
    // Normal hits 3-4 (2/6) wound on 4+ (1/2); critical hits 5-6 (2/6) score 2 hits each.
    expect(unsavedPerAttack(ctx)).toBeCloseTo((2 / 6) * (1 / 2) + (2 / 6) * 2 * (1 / 2), 12);
    // A critical hit on 5+ hits even with BS 6+.
    expect(faces.filter((r) => hitSucceeds(ctxOf(6, { criticalHit: 5 }), r))).toEqual([5, 6]);
  });

  it('critical wounds on 5+ wound whatever S vs T says; the lowest of Anti and the ability counts', () => {
    const ctx = ctxOf(3, { criticalWound: 5 }, {}, 4, defender(1, 8, 7, 2));
    expect(woundChance(ctx)).toBeCloseTo(2 / 6, 12);
    expect(ctxOf(3, { criticalWound: 5 }, { anti: { vehicle: 4 } }, 4, defender(1, 8, 7, 2, null, ['vehicle'])).criticalWound).toBe(4);
    expect(ctxOf(3, { criticalWound: 3 }, { anti: { vehicle: 4 } }, 4, defender(1, 8, 7, 2, null, ['vehicle'])).criticalWound).toBe(3);
    // Unusable thresholds fall back to 6.
    expect(ctxOf(3, { criticalWound: 1, criticalHit: 9 })).toMatchObject({ criticalWound: 6, criticalHit: 6 });
  });

  it('re-rolling hits of 1 re-rolls only face 1: 3+ hits 2/3 + 1/6 · 2/3', () => {
    const ctx = ctxOf(3, { rerollHits: 'ones' });
    const final = hitRollFaces(ctx);
    expect(final[0]).toBeCloseTo(1 / 36, 12);
    [2, 3, 4, 5, 6].forEach((f) => expect(final[f - 1]).toBeCloseTo(1 / 6 + 1 / 36, 12));
    expect(final.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(hitChance(ctx)).toBeCloseTo(2 / 3 + (1 / 6) * (2 / 3), 12);
  });

  it('re-rolling failed hits: 3+ hits 2/3 + 1/3 · 2/3, and the faces sum to 1', () => {
    const ctx = ctxOf(3, { rerollHits: 'failed' });
    expect(hitChance(ctx)).toBeCloseTo(2 / 3 + (1 / 3) * (2 / 3), 12);
    expect(hitRollFaces(ctx).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(hitRollFaces(ctxOf(3, {}))).toEqual(new Array(6).fill(1 / 6));
  });

  it('re-rolled hits feed Sustained and Lethal Hits through the hit faces', () => {
    // BS 3+, S4 vs T4, no save, re-roll failed hits; Lethal Hits: a 6 wounds automatically.
    const ctx = ctxOf(3, { rerollHits: 'failed' }, { lethalHits: true });
    const final = hitRollFaces(ctx);
    const normal = final[2] + final[3] + final[4];
    expect(unsavedPerAttack(ctx)).toBeCloseTo(normal * (1 / 2) + final[5], 12);
  });

  it('re-rolling wounds of 1, and Twin-linked wins over it', () => {
    expect(woundChance(ctxOf(3, { rerollWounds: 'ones' }))).toBeCloseTo(3 / 6 + (1 / 6) * (3 / 6), 12);
    expect(ctxOf(3, { rerollWounds: 'ones' }, { twinLinked: true }).rerollWounds).toBe('failed');
    expect(ctxOf(3, { rerollWounds: 'failed' }).rerollWounds).toBe('failed');
  });
});

describe('Torrent', () => {
  const target = defender(1, 4, 7, 2);
  const ctxOf = (modifiers: Parameters<typeof weapon>[9] = {}, abilities: Partial<WeaponAbilities> = {}) =>
    createAttackContext(weapon('Flamer', 1, 'D6', 6, 4, 0, '1', { torrent: true, ...abilities }, {}, modifiers), target);

  it('hits on every face, whatever BS says, and never scores a critical hit', () => {
    const ctx = ctxOf();
    for (let roll = 1; roll <= 6; roll++) {
      expect(hitSucceeds(ctx, roll)).toBe(true);
      expect(isCriticalHit(ctx, roll)).toBe(false);
    }
    expect(hitChance(ctx)).toBeCloseTo(1, 12);
  });

  it('ignores hit modifiers, hit re-rolls and lower critical hits', () => {
    const ctx = ctxOf({ hit: -1, rerollHits: 'ones', criticalHit: 2 });
    expect(ctx).toMatchObject({ hitModifier: 0, rerollHits: 'none' });
    expect(hitRollFaces(ctx)).toEqual(new Array(6).fill(1 / 6));
    expect(hitChance(ctx)).toBeCloseTo(1, 12);
    expect([1, 2, 3, 4, 5, 6].some((roll) => isCriticalHit(ctx, roll))).toBe(false);
  });

  it('never triggers Lethal Hits or Sustained Hits: every attack rolls to wound once', () => {
    // S4 vs T4 wounds on 4+, no save.
    const ctx = ctxOf({}, { lethalHits: true, sustainedHits: '2' });
    const pmf = unsavedDistribution(ctx);
    expect(pmf).toHaveLength(2);
    expect(pmf[1]).toBeCloseTo(1 / 2, 12);
    expect(unsavedPerAttack(ctx)).toBeCloseTo(1 / 2, 12);
  });
});

describe('re-roll damage', () => {
  const target = defender(1, 4, 7, 20);
  const ctxOf = (damage: string, below: number, abilities: Partial<WeaponAbilities> = {}, halfRange = false) =>
    createAttackContext(weapon('Gun', 1, '1', 3, 4, 0, damage, abilities, { halfRange }, { rerollDamageBelow: below }), target);

  it('picks the D3 or D6 threshold by the dice of D, and none for fixed damage', () => {
    const thresholds = { d3: 2, d6: 4 };
    expect(damageRerollBelow('D3', thresholds)).toBe(2);
    expect(damageRerollBelow('D3+1', thresholds)).toBe(2);
    expect(damageRerollBelow('2D6', thresholds)).toBe(4);
    expect(damageRerollBelow('3', thresholds)).toBe(0);
    expect(damageRerollBelow('nonsense', thresholds)).toBe(0);
  });

  it('D6 below 4: faces 1–3 are re-rolled, so the average rises from 3.5 to 4.25', () => {
    const pmf = damageRollDistribution(ctxOf('D6', 4));
    [1, 2, 3].forEach((v) => expect(pmf[v]).toBeCloseTo(1 / 12, 12));
    [4, 5, 6].forEach((v) => expect(pmf[v]).toBeCloseTo(1 / 4, 12));
    expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(pmf.reduce((sum, p, v) => sum + p * v, 0)).toBeCloseTo(4.25, 12);
  });

  it('compares only the dice: D3+1 below 3 re-rolls a die of 1 or 2 (a total of 2 or 3)', () => {
    const pmf = damageRollDistribution(ctxOf('D3+1', 3));
    expect(pmf[2]).toBeCloseTo(2 / 9, 12);
    expect(pmf[3]).toBeCloseTo(2 / 9, 12);
    expect(pmf[4]).toBeCloseTo(1 / 3 + 2 / 9, 12);
    // D6+2 below 4 re-rolls dice of 1–3, as D6 does: the average rises from 5.5 to 6.25.
    expect(damageRollDistribution(ctxOf('D6+2', 4)).reduce((sum, p, v) => sum + p * v, 0)).toBeCloseTo(6.25, 12);
    // 2D6 below 4 re-rolls dice totalling 2 or 3 (3/36).
    const twoD6 = damageRollDistribution(ctxOf('2D6', 4));
    expect(twoD6[2] + twoD6[3]).toBeCloseTo((3 / 36) * (3 / 36), 12);
  });

  it('leaves fixed damage and a threshold of 0 alone', () => {
    expect(ctxOf('2', 4).rerollDamageBelow).toBe(0);
    expect(damageRollDistribution(ctxOf('D6', 0))).toEqual(damageRollDistribution(ctxOf('D6', 1)));
    expect(damageDistribution(ctxOf('D6', 0)).reduce((sum, p, v) => sum + p * v, 0)).toBeCloseTo(3.5, 12);
  });

  it('adds Melta after the re-roll', () => {
    const ctx = ctxOf('D6', 4, { melta: '2' }, true);
    expect(damagePerWound(ctx)).toHaveLength(2);
    expect(damageDistribution(ctx).reduce((sum, p, v) => sum + p * v, 0)).toBeCloseTo(6.25, 12);
  });
});

describe('abilities limited to non-Monster / non-Vehicle targets', () => {
  const limited: WeaponAbilities = { ...noAbilities(), lethalHits: true, sustainedHits: '2', devastatingWounds: true, notVsMonsterVehicle: ['sustainedHits', 'devastatingWounds'] };

  it('a target is a Monster or Vehicle by either keyword; no target is neither', () => {
    expect(isMonsterOrVehicle(['monster'])).toBe(true);
    expect(isMonsterOrVehicle(['infantry', 'vehicle'])).toBe(true);
    expect(isMonsterOrVehicle(['infantry', 'fly'])).toBe(false);
    expect(isMonsterOrVehicle([])).toBe(false);
    expect(isMonsterOrVehicle(null)).toBe(false);
  });

  it('drops the limited abilities against a Monster or Vehicle, and keeps them otherwise', () => {
    expect(abilitiesAgainst(limited, ['monster'])).toEqual({ ...noAbilities(), lethalHits: true });
    expect(abilitiesAgainst(limited, ['vehicle', 'fly'])).toEqual({ ...noAbilities(), lethalHits: true });
    expect(abilitiesAgainst(limited, ['infantry'])).toEqual(limited);
    expect(abilitiesAgainst(limited, null)).toEqual(limited);
    expect(limited.notVsMonsterVehicle).toEqual(['sustainedHits', 'devastatingWounds']);
  });

  it('only drops the abilities that are limited', () => {
    const one: WeaponAbilities = { ...limited, notVsMonsterVehicle: ['devastatingWounds'] };
    expect(abilitiesAgainst(one, ['monster'])).toEqual({ ...noAbilities(), lethalHits: true, sustainedHits: '2' });
    const none: WeaponAbilities = { ...limited, notVsMonsterVehicle: [] };
    expect(abilitiesAgainst(none, ['monster'])).toEqual(none);
  });

  it('the attack context leaves them out against a Monster or Vehicle', () => {
    const w = weapon('Talons', 5, '2', 3, 5, -1, '1', limited);
    const vsMonster = createAttackContext(w, defender(1, 10, 2, 12, null, ['monster']));
    expect([vsMonster.sustainedHits, vsMonster.devastatingWounds, vsMonster.lethalHits]).toEqual([null, false, true]);
    const vsInfantry = createAttackContext(w, defender(10, 3, 5, 1, null, ['infantry']));
    expect(vsInfantry.sustainedHits).toEqual({ count: 0, sides: 0, bonus: 2 });
    expect(vsInfantry.devastatingWounds).toBe(true);
  });
});
