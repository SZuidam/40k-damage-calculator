import { describe, expect, it } from 'vitest';
import { noAbilities } from '../types';
import {
  ABILITY_CHOICES,
  abilitiesSummary,
  activeAbilities,
  isAntiChoice,
  isValueChoice,
  parseAntiValue,
  sameAbilities,
  withAbilityValue,
  withAntiValue,
  withoutAbility,
  withoutAnti,
  type AntiAbilityChoice,
  type FlagAbilityChoice,
  type ValueAbilityChoice,
} from './abilities';

const choice = (value: string) => {
  const found = ABILITY_CHOICES.find((c) => c.value === value);
  if (!found) throw new Error(`No choice ${value}`);
  return found;
};
const flag = (value: string) => choice(value) as FlagAbilityChoice;
const valued = (value: string) => choice(value) as ValueAbilityChoice;
const antiChoice = (value: string) => choice(value) as AntiAbilityChoice;

describe('ability choices', () => {
  it('offers one choice per ability; the ones with an X ask for it', () => {
    expect(ABILITY_CHOICES.map((c) => c.label)).toEqual([
      'Lethal Hits',
      'Sustained Hits X…',
      'Devastating Wounds',
      'Anti-Vehicle Y+…',
      'Anti-Monster Y+…',
      'Anti-Psyker Y+…',
      'Anti-Infantry Y+…',
      'Anti-Fly Y+…',
      'Blast X…',
      'Cleave X…',
    ]);
    expect(ABILITY_CHOICES.filter(isAntiChoice).map((c) => c.keyword)).toEqual(['vehicle', 'monster', 'psyker', 'infantry', 'fly']);
    expect(ABILITY_CHOICES.filter(isAntiChoice).every((c) => !isValueChoice(c))).toBe(true);
    expect(ABILITY_CHOICES.filter(isValueChoice).map((c) => c.valueKey)).toEqual(['sustainedHits', 'blast', 'cleave']);
  });

  it('adds abilities without changing the input', () => {
    const none = noAbilities();
    const lethal = flag('lethal-hits').apply(none);
    expect(lethal).toEqual({ ...noAbilities(), lethalHits: true, sustainedHits: null, devastatingWounds: false });
    expect(none.lethalHits).toBe(false);
    expect(flag('lethal-hits').isActive(lethal)).toBe(true);
  });

  it('stores X normalised, replaces it, and keeps Blast and Cleave apart', () => {
    const none = noAbilities();
    const blast = withAbilityValue(none, 'blast', ' d6 + 2 ');
    expect(blast.blast).toBe('D6+2');
    expect(none.blast).toBeNull();
    expect(withAbilityValue(blast, 'blast', '3').blast).toBe('3');
    const both = withAbilityValue(blast, 'cleave', '1');
    expect([both.blast, both.cleave]).toEqual(['D6+2', '1']);
    expect(withAbilityValue(none, 'sustainedHits', 'd3').sustainedHits).toBe('D3');
  });

  it('a value ability leaves the dropdown once added, whatever its X', () => {
    const blast = withAbilityValue(noAbilities(), 'blast', '2D6');
    expect(valued('blast').isActive(blast)).toBe(true);
    expect(valued('cleave').isActive(blast)).toBe(false);
    expect(valued('blast').isActive(withoutAbility(blast, 'blast'))).toBe(false);
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

    const bonus = { ...noAbilities(), blast: 'd6+2', cleave: '2' };
    expect(abilitiesSummary(bonus)).toBe('Blast D6+2, Cleave 2');
    expect(withoutAbility(bonus, 'blast')).toEqual({ ...noAbilities(), cleave: '2' });
    expect(withoutAbility(bonus, 'cleave')).toEqual({ ...noAbilities(), blast: 'd6+2' });
  });

  it('marks the abilities with an X as editable', () => {
    const all = { lethalHits: true, sustainedHits: '1', devastatingWounds: true, blast: 'D3', cleave: '1', anti: {} };
    expect(activeAbilities(all).map((a) => a.valueKey)).toEqual([undefined, 'sustainedHits', undefined, 'blast', 'cleave']);
    expect(activeAbilities(all).find((a) => a.key === 'blast')?.description).toBe('Adds D3 attacks per model for every 5 models in the target unit.');
    expect(activeAbilities(all).find((a) => a.key === 'cleave')?.description).toMatch(/^Adds 1 attack per model/);
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
    expect(sameAbilities({ ...none, blast: '1' }, none)).toBe(false);
    expect(sameAbilities({ ...none, blast: '1' }, { ...none, cleave: '1' })).toBe(false);
    expect(sameAbilities({ ...none, cleave: '2' }, { ...none, cleave: '2' })).toBe(true);
    expect(sameAbilities({ ...none, blast: 'd6+2' }, { ...none, blast: 'D6+2' })).toBe(true);
    expect(sameAbilities({ ...none, blast: 'D6+2' }, { ...none, blast: 'D6+1' })).toBe(false);
  });
});

