import type { DefenderProfile, MortalWoundSource, WeaponProfile } from '../types';
import { convolve, diceDistribution, diceSumDistribution, parseDice } from './dice';
import { attacksPerModel, createAttackContext, damageDistribution, unsavedDistribution } from './rules';

/**
 * Exact (noise-free) expectation of the attack sequence.
 *
 * The defender is a Markov chain over states (modelsLeft, woundsLeftOnCurrentModel),
 * plus one absorbing "all destroyed" state. Each unsaved wound is one transition
 * driven by the damage PMF. Per weapon, the number of unsaved wounds K has an exact
 * PMF (the per-attack unsaved-wound PMF summed over the random number of attacks),
 * so the state after a weapon is Σ_k P(K = k) · T^k(state).
 *
 * State vector layout: index 0 = all destroyed, index 1 + (m-1)·W + (w-1) = (m, w).
 */
export type StateVector = Float64Array;

export interface WeaponKernel {
  /**
   * unsaved[k] = P(exactly k unsaved wounds from this weapon) for k below the cap
   * (models × wounds, after which the unit is gone); the last entry holds P(K ≥ cap).
   */
  unsaved: number[];
  /** tail[k] = P(at least k unsaved wounds). */
  tail: number[];
  /** damage[d] = P(damage roll = d), after a damage re-roll and with Melta included. */
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
  const perAttack = unsavedDistribution(ctx);
  const cap = defender.models * defender.wounds;

  const perModel = diceSumDistribution(attacksPerModel(ctx));
  let attacks = [1];
  for (let i = 0; i < weapon.models; i++) attacks = convolve(attacks, perModel);

  // K | N = sum of N per-attack counts; build row_n = row_{n-1} * perAttack incrementally.
  // Anything at or above the cap is lumped into the cap: it destroys the unit either way.
  let unsaved = [0];
  let row = [1];
  for (let n = 0; n < attacks.length; n++) {
    if (n > 0) row = convolveCapped(row, perAttack, cap);
    if (attacks[n] === 0) continue;
    if (row.length > unsaved.length) unsaved = [...unsaved, ...new Array<number>(row.length - unsaved.length).fill(0)];
    for (let k = 0; k < row.length; k++) unsaved[k] += attacks[n] * row[k];
  }

  const tail = new Array<number>(unsaved.length + 1).fill(0);
  for (let k = unsaved.length - 1; k >= 0; k--) tail[k] = tail[k + 1] + unsaved[k];

  return { unsaved, tail, damage: damageDistribution(ctx) };
}

/**
 * A mortal wound source as a kernel: every mortal wound is one "unsaved wound" of damage 1, so
 * it flows through applyWeapon like a weapon. Successes ~ Binomial(dice, P(D6 ≥ on)), each
 * success inflicting `perSuccess` mortal wounds; counts at or above the cap are lumped together.
 */
export function mortalKernel(source: MortalWoundSource, defender: DefenderProfile): WeaponKernel {
  const cap = defender.models * defender.wounds;
  const p = (7 - source.on) / 6;
  let successes = [1];
  for (let i = 0; i < source.dice; i++) successes = convolve(successes, [1 - p, p]);
  const perSuccess = diceDistribution(parseDice(source.perSuccess));

  let unsaved = [0];
  let row = [1];
  for (let n = 0; n < successes.length; n++) {
    if (n > 0) row = convolveCapped(row, perSuccess, cap);
    if (successes[n] === 0) continue;
    if (row.length > unsaved.length) unsaved = [...unsaved, ...new Array<number>(row.length - unsaved.length).fill(0)];
    for (let k = 0; k < row.length; k++) unsaved[k] += successes[n] * row[k];
  }

  const tail = new Array<number>(unsaved.length + 1).fill(0);
  for (let k = unsaved.length - 1; k >= 0; k--) tail[k] = tail[k + 1] + unsaved[k];

  return { unsaved, tail, damage: [0, 1] };
}

/** convolve(a, b) with every value at or above `cap` added into index `cap`. */
function convolveCapped(a: number[], b: number[], cap: number): number[] {
  const full = convolve(a, b);
  if (full.length <= cap + 1) return full;
  const out = full.slice(0, cap + 1);
  for (let i = cap + 1; i < full.length; i++) out[cap] += full[i];
  return out;
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

/** Exact result of `mortals` (first) and then `weapons` in order. */
export function exactResult(weapons: WeaponProfile[], defender: DefenderProfile, mortals: MortalWoundSource[] = []): ExactResult {
  let state = initialState(defender);
  for (const source of mortals) state = applyWeapon(state, mortalKernel(source, defender), defender);
  for (const weapon of weapons) state = applyWeapon(state, weaponKernel(weapon, defender), defender);
  return evaluateState(state, defender);
}
