import { describe, expect, it } from 'vitest';
import { breakdown } from '../engine/breakdown';
import { boltRifles, defender, gravis, mortal, weapon } from '../engine/testFixtures';
import { calculationText, chance, mortalCalc, num, weaponCalc } from './calculation';

/** The numbers follow the browser's locale: write expectations with a '.' and swap in its decimal separator. */
const SEP = (1.5).toLocaleString().charAt(1);
const dec = (s: string) => s.replace(/\./g, SEP);

describe('chance', () => {
  it('writes d6 chances as sixths', () => {
    expect(chance(4 / 6)).toBe('4/6');
    expect(chance(0)).toBe('0');
    expect(chance(1)).toBe('1');
    expect(chance(28 / 36)).toBe(dec('0.778'));
  });
});

describe('num', () => {
  it('drops needless decimals', () => {
    expect(num(10)).toBe('10');
    expect(num(3.5)).toBe(dec('3.5'));
    expect(num(20 / 3)).toBe(dec('6.67'));
  });
});

describe('weaponCalc', () => {
  it('writes each step of a plain weapon as a formula', () => {
    const calc = breakdown([boltRifles], gravis);
    const lines = weaponCalc(calc.weapons[0], 0, gravis).lines;
    expect(lines.map((l) => [l.step, l.formula])).toEqual([
      ['Attacks', '5 models × 2'],
      ['Hits', '10 × 4/6'],
      ['Wounds', dec('6.67 × 3/6')],
      ['Unsaved', dec('3.33 × 3/6')],
      ['Damage', dec('1.67 × 1')],
      ['Applied', dec('1.67 − 0 lost')],
      ['Destroyed', 'exact'],
    ]);
  });

  it('shows re-rolls, Sustained, Lethal and Devastating Wounds in the formulas', () => {
    const gun = weapon('Gun', 10, '1', 3, 4, 0, '1', { sustainedHits: '1', lethalHits: true, devastatingWounds: true }, {}, { rerollHits: 'failed' });
    const target = defender(20, 4, 4, 1);
    const lines = weaponCalc(breakdown([gun], target).weapons[0], 0, target).lines;
    const formula = (step: string) => lines.find((l) => l.step === step)!.formula;
    expect(formula('Hits')).toBe('10 × (4/6 + 2/6 × 4/6) + 10 × (1/6 + 2/6 × 1/6) × 1');
    expect(formula('Wounds')).toMatch(/^\(\d+([.,]\d+)? − 2[.,]22\) × 3\/6 \+ 2[.,]22$/);
    expect(formula('Unsaved')).toMatch(/ × 3\/6 \+ /);
  });

  it('explains an invulnerable save that beats the armour save', () => {
    const calc = breakdown([weapon('Las', 1, '1', 3, 12, -3, '1')], defender(1, 4, 3, 3, 4));
    const unsaved = weaponCalc(calc.weapons[0], 0, defender(1, 4, 3, 3, 4)).lines.find((l) => l.step === 'Unsaved')!;
    expect(unsaved.notes.join(' ')).toContain('4++ invulnerable save (better than Sv 3+ with AP -3 is 6+)');
  });
});

describe('Torrent and damage re-rolls', () => {
  it('reads BS N/A and explains that a Torrent weapon hits automatically', () => {
    const flamer = weapon('Flamer', 1, 'D6', 3, 4, 0, '1', { torrent: true, sustainedHits: '1' });
    const wc = weaponCalc(breakdown([flamer], gravis).weapons[0], 0, gravis);
    expect(wc.statLine).toBe('A D6 · BS N/A · S 4 · AP 0 · D 1');
    const hits = wc.lines.find((l) => l.step === 'Hits')!;
    expect(hits.formula).toBe(dec('3.5 × 1'));
    expect(hits.notes).toEqual(['Torrent: every attack hits automatically. No hit roll is made, so there are no critical hits and Sustained Hits can’t trigger.'.replace('’', "'")]);
  });

  it('explains the damage re-roll', () => {
    const gun = weapon('Gun', 1, '1', 3, 4, 0, 'D6', {}, {}, { rerollDamageBelow: 4 });
    const damage = weaponCalc(breakdown([gun], gravis).weapons[0], 0, gravis).lines.find((l) => l.step === 'Damage')!;
    expect(damage.notes[0]).toBe(dec('Re-roll damage below 4 (Settings): a D D6 roll whose dice show less than 4 (3/6 of the rolls) is rolled again and the re-roll stands, which raises its average from 3.5 to 4.25') + '.');
  });
});

describe('calculationText', () => {
  it('ends with the exact totals', () => {
    const text = calculationText(breakdown([boltRifles], gravis), gravis);
    expect(text).toContain('1. 5× Bolt rifles (A 2 · BS 3+ · S 4 · AP -1 · D 1)');
    expect(text.trim().split('\n').at(-1)).toMatch(/^Total: 1[.,]67 damage applied/);
  });
});

describe('mortal wounds', () => {
  it('writes the dice, the successes and the mortal wounds as formulas', () => {
    const target = defender(10, 4, 3, 1);
    const calc = breakdown([boltRifles], target, [mortal('Hammer of Wrath', 11, 4, 'D3')]);
    const mc = mortalCalc(calc.mortals[0], target, true);
    expect(mc.title).toBe('Hammer of Wrath (mortal wounds)');
    expect(mc.statLine).toBe('11 D6, each 4+: D3 MW');
    expect(mc.lines.map((l) => [l.step, l.formula, l.value])).toEqual([
      ['Successes', '11 D6 × 3/6', dec('5.50')],
      ['Mortal', dec('5.5 × 2'), dec('11.00')],
      ['Applied', expect.stringMatching(/^11 − /), expect.any(String)],
      ['Destroyed', 'exact', expect.any(String)],
    ]);
  });

  it('lists the mortal wounds before the weapons in the text', () => {
    const target = defender(10, 4, 3, 1);
    const text = calculationText(breakdown([boltRifles], target, [mortal('Hammer of Wrath', 10, 4, '1')]), target);
    expect(text.indexOf('Hammer of Wrath (mortal wounds)')).toBeGreaterThan(0);
    expect(text.indexOf('Hammer of Wrath (mortal wounds)')).toBeLessThan(text.indexOf('1. 5× Bolt rifles'));
  });
});
