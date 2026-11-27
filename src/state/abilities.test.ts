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
  withLimit,
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
      'Sustained Hits X (non-Monster/Vehicle)…',
      'Devastating Wounds',
      'Devastating Wounds (non-Monster/Vehicle)',
      'Anti-Vehicle Y+…',
      'Anti-Monster Y+…',
      'Anti-Psyker Y+…',
      'Anti-Infantry Y+…',
      'Anti-Fly Y+…',
      'Blast X…',
      'Cleave X…',
      'Rapid Fire X…',
      'Melta X…',
      'Lance',
      'Twin-linked',
      'Torrent',
    ]);
    expect(ABILITY_CHOICES.filter(isAntiChoice).map((c) => c.keyword)).toEqual(['vehicle', 'monster', 'psyker', 'infantry', 'fly']);
    expect(ABILITY_CHOICES.filter(isAntiChoice).every((c) => !isValueChoice(c))).toBe(true);
    expect(ABILITY_CHOICES.filter(isValueChoice).map((c) => c.valueKey)).toEqual(['sustainedHits', 'sustainedHits', 'blast', 'cleave', 'rapidFire', 'melta']);
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
    const all = { lethalHits: true, sustainedHits: '1', devastatingWounds: true, blast: 'D3', cleave: '1', anti: {}, rapidFire: null, melta: null, lance: false, twinLinked: false, torrent: false, notVsMonsterVehicle: [] };
    expect(activeAbilities(all).map((a) => a.valueKey)).toEqual([undefined, 'sustainedHits', undefined, 'blast', 'cleave']);
    expect(activeAbilities(all).find((a) => a.key === 'blast')?.description).toBe('Adds D3 attacks per model for every 5 models in the target unit.');
    expect(activeAbilities(all).find((a) => a.key === 'cleave')?.description).toMatch(/^Adds 1 attack per model/);
  });
});

describe('Rapid Fire and Lance', () => {
  it('Rapid Fire asks for X, Lance is added straight away', () => {
    expect(valued('rapid-fire').name).toBe('Rapid Fire');
    const rapid = withAbilityValue(noAbilities(), 'rapidFire', ' d3 ');
    expect(rapid.rapidFire).toBe('D3');
    expect(valued('rapid-fire').isActive(rapid)).toBe(true);
    const lance = flag('lance').apply(noAbilities());
    expect(lance).toEqual({ ...noAbilities(), lance: true });
    expect(flag('lance').isActive(lance)).toBe(true);
    expect(flag('lance').isActive(noAbilities())).toBe(false);
  });

  it('lists them after Cleave, with the condition they need', () => {
    const all = { ...noAbilities(), cleave: '1', rapidFire: '2', lance: true };
    const active = activeAbilities(all);
    expect(active.map((a) => a.label)).toEqual(['Cleave 1', 'Rapid Fire 2', 'Lance']);
    expect(active.map((a) => a.condition)).toEqual([undefined, 'halfRange', 'charged']);
    expect(active.map((a) => a.valueKey)).toEqual(['cleave', 'rapidFire', undefined]);
    expect(active[1].description).toBe('Adds 2 attacks per model when the target is within half range.');
    expect(activeAbilities({ ...noAbilities(), rapidFire: '1' })[0].description).toBe('Adds 1 attack per model when the target is within half range.');
    expect(active[2].description).toBe('Adds 1 to the wound roll if the bearer charged this turn.');
  });

  it('removes them one at a time', () => {
    const all = { ...noAbilities(), rapidFire: '2', lance: true };
    expect(withoutAbility(all, 'rapidFire')).toEqual({ ...noAbilities(), lance: true });
    expect(withoutAbility(all, 'lance')).toEqual({ ...noAbilities(), rapidFire: '2' });
  });

  it('sameAbilities compares them', () => {
    const none = noAbilities();
    expect(sameAbilities({ ...none, rapidFire: ' d3' }, { ...none, rapidFire: 'D3' })).toBe(true);
    expect(sameAbilities({ ...none, rapidFire: '1' }, { ...none, rapidFire: '2' })).toBe(false);
    expect(sameAbilities({ ...none, rapidFire: '1' }, { ...none, blast: '1' })).toBe(false);
    expect(sameAbilities({ ...none, lance: true }, none)).toBe(false);
    expect(sameAbilities({ ...none, lance: true }, { ...none, lance: true })).toBe(true);
  });
});

describe('Melta', () => {
  it('asks for X and stores it normalised', () => {
    expect(valued('melta').name).toBe('Melta');
    expect(valued('melta').label).toBe('Melta X…');
    const melta = withAbilityValue(noAbilities(), 'melta', ' d3 + 1 ');
    expect(melta.melta).toBe('D3+1');
    expect(valued('melta').isActive(melta)).toBe(true);
    expect(valued('melta').isActive(noAbilities())).toBe(false);
  });

  it('is listed after Rapid Fire, needs the target within half range, and its chip changes X', () => {
    const active = activeAbilities({ ...noAbilities(), rapidFire: '1', melta: '2', lance: true });
    expect(active.map((a) => a.label)).toEqual(['Rapid Fire 1', 'Melta 2', 'Lance']);
    expect(active[1]).toMatchObject({ key: 'melta', valueKey: 'melta', condition: 'halfRange' });
    expect(active[1].description).toBe('Adds 2 to the Damage characteristic when the target is within half range.');
    expect(abilitiesSummary({ ...noAbilities(), melta: 'd3' })).toBe('Melta D3');
  });

  it('is removed and compared like the other X abilities', () => {
    const none = noAbilities();
    expect(withoutAbility({ ...none, melta: '2', lance: true }, 'melta')).toEqual({ ...none, lance: true });
    expect(sameAbilities({ ...none, melta: ' d3' }, { ...none, melta: 'D3' })).toBe(true);
    expect(sameAbilities({ ...none, melta: '2' }, { ...none, melta: '4' })).toBe(false);
    expect(sameAbilities({ ...none, melta: '2' }, { ...none, rapidFire: '2' })).toBe(false);
    expect(sameAbilities({ ...none, melta: '2' }, none)).toBe(false);
  });
});

