import { emptyStats, type DefenderProfile, type MortalWoundSource, type SimulationResult, type StepStats, type WeaponProfile } from '../types';
import { parseDice, rollDice, rollDiceSum } from './dice';
import { d6, defaultRng, type Rng } from './rng';
import { attacksPerModel, createAttackContext, hitSucceeds, isCriticalHit, isCriticalWound, isRerolled, rollDamage, saveSucceeds, woundSucceeds } from './rules';

/**
 * Monte Carlo simulation of the attack sequence. Weapons resolve in the given
 * order; a partially wounded defender model carries over to the next weapon.
 * Once every defender model is destroyed, further damage is not applied, but
 * hits / wounds / unsaved wounds keep being counted.
 *
 * `mortals` resolve first, before every weapon: per source `dice` D6, each `on`+ inflicts
 * `perSuccess` mortal wounds, and each mortal wound removes 1 wound (no save of any kind).
 */
export function simulate(
  weapons: WeaponProfile[],
  defender: DefenderProfile,
  iterations: number,
  rng: Rng = defaultRng,
  mortals: MortalWoundSource[] = [],
): SimulationResult {
  const contexts = weapons.map((w) => createAttackContext(w, defender));
  const sums: StepStats[] = weapons.map(() => emptyStats());
  const mortalDice = mortals.map((m) => parseDice(m.perSuccess));
  const mortalSums: StepStats[] = mortals.map(() => emptyStats());
  const histogram = new Array<number>(defender.models + 1).fill(0);

  for (let it = 0; it < iterations; it++) {
    let modelsLeft = defender.models;
    let woundsLeft = defender.wounds;

    // Mortal wounds: no hit, wound or save roll; each one removes 1 wound.
    for (let mi = 0; mi < mortals.length; mi++) {
      const source = mortals[mi];
      const s = mortalSums[mi];
      let inflicted = 0;
      for (let d = 0; d < source.dice; d++) if (d6(rng) >= source.on) inflicted += rollDice(mortalDice[mi], rng);
      s.wounds += inflicted;
      s.unsaved += inflicted;
      for (let k = 0; k < inflicted && modelsLeft > 0; k++) {
        s.damage++;
        woundsLeft--;
        if (woundsLeft === 0) {
          s.modelsDestroyed++;
          modelsLeft--;
          woundsLeft = defender.wounds;
        }
      }
    }

    for (let wi = 0; wi < contexts.length; wi++) {
      const ctx = contexts[wi];
      const s = sums[wi];

      const perModel = attacksPerModel(ctx);
      for (let m = 0; m < ctx.weapon.models; m++) {
        const attacks = rollDiceSum(perModel, rng);
        s.attacks += attacks;

        for (let a = 0; a < attacks; a++) {
          // Torrent: the attack hits automatically, without a hit roll (so never a critical hit).
          let critical = false;
          if (!ctx.torrent) {
            let hitRoll = d6(rng);
            // Re-roll hits (1s or failed rolls) once; the re-roll stands.
            if (isRerolled(ctx.rerollHits, hitRoll, hitSucceeds(ctx, hitRoll))) hitRoll = d6(rng);
            if (!hitSucceeds(ctx, hitRoll)) continue;
            critical = isCriticalHit(ctx, hitRoll);
          }
          // Sustained Hits: a critical hit scores extra hits, which roll to wound normally.
          const extraHits = critical && ctx.sustainedHits !== null ? rollDice(ctx.sustainedHits, rng) : 0;
          // Lethal Hits: the critical hit itself wounds automatically (not a critical wound).
          const autoWounds = critical && ctx.lethalHits ? 1 : 0;
          const hits = 1 + extraHits;
          s.hits += hits;

          for (let h = 0; h < hits; h++) {
            let devastating = false;
            if (h >= autoWounds) {
              let woundRoll = d6(rng);
              // Twin-linked / abilities: a failed wound roll (or a 1) is re-rolled once, and the re-roll stands.
              if (isRerolled(ctx.rerollWounds, woundRoll, woundSucceeds(ctx, woundRoll))) woundRoll = d6(rng);
              if (!woundSucceeds(ctx, woundRoll)) continue;
              devastating = ctx.devastatingWounds && isCriticalWound(ctx, woundRoll);
            }
            s.wounds++;
            // Devastating Wounds: no saving throw of any kind.
            if (!devastating && saveSucceeds(ctx, d6(rng))) continue;
            s.unsaved++;
            if (modelsLeft === 0) continue;

            // A damage roll below the Settings threshold is re-rolled once (Re-roll damage).
            const applied = Math.min(rollDamage(ctx, rng), woundsLeft);
            s.damage += applied;
            woundsLeft -= applied;
            if (woundsLeft === 0) {
              s.modelsDestroyed++;
              modelsLeft--;
              woundsLeft = defender.wounds;
            }
          }
        }
      }
    }

    histogram[defender.models - modelsLeft]++;
  }

  const perWeapon = [
    ...mortals.map((m, i) => ({ id: m.id, name: m.name, kind: 'mortal' as const, stats: scale(mortalSums[i], 1 / iterations) })),
    ...weapons.map((w, i) => ({ id: w.id, name: w.name, kind: 'weapon' as const, stats: scale(sums[i], 1 / iterations) })),
  ];
  const total = perWeapon.reduce((acc, p) => add(acc, p.stats), emptyStats());
  const killDistribution = histogram.map((count) => count / iterations);

  return {
    iterations,
    total,
    perWeapon,
    killDistribution,
    killAtLeast: atLeast(killDistribution),
  };
}

/** Convert P(exactly k) into P(at least k). */
export function atLeast(distribution: number[]): number[] {
  const out = new Array<number>(distribution.length).fill(0);
  let tail = 0;
  for (let k = distribution.length - 1; k >= 0; k--) {
    tail += distribution[k];
    out[k] = Math.min(1, tail);
  }
  return out;
}

function scale(s: StepStats, f: number): StepStats {
  return {
    attacks: s.attacks * f,
    hits: s.hits * f,
    wounds: s.wounds * f,
    unsaved: s.unsaved * f,
    damage: s.damage * f,
    modelsDestroyed: s.modelsDestroyed * f,
  };
}

function add(a: StepStats, b: StepStats): StepStats {
  return {
    attacks: a.attacks + b.attacks,
    hits: a.hits + b.hits,
    wounds: a.wounds + b.wounds,
    unsaved: a.unsaved + b.unsaved,
    damage: a.damage + b.damage,
    modelsDestroyed: a.modelsDestroyed + b.modelsDestroyed,
  };
}
