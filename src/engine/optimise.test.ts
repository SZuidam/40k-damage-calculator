import { describe, expect, it } from 'vitest';
import { exactResult } from './exact';
import { MAX_EXHAUSTIVE_WEAPONS, optimiseOrder } from './optimise';
import { boltRifles, defender, gravis, heavyBolter, lascannon, multiMelta, plasma, weapon } from './testFixtures';

describe('optimiseOrder', () => {
  it('puts the lascannon first so bolt rifles and heavy bolter finish wounded models', () => {
    const result = optimiseOrder([boltRifles, lascannon, heavyBolter], gravis);
    expect(result.bestOrder).toEqual([1, 0, 2]);
    expect(result.beneficial).toBe(true);
    expect(result.gain).toBeGreaterThan(0.1);
    expect(result.method).toBe('exhaustive');
  });

  it('reports the score of the best order consistently with the exact engine', () => {
    const weapons = [boltRifles, multiMelta, plasma];
    const result = optimiseOrder(weapons, gravis);
    const best = exactResult(
      result.bestOrder.map((i) => weapons[i]),
      gravis,
    );
    expect(result.best.expectedModelsDestroyed).toBeCloseTo(best.expectedModelsDestroyed, 10);
  });

  it('does not flag an order that is already optimal', () => {
    const result = optimiseOrder([lascannon, boltRifles, heavyBolter], gravis);
    expect(result.beneficial).toBe(false);
    expect(result.gain).toBeCloseTo(0, 10);
  });

  it('does not flag two-weapon lists, whose expected kills never depend on order', () => {
    expect(optimiseOrder([boltRifles, lascannon], gravis).beneficial).toBe(false);
  });

  it('only flags gains above the threshold', () => {
    const weapons = [boltRifles, lascannon, heavyBolter];
    const { gain } = optimiseOrder(weapons, gravis);
    expect(optimiseOrder(weapons, gravis, gain + 0.001).beneficial).toBe(false);
    expect(optimiseOrder(weapons, gravis, gain - 0.001).beneficial).toBe(true);
  });

  it('handles a single weapon', () => {
    const result = optimiseOrder([lascannon], gravis);
    expect(result.bestOrder).toEqual([0]);
    expect(result.beneficial).toBe(false);
  });

  it('falls back to greedy for long lists and never proposes a worse order', () => {
    const many = Array.from({ length: MAX_EXHAUSTIVE_WEAPONS + 1 }, (_, i) =>
      weapon(`W${i}`, 1, String(1 + (i % 3)), 3, 4 + i, -(i % 3), i % 2 ? 'D3' : String(1 + (i % 4))),
    );
    const result = optimiseOrder(many, defender(6, 4, 3, 3));
    expect(result.method).toBe('greedy');
    expect(result.gain).toBeGreaterThanOrEqual(0);
    expect([...result.bestOrder].sort((a, b) => a - b)).toEqual(many.map((_, i) => i));
  });
});
