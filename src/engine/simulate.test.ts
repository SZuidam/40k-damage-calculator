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

  it('counts Sustained Hits extra hits and Lethal Hits auto-wounds in the step averages', () => {
    // 10 attacks, BS 3+, S4 vs T4: hits = 4/6 + 1/6 extra; wounds = 3/6 · 1/2 + 1/6 (auto) + 1/6 · 1/2 (extra hit)
    const sim = simulate(
      [weapon('Gun', 10, '1', 3, 4, 0, '1', { lethalHits: true, sustainedHits: '1' })],
      defender(20, 4, 3, 1),
      ITERATIONS,
      mulberry32(21),
    );
    expectClose(sim.total.hits, 10 * (5 / 6));
    expectClose(sim.total.wounds, 10 * ((3 / 6) * (1 / 2) + 1 / 6 + (1 / 6) * (1 / 2)));
  });

  it('Devastating Wounds ignores even a 2+ invulnerable save on a critical wound', () => {
    const sim = simulate([weapon('Gun', 10, '1', 2, 4, 0, '1', { devastatingWounds: true })], defender(20, 4, 2, 1, 2), ITERATIONS, mulberry32(22));
    // hit 5/6; wound faces 4 and 5 are saved on 2+ (fail 1/6); face 6 is never saved
    expectClose(sim.total.unsaved, 10 * (5 / 6) * ((2 / 6) * (1 / 6) + 1 / 6));
  });

  compareWithExact('Lethal Hits', [weapon('Lethal', 5, '3', 4, 4, -1, '2', { lethalHits: true })], defender(5, 8, 3, 3), 16);
  compareWithExact('Sustained Hits 2', [weapon('Sustained', 5, '2', 3, 5, 0, 'D3', { sustainedHits: '2' })], defender(10, 4, 3, 2), 17);
  compareWithExact('Devastating Wounds', [weapon('Devastating', 3, 'D6', 3, 6, -1, '2', { devastatingWounds: true })], defender(5, 6, 2, 3, 4), 18);
  compareWithExact(
    'all three abilities with carry-over',
    [weapon('All', 4, '3', 3, 4, -1, 'D3', { lethalHits: true, sustainedHits: '1', devastatingWounds: true }), heavyBolter, lascannon],
    gravis,
    19,
  );
  it('Blast counts the target unit at the start, even after earlier weapons destroyed models', () => {
    // 11 models → Blast 1 adds 2 attacks per model. Overkill destroys 10 models first; the
    // blast weapon still makes 5 × (1 + 2) attacks.
    const overkill = weapon('Overkill', 10, '1', 2, 20, -6, '10');
    const blast = weapon('Blast', 5, '1', 3, 4, 0, '1', { blast: '1' });
    const sim = simulate([overkill, blast], defender(11, 4, 3, 1), 2000, mulberry32(23));
    expect(sim.perWeapon[1].stats.attacks).toBe(15);
  });

  compareWithExact('Blast 1 into 10 models', [weapon('Frag', 2, 'D6', 3, 4, 0, '1', { blast: '1' })], defender(10, 3, 5, 1), 24);
  compareWithExact('Blast 2 and Cleave 1 with carry-over', [weapon('Both', 3, 'D3', 4, 5, -1, 'D3', { blast: '2', cleave: '1' }), heavyBolter], defender(10, 4, 3, 2), 25);
  compareWithExact('Blast D6+2 into 10 models', [weapon('Frag', 2, 'D6', 3, 4, 0, '1', { blast: 'D6+2' })], defender(10, 3, 5, 2), 26);
  compareWithExact('Blast D3 and Cleave 1 on D6 attacks', [weapon('Both', 2, 'D6', 4, 4, 0, '1', { blast: 'D3', cleave: '1' }), heavyBolter], defender(15, 4, 4, 1), 27);

  it('rolls Blast dice for every block of 5 models and every attacking model', () => {
    // 3 models with A 1 and Blast D6+2 into 10 models: 3 × (1 + 2 × 5.5) = 36 attacks on average.
    const sim = simulate([weapon('Frag', 3, '1', 3, 4, 0, '1', { blast: 'D6+2' })], defender(10, 4, 3, 1), ITERATIONS, mulberry32(28));
    expectClose(sim.total.attacks, 36);
  });
  compareWithExact(
    'Anti-Vehicle 4+ with Devastating Wounds',
    [weapon('Anti', 10, '1', 3, 4, 0, '1', { anti: { vehicle: 4 }, devastatingWounds: true })],
    defender(3, 8, 2, 4, null, ['vehicle']),
    29,
  );
  compareWithExact(
    'Anti-Monster 3+ with Lethal Hits and Devastating Wounds',
    [weapon('Anti lethal', 6, '2', 3, 5, -1, 'D3', { anti: { monster: 3 }, lethalHits: true, devastatingWounds: true }), heavyBolter],
    defender(2, 10, 2, 8, 4, ['monster']),
    30,
  );

  it('Anti with Devastating Wounds: Lethal Hits auto-wounds stay non-critical', () => {
    // BS 3+, S4 vs T8, Sv 2+ (fails on a 1 only), Anti-Vehicle 4+:
    // normal hits (3/6): wound faces 4-6 are critical, never saved: 3/6
    // critical hits (1/6): auto-wound, not critical: saved unless a 1, 1/6
    const sim = simulate(
      [weapon('Gun', 10, '1', 3, 4, 0, '1', { anti: { vehicle: 4 }, lethalHits: true, devastatingWounds: true })],
      defender(20, 8, 2, 1, null, ['vehicle']),
      ITERATIONS,
      mulberry32(31),
    );
    expectClose(sim.total.unsaved, 10 * ((3 / 6) * (3 / 6) + (1 / 6) * (1 / 6)));
  });
  compareWithExact('Sustained Hits D3', [weapon('Sustained D3', 4, '2', 4, 4, 0, '1', { sustainedHits: 'D3' })], defender(10, 4, 4, 1), 20);
  compareWithExact(
    'Rapid Fire D3 and Lance within half range after a charge',
    [weapon('Lance rifle', 5, '1', 3, 4, -1, '2', { rapidFire: 'D3', lance: true }, { halfRange: true, charged: true }), heavyBolter],
    defender(10, 4, 3, 2),
    32,
  );

  it('Rapid Fire 1: 10 bolt rifles make 20 attacks, 30 within half range', () => {
    const rifles = (halfRange: boolean) => [weapon('Bolt rifles', 10, '2', 3, 4, -1, '1', { rapidFire: '1' }, { halfRange })];
    expect(simulate(rifles(false), defender(10, 4, 3, 2), 200, mulberry32(33)).total.attacks).toBe(20);
    expect(simulate(rifles(true), defender(10, 4, 3, 2), 200, mulberry32(33)).total.attacks).toBe(30);
  });

  it('Melta 2: D6 damage becomes D6+2 within half range', () => {
    // 10 attacks, BS 2+, S9 vs T10 (5+), Sv 3+ at AP-4 fails: 10 * 5/6 * 2/6 unsaved, each worth D6 (3.5) or D6+2 (5.5).
    const melta = (halfRange: boolean) => [weapon('Meltaguns', 10, '1', 2, 9, -4, 'D6', { melta: '2' }, { halfRange })];
    const tank = defender(1, 10, 3, 400);
    const unsaved = 10 * (5 / 6) * (2 / 6);
    expectClose(simulate(melta(false), tank, ITERATIONS, mulberry32(38)).total.damage, unsaved * 3.5);
    expectClose(simulate(melta(true), tank, ITERATIONS, mulberry32(38)).total.damage, unsaved * 5.5);
    expectClose(exactResult(melta(true), tank).expectedDamage, unsaved * 5.5);
  });
  compareWithExact(
    'Melta D3 within half range, carrying over to the next weapon',
    [weapon('Multi-melta', 2, '2', 3, 9, -4, 'D6', { melta: 'D3' }, { halfRange: true }), heavyBolter],
    defender(3, 6, 3, 8),
    39,
  );

  it('Twin-linked: S4 into T4 wounds 3/4 of the time', () => {
    const twin = (twinLinked: boolean) => [weapon('Twin', 10, '1', 2, 4, 0, '1', { twinLinked })];
    expectClose(simulate(twin(false), defender(20, 4, 3, 1), ITERATIONS, mulberry32(35)).total.wounds, 10 * (5 / 6) * (3 / 6));
    expectClose(simulate(twin(true), defender(20, 4, 3, 1), ITERATIONS, mulberry32(35)).total.wounds, 10 * (5 / 6) * (3 / 4));
  });
  compareWithExact(
    'Twin-linked with Devastating Wounds and Sustained Hits',
    [weapon('Twin', 5, '2', 3, 4, -1, 'D3', { twinLinked: true, devastatingWounds: true, sustainedHits: '1' }), heavyBolter],
    defender(10, 5, 3, 2),
    36,
  );
  compareWithExact(
    'Twin-linked with Lethal Hits and Anti',
    [weapon('Twin anti', 4, '3', 4, 4, 0, '2', { twinLinked: true, lethalHits: true, anti: { vehicle: 4 } })],
    defender(3, 9, 3, 6, null, ['vehicle']),
    37,
  );

  it('Lance: S4 into T4 wounds on 3+ after a charge', () => {
    const lance = (charged: boolean) => [weapon('Lance', 10, '1', 2, 4, 0, '1', { lance: true }, { charged })];
    expectClose(simulate(lance(false), defender(20, 4, 3, 1), ITERATIONS, mulberry32(34)).total.wounds, 10 * (5 / 6) * (3 / 6));
    expectClose(simulate(lance(true), defender(20, 4, 3, 1), ITERATIONS, mulberry32(34)).total.wounds, 10 * (5 / 6) * (4 / 6));
  });
  compareWithExact(
    're-rolled hits with Sustained and Lethal Hits',
    [weapon('Bolters', 10, '2', 3, 4, -1, '1', { sustainedHits: '1', lethalHits: true }, {}, { rerollHits: 'failed' })],
    defender(10, 4, 3, 2),
    21,
  );
  compareWithExact(
    'hit and wound modifiers past the cap, re-roll 1s',
    [weapon('Choppas', 10, '3', 4, 4, -1, '1', {}, {}, { hit: 2, wound: 2, rerollHits: 'ones', rerollWounds: 'ones' })],
    defender(10, 5, 4, 1),
    22,
  );
  compareWithExact(
    'critical hits and wounds on 5+ with Devastating Wounds',
    [weapon('Blades', 6, '3', 3, 5, -2, '2', { devastatingWounds: true, sustainedHits: '1' }, {}, { criticalHit: 5, criticalWound: 5 })],
    defender(5, 6, 2, 3, 4),
    23,
  );
});

