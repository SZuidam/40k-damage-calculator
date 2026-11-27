import type { DefenderProfile, MortalWoundSource, WeaponProfile } from '../types';
import { applyWeapon, evaluateState, initialState, mortalKernel, weaponKernel, type StateVector, type WeaponKernel } from './exact';

export interface OrderScore {
  expectedModelsDestroyed: number;
  expectedDamage: number;
}

export interface OptimiseResult {
  /** Best order as indices into the input array. */
  bestOrder: number[];
  current: OrderScore;
  best: OrderScore;
  /** Expected extra models destroyed by switching to `bestOrder`. */
  gain: number;
  /** True when the best order beats the current one by more than the threshold. */
  beneficial: boolean;
  /** 'exhaustive' tries every permutation; 'greedy' is used for long lists. */
  method: 'exhaustive' | 'greedy';
}

export const MAX_EXHAUSTIVE_WEAPONS = 7;
export const DEFAULT_GAIN_THRESHOLD = 0.01;
const TIE = 1e-9;

/** True when `a` is strictly better than `b`: more kills, then more damage as tie-break. */
function better(a: OrderScore, b: OrderScore): boolean {
  const kills = a.expectedModelsDestroyed - b.expectedModelsDestroyed;
  if (kills > TIE) return true;
  if (kills < -TIE) return false;
  return a.expectedDamage - b.expectedDamage > TIE;
}

function score(state: StateVector, defender: DefenderProfile): OrderScore {
  const { expectedModelsDestroyed, expectedDamage } = evaluateState(state, defender);
  return { expectedModelsDestroyed, expectedDamage };
}

/**
 * Find the weapon order that maximises expected models destroyed (tie-break:
 * expected damage). Every permutation is evaluated with the exact engine for up
 * to MAX_EXHAUSTIVE_WEAPONS weapons, sharing work between orders with the same
 * prefix; longer lists fall back to a greedy pick-the-best-next heuristic.
 *
 * `mortals` always resolve first and are never reordered: the search starts from the state
 * they leave behind, and the indices in `bestOrder` refer to `weapons` only.
 */
export function optimiseOrder(
  weapons: WeaponProfile[],
  defender: DefenderProfile,
  threshold = DEFAULT_GAIN_THRESHOLD,
  mortals: MortalWoundSource[] = [],
): OptimiseResult {
  const kernels = weapons.map((w) => weaponKernel(w, defender));
  let start = initialState(defender);
  for (const source of mortals) start = applyWeapon(start, mortalKernel(source, defender), defender);

  let state = start;
  for (const kernel of kernels) state = applyWeapon(state, kernel, defender);
  const current = score(state, defender);

  const exhaustive = weapons.length <= MAX_EXHAUSTIVE_WEAPONS;
  const found = exhaustive
    ? searchAll(kernels, start, defender, current)
    : searchGreedy(kernels, start, defender, current);

  const gain = found.score.expectedModelsDestroyed - current.expectedModelsDestroyed;
  return {
    bestOrder: found.order,
    current,
    best: found.score,
    gain,
    beneficial: gain > threshold,
    method: exhaustive ? 'exhaustive' : 'greedy',
  };
}

interface Candidate {
  order: number[];
  score: OrderScore;
}

function searchAll(kernels: WeaponKernel[], start: StateVector, defender: DefenderProfile, current: OrderScore): Candidate {
  // Start from the current order so an equally good permutation never replaces it.
  let best: Candidate = { order: kernels.map((_, i) => i), score: current };
  const used = new Array<boolean>(kernels.length).fill(false);
  const order: number[] = [];

  const visit = (state: StateVector) => {
    if (order.length === kernels.length) {
      const s = score(state, defender);
      if (better(s, best.score)) best = { order: [...order], score: s };
      return;
    }
    for (let i = 0; i < kernels.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      order.push(i);
      visit(applyWeapon(state, kernels[i], defender));
      order.pop();
      used[i] = false;
    }
  };

  visit(start);
  return best;
}

function searchGreedy(kernels: WeaponKernel[], start: StateVector, defender: DefenderProfile, current: OrderScore): Candidate {
  const remaining = kernels.map((_, i) => i);
  const order: number[] = [];
  let state = start;

  while (remaining.length > 0) {
    let pick = 0;
    let pickState = applyWeapon(state, kernels[remaining[0]], defender);
    let pickScore = score(pickState, defender);
    for (let r = 1; r < remaining.length; r++) {
      const next = applyWeapon(state, kernels[remaining[r]], defender);
      const s = score(next, defender);
      if (better(s, pickScore)) {
        pick = r;
        pickState = next;
        pickScore = s;
      }
    }
    order.push(remaining[pick]);
    remaining.splice(pick, 1);
    state = pickState;
  }

  const greedy = { order, score: score(state, defender) };
  return better(greedy.score, current) ? greedy : { order: kernels.map((_, i) => i), score: current };
}
