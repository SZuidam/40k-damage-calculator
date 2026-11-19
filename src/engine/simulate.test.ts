import { describe, expect, it } from 'vitest';
import type { DefenderProfile, WeaponProfile } from '../types';
import { exactResult } from './exact';
import { mulberry32 } from './rng';
import { atLeast, simulate } from './simulate';
import { boltRifles, defender, gravis, heavyBolter, lascannon, multiMelta, plasma, weapon } from './testFixtures';

const ITERATIONS = 100_000;

function expectClose(actual: number, expected: number) {
  const tolerance = Math.max(0.01 * Math.abs(expected), 0.01);
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance);
}

function compareWithExact(name: string, weapons: WeaponProfile[], target: DefenderProfile, seed: number) {
  it(`${name}: simulation matches the exact engine`, () => {
    const sim = simulate(weapons, target, ITERATIONS, mulberry32(seed));
    const exact = exactResult(weapons, target);
    expectClose(sim.total.modelsDestroyed, exact.expectedModelsDestroyed);
    expectClose(sim.total.damage, exact.expectedDamage);
    sim.killDistribution.forEach((p, k) => expect(Math.abs(p - exact.killDistribution[k])).toBeLessThan(0.01));
  });
}

describe('simulate', () => {
  it('produces the expected per-step averages for bolt rifles into marines', () => {
    const sim = simulate([weapon('Bolt rifles', 10, '2', 3, 4, -1, '1')], defender(10, 4, 3, 2), ITERATIONS, mulberry32(1));
    expect(sim.total.attacks).toBe(20);
    expectClose(sim.total.hits, 20 * (4 / 6));
    expectClose(sim.total.wounds, 20 * (4 / 6) * (3 / 6));
    expectClose(sim.total.unsaved, 20 * (4 / 6) * (3 / 6) * (3 / 6));
    expectClose(sim.total.damage, sim.total.unsaved);
  });

  it('is deterministic for a given seed', () => {
    const a = simulate([boltRifles, lascannon], gravis, 1000, mulberry32(7));
    const b = simulate([boltRifles, lascannon], gravis, 1000, mulberry32(7));
    expect(a).toEqual(b);
  });

  it('sums per-weapon stats into the total', () => {
    const sim = simulate([boltRifles, heavyBolter], gravis, 5000, mulberry32(3));
    const sum = sim.perWeapon.reduce((acc, p) => acc + p.stats.modelsDestroyed, 0);
    expect(sim.total.modelsDestroyed).toBeCloseTo(sum, 10);
  });

  it('keeps counting hits after the unit is wiped out but applies no more damage', () => {
    const sim = simulate([weapon('Overkill', 10, '10', 2, 20, -6, '6')], defender(2, 4, 3, 2), 200, mulberry32(9));
    expect(sim.total.modelsDestroyed).toBe(2);
    expect(sim.total.damage).toBe(4);
    expect(sim.total.unsaved).toBeGreaterThan(50);
    expect(sim.killAtLeast[2]).toBe(1);
  });

  compareWithExact('overkill (D6 into W1)', [weapon('Melta', 3, '2', 3, 9, -4, 'D6')], defender(10, 4, 3, 1), 11);
  compareWithExact('single weapon into W3', [lascannon], gravis, 12);
  compareWithExact('carry-over between weapons', [boltRifles, lascannon, heavyBolter], gravis, 13);
  compareWithExact(
    'random attacks and invulnerable save',
    [weapon('Flamer', 3, 'D6', 2, 5, -1, 'D3'), multiMelta],
    defender(5, 5, 2, 3, 4),
    14,
  );
  compareWithExact('mixed loadout into a vehicle', [plasma, multiMelta, lascannon], defender(1, 10, 3, 12), 15);
});

describe('atLeast', () => {
  it('turns exact probabilities into cumulative tails', () => {
    expect(atLeast([0.25, 0.5, 0.25])).toEqual([1, 0.75, 0.25]);
  });
});
