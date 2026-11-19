import { rollDie, type Rng } from './rng';

/** `count` dice with `sides` sides plus a flat `bonus`. A constant has count 0. */
export interface DiceExpr {
  count: number;
  sides: number;
  bonus: number;
}

const CONSTANT = /^(\d+)$/;
const DICE = /^(\d*)d(\d+)(?:\+(\d+))?$/;

export const MAX_DICE_COUNT = 20;
export const MAX_CONSTANT = 200;

/**
 * Parse "3", "D3", "D6", "2D6", "D6+1", "2D3+2" (case-insensitive, spaces ignored).
 * Returns null for anything that is not a valid expression.
 */
export function tryParseDice(expr: string): DiceExpr | null {
  const s = expr.replace(/\s+/g, '').toLowerCase();

  const constant = CONSTANT.exec(s);
  if (constant) {
    const value = Number(constant[1]);
    if (value < 1 || value > MAX_CONSTANT) return null;
    return { count: 0, sides: 0, bonus: value };
  }

  const dice = DICE.exec(s);
  if (!dice) return null;
  const count = dice[1] === '' ? 1 : Number(dice[1]);
  const sides = Number(dice[2]);
  const bonus = dice[3] === undefined ? 0 : Number(dice[3]);
  if (count < 1 || count > MAX_DICE_COUNT) return null;
  if (sides !== 3 && sides !== 6) return null;
  if (bonus > MAX_CONSTANT) return null;
  return { count, sides, bonus };
}

export function parseDice(expr: string): DiceExpr {
  const parsed = tryParseDice(expr);
  if (!parsed) throw new Error(`Invalid dice expression: "${expr}"`);
  return parsed;
}

export function rollDice(dice: DiceExpr, rng: Rng): number {
  let total = dice.bonus;
  for (let i = 0; i < dice.count; i++) total += rollDie(dice.sides, rng);
  return total;
}

export function minValue(dice: DiceExpr): number {
  return dice.count + dice.bonus;
}

export function maxValue(dice: DiceExpr): number {
  return dice.count * dice.sides + dice.bonus;
}

export function meanValue(dice: DiceExpr): number {
  return dice.bonus + (dice.count * (dice.sides + 1)) / 2;
}

/** Discrete convolution of two PMFs indexed by value. */
export function convolve(a: number[], b: number[]): number[] {
  const out = new Array<number>(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i++) {
    if (a[i] === 0) continue;
    for (let j = 0; j < b.length; j++) out[i + j] += a[i] * b[j];
  }
  return out;
}

/** Exact probability mass function: pmf[v] = P(result = v). */
export function diceDistribution(dice: DiceExpr): number[] {
  let pmf = [1];
  if (dice.count > 0) {
    const single = new Array<number>(dice.sides + 1).fill(1 / dice.sides);
    single[0] = 0;
    for (let i = 0; i < dice.count; i++) pmf = convolve(pmf, single);
  }
  return [...new Array<number>(dice.bonus).fill(0), ...pmf];
}

/** The sum of `k` independent rolls of `dice`: D6+2 three times is 3D6+6. */
export function repeatDice(dice: DiceExpr, k: number): DiceExpr {
  return { count: dice.count * k, sides: dice.sides, bonus: dice.bonus * k };
}

/** Roll every term and add them up, e.g. base attacks D6 plus Blast 2D3. */
export function rollDiceSum(terms: DiceExpr[], rng: Rng): number {
  let total = 0;
  for (const term of terms) total += rollDice(term, rng);
  return total;
}

/** Exact PMF of the sum of independent dice expressions (possibly with different sides). */
export function diceSumDistribution(terms: DiceExpr[]): number[] {
  let pmf = [1];
  for (const term of terms) pmf = convolve(pmf, diceDistribution(term));
  return pmf;
}

/**
 * Write a sum of dice expressions as one expression: dice with the same sides are merged
 * and constants are added up, so [D6+2, D6+2, D3] reads "2D6+D3+4". An empty sum is "0".
 */
export function formatDiceSum(terms: DiceExpr[]): string {
  const countBySides = new Map<number, number>();
  let bonus = 0;
  for (const term of terms) {
    bonus += term.bonus;
    if (term.count > 0) countBySides.set(term.sides, (countBySides.get(term.sides) ?? 0) + term.count);
  }
  const parts = [...countBySides.entries()]
    .sort(([a], [b]) => b - a)
    .map(([sides, count]) => `${count === 1 ? '' : count}D${sides}`);
  if (bonus > 0 || parts.length === 0) parts.push(String(bonus));
  return parts.join('+');
}