describe('Anti-X Y+', () => {
  it('one choice per keyword, which leaves the dropdown once that keyword is set', () => {
    const anti = withAntiValue(noAbilities(), ['vehicle'], 4);
    expect(antiChoice('anti-vehicle').isActive(anti)).toBe(true);
    expect(antiChoice('anti-monster').isActive(anti)).toBe(false);
    expect(antiChoice('anti-vehicle').isActive(withoutAnti(anti, ['vehicle']))).toBe(false);
  });

  it('sets and removes Y per keyword without changing the input', () => {
    const none = noAbilities();
    const vehicle = withAntiValue(none, ['vehicle'], 4);
    expect(vehicle.anti).toEqual({ vehicle: 4 });
    expect(none.anti).toEqual({});
    const both = withAntiValue(vehicle, ['vehicle', 'monster'], 3);
    expect(both.anti).toEqual({ vehicle: 3, monster: 3 });
    expect(vehicle.anti).toEqual({ vehicle: 4 });
    expect(withoutAnti(both, ['monster']).anti).toEqual({ vehicle: 3 });
    expect(withoutAnti(both, ['vehicle', 'monster']).anti).toEqual({});
    expect(both.anti).toEqual({ vehicle: 3, monster: 3 });
  });

  it('shows keywords with the same Y as one chip, after Devastating Wounds', () => {
    const a = { ...noAbilities(), devastatingWounds: true, blast: '1', anti: { monster: 4, vehicle: 4 } };
    const active = activeAbilities(a);
    expect(active.map((x) => x.label)).toEqual(['Devastating Wounds', 'Anti-Vehicle/Monster 4+', 'Blast 1']);
    expect(active[1].anti).toEqual({ keywords: ['vehicle', 'monster'], value: 4 });
    expect(active[1].description).toBe('An unmodified wound roll of 4+ against a Vehicle or Monster target is a critical wound (it always wounds).');
    expect(abilitiesSummary(a)).toBe('Devastating Wounds, Anti-Vehicle/Monster 4+, Blast 1');
  });

  it('shows different Ys as separate chips, ordered by their first keyword', () => {
    const a = { ...noAbilities(), anti: { infantry: 4, monster: 3, vehicle: 4, fly: 2 } };
    expect(activeAbilities(a).map((x) => x.label)).toEqual(['Anti-Vehicle/Infantry 4+', 'Anti-Monster 3+', 'Anti-Fly 2+']);
    expect(activeAbilities({ ...noAbilities(), anti: { vehicle: 4, monster: 4, psyker: 4 } })[0].description).toMatch(/against a Vehicle, Monster or Psyker target/);
  });

  it('withoutAbility(anti) removes every Anti', () => {
    expect(withoutAbility({ ...noAbilities(), anti: { vehicle: 4, fly: 2 } }, 'anti')).toEqual(noAbilities());
  });

  it('parses Y with or without "+", 2 to 6 only', () => {
    expect(parseAntiValue('4')).toBe(4);
    expect(parseAntiValue('4+')).toBe(4);
    expect(parseAntiValue(' 2 + ')).toBe(2);
    expect(parseAntiValue('6+')).toBe(6);
    for (const bad of ['', '1', '7', '1+', '4++', '+4', 'abc', '4.5', 'D6']) expect(parseAntiValue(bad)).toBeNull();
  });

  it('sameAbilities compares Y per keyword', () => {
    const none = noAbilities();
    expect(sameAbilities({ ...none, anti: { vehicle: 4 } }, { ...none, anti: { vehicle: 4 } })).toBe(true);
    expect(sameAbilities({ ...none, anti: { vehicle: 4, monster: 4 } }, { ...none, anti: { monster: 4, vehicle: 4 } })).toBe(true);
    expect(sameAbilities({ ...none, anti: { vehicle: 4 } }, { ...none, anti: { vehicle: 3 } })).toBe(false);
    expect(sameAbilities({ ...none, anti: { vehicle: 4 } }, { ...none, anti: { monster: 4 } })).toBe(false);
    expect(sameAbilities({ ...none, anti: { vehicle: 4 } }, none)).toBe(false);
  });
});
