import { describe, expect, it } from 'vitest';
import { breakdown, weaponBreakdown } from './breakdown';
import { exactResult } from './exact';
import { mulberry32 } from './rng';
import { createAttackContext, unsavedPerAttack } from './rules';
import { simulate } from './simulate';
import { boltRifles, defender, gravis, heavyBolter, lascannon, weapon } from './testFixtures';

const withAbilities = [
  weapon('Sustained lethal', 5, 'D6', 3, 4, -1, '1', { sustainedHits: 'D3', lethalHits: true }),
  weapon('Devastating anti', 3, '2', 4, 3, 0, '2', { devastatingWounds: true, anti: { infantry: 4 } }),
  weapon('Blast melta', 2, 'D3', 3, 8, -3, 'D6', { blast: 'D3', melta: '2' }, { halfRange: true }),
  weapon('Re-rolls', 10, '2', 3, 4, -1, '1', { twinLinked: true }, {}, { hit: 1, rerollHits: 'ones', criticalHit: 5 }),
];
const target = defender(10, 4, 3, 2, 5, ['infantry']);

describe('weaponBreakdown', () => {
  it('works out a plain weapon step by step', () => {
    const b = weaponBreakdown(boltRifles, gravis);
    expect(b.attacks).toBeCloseTo(10, 12);
    expect(b.hit.passOn).toBe(3);
    expect(b.hit.chance).toBeCloseTo(4 / 6, 12);
    expect(b.hits).toBeCloseTo(10 * (4 / 6), 12);
    expect(b.strengthVsToughness).toBe(4);
    expect(b.wounds).toBeCloseTo(10 * (4 / 6) * (3 / 6), 12);
    expect(b.save).toEqual({ on: 4, invulnerable: false });
    expect(b.unsaved).toBeCloseTo(10 * (4 / 6) * (3 / 6) * (3 / 6), 12);
    expect(b.damage).toBeCloseTo(b.unsaved, 12);
  });

  it('adds a re-roll as first + rerolled × first', () => {
    const b = weaponBreakdown(weapon('Gun', 1, '1', 3, 4, 0, '1', {}, {}, { rerollHits: 'failed' }), gravis);
    expect(b.hit.first).toBeCloseTo(4 / 6, 12);
    expect(b.hit.rerolled).toBeCloseTo(2 / 6, 12);
    expect(b.hit.chance).toBeCloseTo(4 / 6 + (2 / 6) * (4 / 6), 12);
  });

  it('labels Blast, Rapid Fire and Melta terms', () => {
    const b = weaponBreakdown(weapon('Gun', 2, 'D6', 3, 8, -3, 'D6', { blast: 'D3', rapidFire: '1', melta: '2' }, { halfRange: true }), defender(10, 4, 3, 2));
    expect(b.attackTerms.map((t) => [t.label, t.expr, t.mean])).toEqual([
      ['A', 'D6', 3.5],
      ['Blast D3 × 2 (per 5 models)', '2D3', 4],
      ['Rapid Fire 1', '1', 1],
    ]);
    expect(b.attacks).toBeCloseTo(2 * 8.5, 12);
    expect(b.damageTerms.map((t) => [t.label, t.mean])).toEqual([
      ['D', 3.5],
      ['Melta 2', 2],
    ]);
  });

  it('agrees with the per-attack unsaved-wound expectation of the rules', () => {
    for (const w of [...withAbilities, lascannon, heavyBolter]) {
      const b = weaponBreakdown(w, target);
      expect(b.unsaved).toBeCloseTo(b.attacks * unsavedPerAttack(createAttackContext(w, target)), 10);
    }
  });

  it('matches the simulated averages of every step', () => {
    const sim = simulate(withAbilities, target, 100_000, mulberry32(7));
    withAbilities.forEach((w, i) => {
      const b = weaponBreakdown(w, target);
      const s = sim.perWeapon[i].stats;
      for (const [expected, actual] of [
        [b.attacks, s.attacks],
        [b.hits, s.hits],
        [b.wounds, s.wounds],
        [b.unsaved, s.unsaved],
      ]) {
        expect(Math.abs(actual - expected) / expected).toBeLessThan(0.02);
      }
    });
  });
});

describe('breakdown', () => {
  it('splits the exact damage and models destroyed over the weapons', () => {
    const b = breakdown(withAbilities, target);
    const exact = exactResult(withAbilities, target);
    expect(b.appliedTotal).toBeCloseTo(exact.expectedDamage, 10);
    expect(b.destroyedTotal).toBeCloseTo(exact.expectedModelsDestroyed, 10);
    expect(b.weapons.reduce((total, w) => total + w.applied, 0)).toBeCloseTo(exact.expectedDamage, 10);
    expect(b.weapons.reduce((total, w) => total + w.destroyed, 0)).toBeCloseTo(exact.expectedModelsDestroyed, 10);
    for (const w of b.weapons) expect(w.applied).toBeLessThanOrEqual(w.damage + 1e-9);
  });
});
