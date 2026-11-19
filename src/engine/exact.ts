import type { DefenderProfile, WeaponProfile } from '../types';
import { convolve, diceDistribution } from './dice';
import { createAttackContext, unsavedChance } from './rules';

/**
 * Exact (noise-free) expectation of the attack sequence.
 *
 * The defender is a Markov chain over states (modelsLeft, woundsLeftOnCurrentModel),
 * plus one absorbing "all destroyed" state. Each unsaved wound is one transition
 * driven by the damage PMF. Per weapon, the number of unsaved wounds K has an exact
 * PMF (attack-count PMF thinned by P(unsaved)), so the state after a weapon is
 * Σ_k P(K = k) · T^k(state).
 *
 * State vector layout: index 0 = all destroyed, index 1 + (m-1)·W + (w-1) = (m, w).
 */
export type StateVector = Float64Array;

export interface WeaponKernel {
  /** unsaved[k] = P(exactly k unsaved wounds from this weapon). */
  unsaved: number[];
  /** tail[k] = P(at least k unsaved wounds). */
  tail: number[];
  /** damage[d] = P(damage roll = d). */
  damage: number[];
}

export interface ExactResult {
  expectedModelsDestroyed: number;
  expectedDamage: number;
  /** killDistribution[k] = P(exactly k models destroyed). */
  killDistribution: number[];
}

const EPSILON = 1e-15;

export function weaponKernel(weapon: WeaponProfile, defender: DefenderProfile): WeaponKernel {
  const ctx = createAttackContext(weapon, defender);
  const p = unsavedChance(ctx);

  const perModel = diceDistribution(ctx.attacks);
  let attacks = [1];
  for (let i = 0; i < weapon.models; i++) attacks = convolve(attacks, perModel);

  // K | N ~ Binomial(N, p); build binomial rows incrementally over N.
  const unsaved = new Array<number>(attacks.length).fill(0);
  let row = [1];
  for (let n = 0; n < attacks.length; n++) {
    if (n > 0) {
      const next = new Array<number>(n + 1).fill(0);
      for (let k = 0; k < n; k++) {
        next[k] += row[k] * (1 - p);
        next[k + 1] += row[k] * p;
      }
      row = next;
    }
    const pn = attacks[n];
    if (pn === 0) continue;
    for (let k = 0; k <= n; k++) unsaved[k] += pn * row[k];
  }

  const tail = new Array<number>(unsaved.length + 1).fill(0);
  for (let k = unsaved.length - 1; k >= 0; k--) tail[k] = tail[k + 1] + unsaved[k];

  return { unsaved, tail, damage: diceDistribution(ctx.damage) };
}

export function stateSize(defender: DefenderProfile): number {
  return 1 + defender.models * defender.wounds;
}

export function initialState(defender: DefenderProfile): StateVector {
  const state = new Float64Array(stateSize(defender));
  state[stateIndex(defender, defender.models, defender.wounds)] = 1;
  return state;
}

function stateIndex(defender: DefenderProfile, modelsLeft: number, woundsLeft: number): number {
  return modelsLeft === 0 ? 0 : 1 + (modelsLeft - 1) * defender.wounds + (woundsLeft - 1);
}

/** Apply one unsaved wound (one damage roll) to the state distribution. */
function step(state: StateVector, damage: number[], defender: DefenderProfile): StateVector {
  const W = defender.wounds;
  const next = new Float64Array(state.length);
  next[0] = state[0];
  for (let m = 1; m <= defender.models; m++) {
    for (let w = 1; w <= W; w++) {
      const p = state[stateIndex(defender, m, w)];
      if (p === 0) continue;
      for (let d = 1; d < damage.length; d++) {
        const q = damage[d];
        if (q === 0) continue;
        const target = d >= w ? stateIndex(defender, m - 1, W) : stateIndex(defender, m, w - d);
        next[target] += p * q;
      }
    }
  }
  return next;
}

/** Distribution over defender states after `kernel`'s weapon has fired. */
export function applyWeapon(state: StateVector, kernel: WeaponKernel, defender: DefenderProfile): StateVector {
  // Every unsaved wound removes at least 1 wound, so after `cap` of them the unit is gone.
  const cap = defender.models * defender.wounds;
  const result = new Float64Array(state.length);
  let current = state;

  for (let k = 0; k < kernel.unsaved.length; k++) {
    if (k >= cap || 1 - current[0] < EPSILON) {
      // `current` no longer changes; it receives all remaining probability.
      addScaled(result, current, kernel.tail[k]);
      break;
    }
    addScaled(result, current, kernel.unsaved[k]);
    current = step(current, kernel.damage, defender);
  }
  return result;
}

function addScaled(target: StateVector, source: StateVector, factor: number): void {
  if (factor === 0) return;
  for (let i = 0; i < target.length; i++) target[i] += source[i] * factor;
}

export function evaluateState(state: StateVector, defender: DefenderProfile): ExactResult {
  const M = defender.models;
  const W = defender.wounds;
  const killDistribution = new Array<number>(M + 1).fill(0);
  let expectedDamage = state[0] * M * W;
  killDistribution[M] = state[0];

  for (let m = 1; m <= M; m++) {
    for (let w = 1; w <= W; w++) {
      const p = state[stateIndex(defender, m, w)];
      killDistribution[M - m] += p;
      expectedDamage += p * ((M - m) * W + (W - w));
    }
  }

  const expectedModelsDestroyed = killDistribution.reduce((sum, p, k) => sum + p * k, 0);
  return { expectedModelsDestroyed, expectedDamage, killDistribution };
}

export function exactResult(weapons: WeaponProfile[], defender: DefenderProfile): ExactResult {
  let state = initialState(defender);
  for (const weapon of weapons) state = applyWeapon(state, weaponKernel(weapon, defender), defender);
  return evaluateState(state, defender);
}
