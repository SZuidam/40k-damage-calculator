import { describe, expect, it } from 'vitest';
import { noAbilities } from '../types';
import { ABILITY_CHOICES, SUSTAINED_HITS_VALUES, abilitiesSummary, activeAbilities, sameAbilities, withoutAbility } from './abilities';

const choice = (value: string) => {
  const found = ABILITY_CHOICES.find((c) => c.value === value);
  if (!found) throw new Error(`No choice ${value}`);
  return found;
};

describe('ability choices', () => {
  it('offers Lethal Hits, Sustained Hits 1 and 2, and Devastating Wounds', () => {
    expect(SUSTAINED_HITS_VALUES).toEqual(['1', '2']);
    expect(ABILITY_CHOICES.map((c) => c.label)).toEqual(['Lethal Hits', 'Sustained Hits 1', 'Sustained Hits 2', 'Devastating Wounds']);
  });

  it('adds abilities without changing the input', () => {
    const none = noAbilities();
    const lethal = choice('lethal-hits').apply(none);
    expect(lethal).toEqual({ lethalHits: true, sustainedHits: null, devastatingWounds: false });
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
    const all = { lethalHits: true, sustainedHits: 'd3', devastatingWounds: true };
    expect(activeAbilities(all).map((a) => a.label)).toEqual(['Lethal Hits', 'Sustained Hits D3', 'Devastating Wounds']);
    expect(abilitiesSummary(all)).toBe('Lethal Hits, Sustained Hits D3, Devastating Wounds');
    expect(withoutAbility(all, 'sustainedHits')).toEqual({ lethalHits: true, sustainedHits: null, devastatingWounds: true });
    expect(withoutAbility(all, 'lethalHits').lethalHits).toBe(false);
    expect(abilitiesSummary(noAbilities())).toBe('');
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
  });
});