describe('Twin-linked', () => {
  it('is added straight away and listed last, without a condition', () => {
    const twin = flag('twin-linked').apply(noAbilities());
    expect(twin).toEqual({ ...noAbilities(), twinLinked: true });
    expect(flag('twin-linked').isActive(twin)).toBe(true);
    expect(flag('twin-linked').isActive(noAbilities())).toBe(false);
    const active = activeAbilities({ ...twin, lance: true, lethalHits: true });
    expect(active.map((a) => a.label)).toEqual(['Lethal Hits', 'Lance', 'Twin-linked']);
    expect(active[2]).toEqual({ key: 'twinLinked', label: 'Twin-linked', description: 'A failed wound roll is re-rolled once.' });
  });

  it('is removed and compared like the other flags', () => {
    const none = noAbilities();
    expect(withoutAbility({ ...none, twinLinked: true, lance: true }, 'twinLinked')).toEqual({ ...none, lance: true });
    expect(sameAbilities({ ...none, twinLinked: true }, none)).toBe(false);
    expect(sameAbilities({ ...none, twinLinked: true }, { ...none, twinLinked: true })).toBe(true);
    expect(abilitiesSummary({ ...none, twinLinked: true })).toBe('Twin-linked');
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

describe('Torrent', () => {
  it('is an on / off ability that is summarised and compared like the others', () => {
    const torrent = flag('torrent').apply(noAbilities());
    expect(torrent).toEqual({ ...noAbilities(), torrent: true });
    expect(flag('torrent').isActive(torrent)).toBe(true);
    expect(activeAbilities(torrent).map((a) => a.label)).toEqual(['Torrent']);
    expect(abilitiesSummary({ ...torrent, lethalHits: true })).toBe('Lethal Hits, Torrent');
    expect(sameAbilities(torrent, noAbilities())).toBe(false);
    expect(withoutAbility(torrent, 'torrent')).toEqual(noAbilities());
  });
});

describe('non-Monster / non-Vehicle abilities', () => {
  it('Sustained Hits and Devastating Wounds each have a limited choice; both leave the dropdown once the ability is set', () => {
    expect(valued('sustained-hits').limited).toBe(false);
    expect(valued('sustained-hits-limited').limited).toBe(true);
    const sustained = withLimit(withAbilityValue(noAbilities(), 'sustainedHits', '1'), 'sustainedHits', true);
    expect(valued('sustained-hits').isActive(sustained)).toBe(true);
    expect(valued('sustained-hits-limited').isActive(sustained)).toBe(true);

    const limited = flag('devastating-wounds-limited').apply(noAbilities());
    expect(limited).toEqual({ ...noAbilities(), devastatingWounds: true, notVsMonsterVehicle: ['devastatingWounds'] });
    expect(flag('devastating-wounds').isActive(limited)).toBe(true);
    // The plain choice clears a leftover limit.
    expect(flag('devastating-wounds').apply({ ...noAbilities(), notVsMonsterVehicle: ['devastatingWounds'] }).notVsMonsterVehicle).toEqual([]);
  });

  it('labels the limited abilities and marks them', () => {
    const a = withLimit(withLimit({ ...noAbilities(), sustainedHits: '1', devastatingWounds: true, lethalHits: true }, 'devastatingWounds', true), 'sustainedHits', true);
    expect(a.notVsMonsterVehicle).toEqual(['sustainedHits', 'devastatingWounds']);
    const active = activeAbilities(a);
    expect(active.map((x) => x.label)).toEqual(['Lethal Hits', 'Sustained Hits 1 (non-Monster/Vehicle)', 'Devastating Wounds (non-Monster/Vehicle)']);
    expect(active.map((x) => x.limited)).toEqual([undefined, true, true]);
    expect(active[1].valueKey).toBe('sustainedHits');
    expect(active[2].description).toMatch(/does not apply against a Monster or Vehicle target\.$/);
    expect(abilitiesSummary(a)).toBe('Lethal Hits, Sustained Hits 1 (non-Monster/Vehicle), Devastating Wounds (non-Monster/Vehicle)');
  });

  it('keeps the limit when X changes, and drops it with the ability', () => {
    const a = withLimit({ ...noAbilities(), sustainedHits: '1', devastatingWounds: true }, 'sustainedHits', true);
    expect(withAbilityValue(a, 'sustainedHits', 'd3').notVsMonsterVehicle).toEqual(['sustainedHits']);
    expect(withoutAbility(a, 'sustainedHits')).toEqual({ ...noAbilities(), devastatingWounds: true });
    expect(withLimit(a, 'sustainedHits', false).notVsMonsterVehicle).toEqual([]);
    expect(a.notVsMonsterVehicle).toEqual(['sustainedHits']);
  });

  it('sameAbilities compares the limit', () => {
    const plain = { ...noAbilities(), devastatingWounds: true };
    expect(sameAbilities(plain, withLimit(plain, 'devastatingWounds', true))).toBe(false);
    expect(sameAbilities(withLimit(plain, 'devastatingWounds', true), withLimit(plain, 'devastatingWounds', true))).toBe(true);
  });
});
