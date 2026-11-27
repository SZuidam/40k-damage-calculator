import { describe, expect, it } from 'vitest';
import { exactResult, mortalKernel, weaponKernel } from './exact';
import { boltRifles, defender, gravis, heavyBolter, lascannon, mortal, multiMelta, weapon } from './testFixtures';

describe('weaponKernel', () => {
  it('gives a binomial unsaved-wound count for fixed attacks', () => {
    // 20 attacks, p = 4/6 · 3/6 · 3/6 = 1/6
    const kernel = weaponKernel(weapon('Bolt rifles', 10, '2', 3, 4, -1, '1'), defender(10, 4, 3, 2));
    const total = kernel.unsaved.reduce((a, b) => a + b, 0);
    const mean = kernel.unsaved.reduce((sum, p, k) => sum + p * k, 0);
    expect(total).toBeCloseTo(1, 12);
    expect(mean).toBeCloseTo(20 / 6, 10);
    expect(kernel.tail[0]).toBeCloseTo(1, 12);
  });

  it('handles random attack counts', () => {
    // E[attacks] = 2 · 3.5 = 7; hit on 2+ (5/6), wound on 4+ (1/2), no save. 20 wounds > 12 attacks: no cap.
    const kernel = weaponKernel(weapon('Flamer', 2, 'D6', 2, 4, 0, '1'), defender(20, 4, 7, 1));
    const mean = kernel.unsaved.reduce((sum, p, k) => sum + p * k, 0);
    expect(mean).toBeCloseTo(7 * (5 / 6) * (1 / 2), 10);
  });

  it('lumps unsaved wounds at or above models × wounds into the last entry', () => {
    // 10 attacks into 1×W2 (cap 2); each is unsaved with p = 5/6 · 5/6 (Sv 3+ with AP -6 always fails)
    const kernel = weaponKernel(weapon('Overkill', 10, '1', 2, 20, -6, '1'), defender(1, 4, 3, 2));
    const p = 25 / 36;
    expect(kernel.unsaved).toHaveLength(3);
    expect(kernel.unsaved[2]).toBeCloseTo(1 - (1 - p) ** 10 - 10 * p * (1 - p) ** 9, 12);
    expect(kernel.unsaved.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('includes Sustained Hits extra wounds', () => {
    // 6 attacks; E[unsaved per attack] = 5/6 · 1/6 (see rules.test.ts)
    const kernel = weaponKernel(weapon('Gun', 6, '1', 3, 4, 0, '1', { sustainedHits: '1' }), defender(20, 4, 3, 1));
    const mean = kernel.unsaved.reduce((sum, p, k) => sum + p * k, 0);
    expect(kernel.unsaved).toHaveLength(13);
    expect(mean).toBeCloseTo(6 * (5 / 6) * (1 / 6), 12);
  });
});

describe('exactResult', () => {
  it('matches a hand calculation for a single shot', () => {
    // 1 attack, P(unsaved) = 4/6 · 5/6 · 1 (no save); D6 vs W3 kills on 3+ → 4/6
    const result = exactResult([weapon('Gun', 1, '1', 3, 8, 0, 'D6')], defender(2, 4, 7, 3));
    const pUnsaved = (4 / 6) * (5 / 6);
    expect(result.expectedModelsDestroyed).toBeCloseTo(pUnsaved * (4 / 6), 12);
    // damage applied = min(D6, 3): E = (1+2+3+3+3+3)/6 = 15/6
    expect(result.expectedDamage).toBeCloseTo(pUnsaved * (15 / 6), 12);
    expect(result.killDistribution.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('stops applying damage once every model is destroyed', () => {
    const result = exactResult([weapon('Overkill', 20, '10', 2, 20, -6, '6')], defender(3, 4, 3, 2));
    expect(result.expectedModelsDestroyed).toBeCloseTo(3, 6);
    expect(result.expectedDamage).toBeCloseTo(6, 6);
    expect(result.killDistribution[3]).toBeCloseTo(1, 6);
  });

  it('does not depend on order for two weapons (kill count is reversal-symmetric)', () => {
    const ab = exactResult([boltRifles, lascannon], gravis);
    const ba = exactResult([lascannon, boltRifles], gravis);
    expect(ab.expectedModelsDestroyed).toBeCloseTo(ba.expectedModelsDestroyed, 10);
  });

  it('depends on order for three weapons', () => {
    const a = exactResult([boltRifles, lascannon, heavyBolter], gravis);
    const b = exactResult([lascannon, boltRifles, heavyBolter], gravis);
    expect(b.expectedModelsDestroyed - a.expectedModelsDestroyed).toBeGreaterThan(0.05);
    // The reversed order is equivalent in expectation.
    const reversed = exactResult([heavyBolter, boltRifles, lascannon], gravis);
    expect(reversed.expectedModelsDestroyed).toBeCloseTo(b.expectedModelsDestroyed, 10);
  });

  it('handles a large unit', () => {
    const result = exactResult([multiMelta, boltRifles, heavyBolter], defender(20, 4, 3, 6));
    expect(result.killDistribution.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });
});

describe('mortal wounds', () => {
  const mean = (pmf: number[]) => pmf.reduce((sum, p, k) => sum + p * k, 0);

  it('gives dice × P(on+) × mean(per success) mortal wounds, each of damage 1', () => {
    const kernel = mortalKernel(mortal('Hammer of Wrath', 10, 4, '1'), defender(20, 4, 3, 1));
    expect(kernel.unsaved.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(mean(kernel.unsaved)).toBeCloseTo(10 * (3 / 6), 10);
    expect(kernel.damage).toEqual([0, 1]);
  });

  it('compounds a dice expression per success', () => {
    // 6 D6 at 5+: 2 successes on average, D3 (avg 2) each.
    const kernel = mortalKernel(mortal('Shock', 6, 5, 'D3'), defender(20, 4, 3, 2));
    expect(mean(kernel.unsaved)).toBeCloseTo(6 * (2 / 6) * 2, 10);
  });

  it('destroys 5 of 10 one-wound models on average with 10 D6 at 4+', () => {
    const result = exactResult([], defender(10, 4, 2, 1, 4), [mortal('Hammer of Wrath', 10, 4, '1')]);
    expect(result.expectedModelsDestroyed).toBeCloseTo(5, 10);
    expect(result.expectedDamage).toBeCloseTo(5, 10);
  });

  it('ignores saves and resolves before the weapons, which then hit the weakened unit', () => {
    // Every mortal wound kills a 1W model; the bolt rifles then face fewer models.
    const target = defender(5, 4, 3, 1);
    const withMortals = exactResult([boltRifles], target, [mortal('MW', 6, 2, '1')]);
    const alone = exactResult([boltRifles], target);
    expect(withMortals.expectedModelsDestroyed).toBeGreaterThan(alone.expectedModelsDestroyed);
    expect(withMortals.expectedModelsDestroyed).toBeLessThanOrEqual(5);
    expect(withMortals.killDistribution.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('caps the mortal wounds at the unit’s wounds', () => {
    const result = exactResult([], defender(2, 4, 3, 2), [mortal('Overkill', 20, 2, 'D3')]);
    expect(result.expectedDamage).toBeLessThanOrEqual(4 + 1e-9);
    expect(result.killDistribution[2]).toBeGreaterThan(0.99);
  });
});