describe('Torrent and damage re-rolls', () => {
  it('Torrent: every attack hits, even at BS 6+ with Sustained Hits', () => {
    const flamers = [weapon('Flamers', 5, 'D6', 6, 4, 0, '1', { torrent: true, sustainedHits: '1' })];
    const sim = simulate(flamers, defender(40, 4, 7, 1), ITERATIONS, mulberry32(51));
    expect(sim.total.hits).toBe(sim.total.attacks);
    expectClose(sim.total.attacks, 5 * 3.5);
  });
  compareWithExact(
    'Torrent with Lethal Hits, a hit re-roll and Devastating Wounds',
    [weapon('Flamers', 3, 'D6', 4, 5, -1, '1', { torrent: true, lethalHits: true, devastatingWounds: true }, {}, { rerollHits: 'failed', hit: 1 }), heavyBolter],
    defender(10, 4, 3, 2),
    52,
  );

  it('re-roll damage below 4 raises D6 damage from 3.5 to 4.25 per unsaved wound', () => {
    // 10 attacks, BS 2+, S12 vs T6 (2+), no save: 10 × 5/6 × 5/6 unsaved wounds.
    const guns = (below: number) => [weapon('Lascannons', 10, '1', 2, 12, -3, 'D6', {}, {}, { rerollDamageBelow: below })];
    const tank = defender(1, 6, 7, 400);
    const unsaved = 10 * (5 / 6) * (5 / 6);
    expectClose(simulate(guns(0), tank, ITERATIONS, mulberry32(53)).total.damage, unsaved * 3.5);
    expectClose(simulate(guns(4), tank, ITERATIONS, mulberry32(53)).total.damage, unsaved * 4.25);
    expectClose(exactResult(guns(4), tank).expectedDamage, unsaved * 4.25);
  });
  it('re-roll damage compares the dice only: D6+2 below 4 averages 6.25', () => {
    const guns = [weapon('Lascannons', 10, '1', 2, 12, -3, 'D6+2', {}, {}, { rerollDamageBelow: 4 })];
    const unsaved = 10 * (5 / 6) * (5 / 6);
    expectClose(simulate(guns, defender(1, 6, 7, 400), ITERATIONS, mulberry32(55)).total.damage, unsaved * 6.25);
  });
  compareWithExact(
    'D3+1 damage re-rolled below 3 (dice only) with Melta, carrying over to the next weapon',
    [weapon('Melta rifles', 3, '1', 3, 9, -4, 'D3+1', { melta: '2' }, { halfRange: true }, { rerollDamageBelow: 3 }), heavyBolter],
    defender(4, 5, 3, 5),
    54,
  );
});

describe('atLeast', () => {
  it('turns exact probabilities into cumulative tails', () => {
    expect(atLeast([0.25, 0.5, 0.25])).toEqual([1, 0.75, 0.25]);
  });
});
