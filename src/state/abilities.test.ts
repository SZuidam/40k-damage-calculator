import { describe, expect, it } from 'vitest';
import { noAbilities } from '../types';
import { ABILITY_CHOICES, SUSTAINED_HITS_VALUES, abilitiesSummary, activeAbilities, sameAbilities, withoutAbility } from './abilities';

const choice = (value: string) => {
  const found = ABILITY_CHOICES.find((c) => c.value === value);
  if (!found) throw new Error(`No choice ${value}`);
  return found;
};

describe('ability choices', () => {
  it('offers Lethal Hits, Sustained Hits 1 and 2, Devastating Wounds, Blast 1 and 2, and Cleave 1 and 2', () => {
    expect(SUSTAINED_HITS_VALUES).toEqual(['1', '2']);
    expect(ABILITY_CHOICES.map((c) => c.label)).toEqual([
      'Lethal Hits',
      'Sustained Hits 1',
      'Sustained Hits 2',
      'Devastating Wounds',
      'Blast 1',
      'Blast 2',
      'Cleave 1',
      'Cleave 2',
    ]);
  });

  it('replaces one Blast value with another, and keeps Blast and Cleave apart', () => {
    const one = choice('blast-1').apply(noAbilities());
    const two = choice('blast-2').apply(one);
    expect(two.blast).toBe(2);
    expect(choice('blast-1').isActive(two)).toBe(false);
    expect(choice('blast-2').isActive(two)).toBe(true);
    const both = choice('cleave-1').apply(two);
    expect([both.blast, both.cleave]).toEqual([2, 1]);
  });

  it('adds abilities without changing the input', () => {
    const none = noAbilities();
    const lethal = choice('lethal-hits').apply(none);
    expect(lethal).toEqual({ ...noAbilities(), lethalHits: true, sustainedHits: null, devastatingWounds: false });
    expect(none.lethalHits).toBe(false);
    expect(choice('lethal-hits').isActive(lethal)).toBe(true);
  });

  it('replaces one Sustained Hits value with another', () => {
    const one = choice('sustained-hits-1').apply(noAbilities());
    const two = choice('sustained-hits-2').apply(one);
    expect(two.sustainedHits).toBe('2');
    expect(choice('sustained-hits-1').isActive(two)).toBe(false);
    expect(choice('sustained-hits-2').isActive(two)).toBe(true);
  });
});

describe('activeAbilities', () => {
  it('lists the abilities in a fixed order, and removes them one at a time', () => {
    const all = { ...noAbilities(), lethalHits: true, sustainedHits: 'd3', devastatingWounds: true };
    expect(activeAbilities(all).map((a) => a.label)).toEqual(['Lethal Hits', 'Sustained Hits D3', 'Devastating Wounds']);
    expect(abilitiesSummary(all)).toBe('Lethal Hits, Sustained Hits D3, Devastating Wounds');
    expect(withoutAbility(all, 'sustainedHits')).toEqual({ ...noAbilities(), lethalHits: true, sustainedHits: null, devastatingWounds: true });
    expect(withoutAbility(all, 'lethalHits').lethalHits).toBe(false);
    expect(abilitiesSummary(noAbilities())).toBe('');

    const bonus = { ...noAbilities(), blast: 1, cleave: 2 };
    expect(abilitiesSummary(bonus)).toBe('Blast 1, Cleave 2');
    expect(withoutAbility(bonus, 'blast')).toEqual({ ...noAbilities(), cleave: 2 });
    expect(withoutAbility(bonus, 'cleave')).toEqual({ ...noAbilities(), blast: 1 });
  });
});

describe('sameAbilities', () => {
  it('compares Sustained Hits case- and space-insensitively', () => {
    const none = noAbilities();
    expect(sameAbilities(none, noAbilities())).toBe(true);
    expect(sameAbilities({ ...none, sustainedHits: ' d3' }, { ...none, sustainedHits: 'D3' })).toBe(true);
    expect(sameAbilities({ ...none, sustainedHits: '1' }, none)).toBe(false);
    expect(sameAbilities({ ...none, lethalHits: true }, none)).toBe(false);
    expect(sameAbilities({ ...none, devastatingWounds: true }, none)).toBe(false);
    expect(sameAbilities({ ...none, blast: 1 }, none)).toBe(false);
    expect(sameAbilities({ ...none, blast: 1 }, { ...none, cleave: 1 })).toBe(false);
    expect(sameAbilities({ ...none, cleave: 2 }, { ...none, cleave: 2 })).toBe(true);
  });
});
