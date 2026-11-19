import { describe, expect, it } from 'vitest';
import { diceDistribution, diceSumDistribution, formatDiceSum, meanValue, parseDice, repeatDice, rollDice, rollDiceSum, tryParseDice } from './dice';
import { mulberry32 } from './rng';

describe('parseDice', () => {
  it.each([
    ['3', { count: 0, sides: 0, bonus: 3 }],
    ['D3', { count: 1, sides: 3, bonus: 0 }],
    ['d6', { count: 1, sides: 6, bonus: 0 }],
    ['2D6', { count: 2, sides: 6, bonus: 0 }],
    ['D6+1', { count: 1, sides: 6, bonus: 1 }],
    ['2d3+2', { count: 2, sides: 3, bonus: 2 }],
    [' 2 D 6 + 1 ', { count: 2, sides: 6, bonus: 1 }],
  ])('parses %j', (expr, expected) => {
    expect(parseDice(expr)).toEqual(expected);
  });

  it.each(['', '0', 'D', 'D4', 'D0', '0D6', '2D', 'D6+', 'D6-1', '+1', 'D6+1+1', 'abc', '1.5', '21D6'])('rejects %j', (expr) => {
    expect(tryParseDice(expr)).toBeNull();
    expect(() => parseDice(expr)).toThrow();
  });
});

describe('diceDistribution', () => {
  it.each(['3', 'D3', 'D6', '2D6', 'D6+1', '2D3+2', '4D6'])('%s sums to 1 and has the right mean', (expr) => {
    const dice = parseDice(expr);
    const pmf = diceDistribution(dice);
    expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(pmf.reduce((sum, p, v) => sum + p * v, 0)).toBeCloseTo(meanValue(dice), 12);
  });

  it('gives the classic 2D6 triangle', () => {
    const pmf = diceDistribution(parseDice('2D6'));
    expect(pmf[2]).toBeCloseTo(1 / 36);
    expect(pmf[7]).toBeCloseTo(6 / 36);
    expect(pmf[12]).toBeCloseTo(1 / 36);
    expect(pmf).toHaveLength(13);
  });

  it('puts a constant on a single value', () => {
    expect(diceDistribution(parseDice('3'))).toEqual([0, 0, 0, 1]);
  });
});

describe('rollDice', () => {
  it('stays within range and matches the mean', () => {
    const rng = mulberry32(42);
    const dice = parseDice('2D3+2');
    let sum = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) {
      const v = rollDice(dice, rng);
      expect(v).toBeGreaterThanOrEqual(4);
      expect(v).toBeLessThanOrEqual(8);
      sum += v;
    }
    expect(sum / n).toBeCloseTo(6, 1);
  });
});

describe('repeatDice', () => {
  it('adds up k independent rolls', () => {
    expect(repeatDice(parseDice('D6+2'), 2)).toEqual({ count: 2, sides: 6, bonus: 4 });
    expect(repeatDice(parseDice('3'), 3)).toEqual({ count: 0, sides: 0, bonus: 9 });
    expect(repeatDice(parseDice('2D3'), 1)).toEqual({ count: 2, sides: 3, bonus: 0 });
  });
});

describe('sums of dice expressions', () => {
  it('D6 + D3 sums to 1 and has mean 5.5', () => {
    const pmf = diceSumDistribution([parseDice('D6'), parseDice('D3')]);
    expect(pmf.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(pmf.reduce((sum, p, v) => sum + p * v, 0)).toBeCloseTo(5.5, 12);
    expect(pmf).toHaveLength(10);
    expect(pmf[2]).toBeCloseTo(1 / 18, 12);
    expect(pmf[9]).toBeCloseTo(1 / 18, 12);
  });

  it('an empty sum is always 0', () => {
    expect(diceSumDistribution([])).toEqual([1]);
  });

  it('rollDiceSum stays within range and matches the mean', () => {
    const rng = mulberry32(5);
    const terms = [parseDice('D6'), parseDice('2D3+1')];
    let sum = 0;
    const n = 50_000;
    for (let i = 0; i < n; i++) {
      const v = rollDiceSum(terms, rng);
      expect(v).toBeGreaterThanOrEqual(4);
      expect(v).toBeLessThanOrEqual(13);
      sum += v;
    }
    expect(sum / n).toBeCloseTo(8.5, 1);
  });

  it.each([
    [['2D6+4'], '2D6+4'],
    [['1', '2'], '3'],
    [['D6+2', 'D6+2', 'D3'], '2D6+D3+4'],
    [['2D3', 'D6'], 'D6+2D3'],
  ])('formatDiceSum(%j) is %s', (exprs, expected) => {
    expect(formatDiceSum(exprs.map(parseDice))).toBe(expected);
  });

  it('formatDiceSum merges dice with the same sides', () => {
    expect(formatDiceSum([parseDice('D6'), repeatDice(parseDice('D6+2'), 2)])).toBe('3D6+4');
    expect(formatDiceSum([])).toBe('0');
  });
});
