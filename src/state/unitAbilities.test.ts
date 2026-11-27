import { describe, expect, it } from 'vitest';
import { weapon } from '../engine/testFixtures';
import { noAbilities, noConditions, type AbilityEffect, type Army, type Unit, type UnitAbility } from '../types';
import {
  abilitiesFor,
  abilitySummary,
  activeFor,
  addToDice,
  applyAbilities,
  abilityNeeds,
  canLead,
  copyAbility,
  grantAbilities,
  effectSummary,
  isActive,
  isUnitLevelOnly,
  mortalWoundSources,
  pruneToggles,
  sameAbilityContent,
  type AbilityContext,
} from './unitAbilities';

const ability = (name: string, effects: AbilityEffect[], overrides: Partial<UnitAbility> = {}): UnitAbility => ({
  id: `a-${name}`,
  name,
  description: '',
  appliesTo: 'unit',
  when: { toggle: false, conditions: [], weaponType: 'any', targetKeyword: null },
  effects,
  ...overrides,
});

const unit = (overrides: Partial<Unit> = {}): Unit => ({
  id: 'u1',
  name: 'Intercessors',
  armyId: 'sm',
  toughness: 4,
  save: 3,
  invuln: null,
  wounds: 2,
  keywords: ['infantry'],
  weapons: [],
  abilities: [],
  ...overrides,
});

const ctx = (overrides: Partial<AbilityContext> = {}): AbilityContext => ({ conditions: noConditions(), toggles: [], keywords: ['infantry'], ...overrides });

const shockAssault = ability('Shock Assault', [{ kind: 'stat', stat: 'attacks', amount: 1 }], { when: { toggle: false, conditions: ['charged'], weaponType: 'melee', targetKeyword: null } });

describe('addToDice', () => {
  it('folds +X into the constant of a dice expression', () => {
    expect(addToDice('2', 1)).toBe('3');
    expect(addToDice('D6', 1)).toBe('D6+1');
    expect(addToDice('d6+1', 2)).toBe('D6+3');
    expect(addToDice('2D3', 0)).toBe('2D3');
    expect(addToDice('nonsense', 1)).toBe('nonsense');
  });
});

describe('isActive', () => {
  it('needs its toggle and every condition on, the weapon type and the target keyword', () => {
    expect(isActive(shockAssault, 'melee', ctx())).toBe(false);
    expect(isActive(shockAssault, 'melee', ctx({ conditions: { halfRange: false, charged: true } }))).toBe(true);
    expect(isActive(shockAssault, 'ranged', ctx({ conditions: { halfRange: false, charged: true } }))).toBe(false);

    const ingress = ability('Ingress', [{ kind: 'roll', roll: 'hit', amount: 1 }], { when: { toggle: true, conditions: ['halfRange'], weaponType: 'any', targetKeyword: null } });
    const halfRange = { halfRange: true, charged: false };
    expect(isActive(ingress, 'ranged', ctx({ toggles: ['a-Ingress'] }))).toBe(false);
    expect(isActive(ingress, 'ranged', ctx({ conditions: halfRange }))).toBe(false);
    expect(isActive(ingress, 'ranged', ctx({ toggles: ['other'], conditions: halfRange }))).toBe(false);
    expect(isActive(ingress, 'ranged', ctx({ toggles: ['a-Ingress'], conditions: halfRange }))).toBe(true);

    const monsterHunter = ability('Monster hunter', [{ kind: 'roll', roll: 'wound', amount: 1 }], { when: { toggle: false, conditions: [], weaponType: 'any', targetKeyword: 'monster' } });
    expect(isActive(monsterHunter, 'ranged', ctx())).toBe(false);
    expect(isActive(monsterHunter, 'ranged', ctx({ keywords: ['monster'] }))).toBe(true);
    expect(isActive(monsterHunter, 'ranged', ctx({ keywords: null }))).toBe(false);
  });

  it('says what is still needed', () => {
    const needs = abilityNeeds(shockAssault, 'ranged', ctx());
    expect(needs).toEqual({ toggle: false, conditions: ['charged'], weaponType: true, targetKeyword: false });
    expect(abilityNeeds(shockAssault, null, ctx()).weaponType).toBe(false);
    const oath = ability('Oath', [], { when: { toggle: true, conditions: [], weaponType: 'any', targetKeyword: null } });
    expect(abilityNeeds(oath, null, ctx()).toggle).toBe(true);
    expect(abilityNeeds(oath, null, ctx({ toggles: ['a-Oath'] })).toggle).toBe(false);
  });

  it('filters sourced abilities per weapon type', () => {
    const list = [{ ability: shockAssault }, { ability: ability('Always', [{ kind: 'stat', stat: 'strength', amount: 1 }]) }];
    const charged = ctx({ conditions: { halfRange: false, charged: true } });
    expect(activeFor(list, 'melee', charged)).toHaveLength(2);
    expect(activeFor(list, 'ranged', charged).map((a) => a.ability.name)).toEqual(['Always']);
  });
});

describe('abilitiesFor', () => {
  it('takes the unit’s own abilities, the leader’s abilities for its unit and the army rules', () => {
    const aura = ability('Rites of Battle', [{ kind: 'reroll', roll: 'hit', which: 'ones' }], { appliesTo: 'ledUnit' });
    const own = ability('Own', [{ kind: 'stat', stat: 'strength', amount: 1 }]);
    const captain = unit({ id: 'cap', name: 'Captain', abilities: [aura, ability('Captain only', [{ kind: 'stat', stat: 'damage', amount: 1 }])] });
    const squad = unit({ abilities: [own, ability('Leading', [{ kind: 'ap', amount: 1 }], { appliesTo: 'ledUnit' })] });
    const army: Army = { id: 'sm', name: 'Space Marines', abilities: [ability('Oath', [{ kind: 'reroll', roll: 'hit', which: 'failed' }])] };
    expect(abilitiesFor(squad, captain, army).map((a) => [a.ability.name, a.origin, a.from])).toEqual([
      ['Own', 'unit', 'Intercessors'],
      ['Rites of Battle', 'leader', 'Captain'],
      ['Oath', 'army', 'Space Marines'],
    ]);
    expect(abilitiesFor(squad, null, null).map((a) => a.ability.name)).toEqual(['Own']);
    expect(canLead(captain)).toBe(true);
    expect(canLead(unit({ abilities: [own] }))).toBe(false);
  });
});

describe('pruneToggles', () => {
  it('keeps only the ids of abilities that are switched on by hand', () => {
    const toggled = ability('Oath', [], { when: { toggle: true, conditions: [], weaponType: 'any', targetKeyword: null } });
    const toggles = ['gone', 'a-Oath', 'a-Shock Assault'];
    pruneToggles(toggles, [toggled, shockAssault]);
    expect(toggles).toEqual(['a-Oath']);
  });
});

describe('applyAbilities', () => {
  const base = () => weapon('Bolt rifle', 5, '2', 3, 4, -1, 'D3');

  it('adds +X to A and D dice, S, and improves AP down to -6', () => {
    const out = applyAbilities(base(), [
      ability('A', [
        { kind: 'stat', stat: 'attacks', amount: 1 },
        { kind: 'stat', stat: 'strength', amount: 2 },
        { kind: 'stat', stat: 'damage', amount: 1 },
        { kind: 'ap', amount: 1 },
      ]),
      ability('B', [{ kind: 'stat', stat: 'attacks', amount: 1 }]),
    ]);
    expect(out).toMatchObject({ attacks: '4', strength: 6, damage: 'D3+1', ap: -2 });
    expect(applyAbilities(base(), [ability('AP', [{ kind: 'ap', amount: 6 }])]).ap).toBe(-6);
  });

  it('sums roll modifiers, keeps the lowest critical threshold and the strongest re-roll', () => {
    const { modifiers } = applyAbilities(base(), [
      ability('A', [
        { kind: 'roll', roll: 'hit', amount: 1 },
        { kind: 'roll', roll: 'wound', amount: -1 },
        { kind: 'critical', roll: 'hit', on: 5 },
        { kind: 'reroll', roll: 'hit', which: 'ones' },
      ]),
      ability('B', [
        { kind: 'roll', roll: 'hit', amount: 1 },
        { kind: 'critical', roll: 'hit', on: 6 },
        { kind: 'critical', roll: 'wound', on: 4 },
        { kind: 'reroll', roll: 'hit', which: 'failed' },
        { kind: 'reroll', roll: 'wound', which: 'ones' },
      ]),
    ]);
    expect(modifiers).toEqual({ hit: 2, wound: -1, criticalHit: 5, criticalWound: 4, rerollHits: 'failed', rerollWounds: 'ones', rerollDamageBelow: 0 });
  });

  it('re-rolls damage below the Settings threshold for the dice of D', () => {
    const reroll = [ability('Re-roll', [{ kind: 'rerollDamage' }])];
    const thresholds = { d3: 3, d6: 5 };
    const withDamage = (damage: string) => ({ ...base(), damage });
    expect(applyAbilities(withDamage('D3'), reroll, thresholds).modifiers.rerollDamageBelow).toBe(3);
    expect(applyAbilities(withDamage('2D6'), reroll, thresholds).modifiers.rerollDamageBelow).toBe(5);
    // Fixed damage has nothing to re-roll.
    expect(applyAbilities(withDamage('2'), reroll, thresholds).modifiers.rerollDamageBelow).toBe(0);
    // Without thresholds the defaults apply: below 2 for D3, below 4 for D6.
    expect(applyAbilities(withDamage('D6'), reroll).modifiers.rerollDamageBelow).toBe(4);
    // D +1 from another effect keeps the D6 threshold, compared with the dice of D6+1 only.
    const plusOne = applyAbilities(withDamage('D6'), [ability('Both', [{ kind: 'stat', stat: 'damage', amount: 1 }, { kind: 'rerollDamage' }])], thresholds);
    expect(plusOne.damage).toBe('D6+1');
    expect(plusOne.modifiers.rerollDamageBelow).toBe(5);
    expect(abilitySummary(reroll[0])).toBe('Re-roll damage');
  });

  it('grants Torrent', () => {
    expect(grantAbilities(noAbilities(), { ...noAbilities(), torrent: true }).torrent).toBe(true);
  });

  it('ignores out-of-range values (validation flags them)', () => {
    const out = applyAbilities(base(), [ability('Bad', [{ kind: 'stat', stat: 'attacks', amount: 9 }, { kind: 'roll', roll: 'hit', amount: 2 }, { kind: 'critical', roll: 'hit', on: 1 }])]);
    expect(out.attacks).toBe('2');
    expect(out.modifiers).toEqual(base().modifiers);
  });

  it('grants weapon abilities without overriding the weapon’s own X, keeping the lower Anti Y', () => {
    const own = { ...noAbilities(), sustainedHits: '1', anti: { infantry: 4 } };
    const granted = { ...noAbilities(), lethalHits: true, sustainedHits: '2', blast: ' d3 ', anti: { infantry: 3, vehicle: 5 } };
    expect(grantAbilities(own, granted)).toEqual({ ...noAbilities(), lethalHits: true, sustainedHits: '1', blast: 'D3', anti: { infantry: 3, vehicle: 5 } });
    expect(grantAbilities({ ...noAbilities(), anti: { infantry: 2 } }, granted).anti.infantry).toBe(2);
    const out = applyAbilities({ ...base(), abilities: own }, [ability('Grant', [{ kind: 'grant', abilities: granted }])]);
    expect(out.abilities.lethalHits).toBe(true);
  });

  it('leaves the input profile alone', () => {
    const profile = base();
    const copy = structuredClone(profile);
    applyAbilities(profile, [ability('All', [{ kind: 'stat', stat: 'attacks', amount: 1 }, { kind: 'reroll', roll: 'hit', which: 'ones' }, { kind: 'grant', abilities: { ...noAbilities(), lance: true } }])]);
    expect(profile).toEqual(copy);
  });
});

describe('copies, comparison and summaries', () => {
  it('copies deeply and compares content without ids', () => {
    const a = ability('Grant', [{ kind: 'grant', abilities: { ...noAbilities(), anti: { vehicle: 4 } } }], { when: { toggle: true, conditions: [], weaponType: 'any', targetKeyword: null } });
    const b = copyAbility(a);
    expect(b).toEqual(a);
    if (b.effects[0].kind === 'grant') b.effects[0].abilities.anti.vehicle = 3;
    expect(a.effects[0]).toEqual({ kind: 'grant', abilities: { ...noAbilities(), anti: { vehicle: 4 } } });
    expect(sameAbilityContent(a, b)).toBe(false);
    const renumbered: UnitAbility = { ...copyAbility(a), id: 'other' };
    expect(sameAbilityContent(a, renumbered)).toBe(true);
    expect(sameAbilityContent(a, { ...copyAbility(a), when: { ...a.when, toggle: false } })).toBe(false);
    expect(sameAbilityContent(a, { ...copyAbility(a), when: { ...a.when, conditions: ['charged'] } })).toBe(false);
  });

  it('summarises the condition and the effects', () => {
    expect(abilitySummary(shockAssault)).toBe('Charged · Melee: +1 A');
    expect(abilitySummary(ability('Rites', [{ kind: 'reroll', roll: 'hit', which: 'ones' }]))).toBe('Re-roll hits of 1');
    expect(
      abilitySummary(
        ability(
          'Mix',
          [
            { kind: 'ap', amount: 1 },
            { kind: 'roll', roll: 'wound', amount: -1 },
            { kind: 'critical', roll: 'wound', on: 5 },
            { kind: 'reroll', roll: 'wound', which: 'failed' },
            { kind: 'grant', abilities: { ...noAbilities(), lethalHits: true, sustainedHits: '1' } },
          ],
          { when: { toggle: true, conditions: ['halfRange'], weaponType: 'ranged', targetKeyword: 'monster' } },
        ),
      ),
    ).toBe('Toggled · Half range · Ranged · vs Monster: Improve AP by 1, -1 to wound, Critical wounds on 5+, Re-roll failed wounds, Gain Lethal Hits, Sustained Hits 1');
  });
});

describe('mortal wounds', () => {
  const hammer = ability('Hammer of Wrath', [{ kind: 'mortalWounds', on: 4, perSuccess: '1' }], { when: { toggle: false, conditions: ['charged'], weaponType: 'melee', targetKeyword: null } });
  const charged = ctx({ conditions: { halfRange: false, charged: true } });

  it('gives one source per effect of an active ability, with the dice to roll', () => {
    expect(mortalWoundSources([hammer], charged, 11)).toEqual([{ id: 'a-Hammer of Wrath:0', name: 'Hammer of Wrath', dice: 11, on: 4, perSuccess: '1' }]);
    const two = ability('Two', [{ kind: 'mortalWounds', on: 5, perSuccess: 'd3' }, { kind: 'stat', stat: 'attacks', amount: 1 }, { kind: 'mortalWounds', on: 6, perSuccess: '2' }]);
    expect(mortalWoundSources([two], ctx(), 5).map((s) => [s.id, s.on, s.perSuccess])).toEqual([
      ['a-Two:0', 5, 'D3'],
      ['a-Two:2', 6, '2'],
    ]);
  });

  it('respects the toggle, the conditions and the target keyword, but not the weapon type', () => {
    expect(mortalWoundSources([hammer], ctx(), 10)).toEqual([]);
    expect(mortalWoundSources([hammer], charged, 10)).toHaveLength(1);
    const toggled = ability('Toggled', [{ kind: 'mortalWounds', on: 4, perSuccess: '1' }], { when: { toggle: true, conditions: [], weaponType: 'any', targetKeyword: 'monster' } });
    expect(mortalWoundSources([toggled], ctx({ keywords: ['monster'] }), 10)).toEqual([]);
    expect(mortalWoundSources([toggled], ctx({ toggles: ['a-Toggled'] }), 10)).toEqual([]);
    expect(mortalWoundSources([toggled], ctx({ toggles: ['a-Toggled'], keywords: ['monster'] }), 10)).toHaveLength(1);
  });

  it('skips invalid effects and a unit without models', () => {
    const bad = ability('Bad', [{ kind: 'mortalWounds', on: 7, perSuccess: '1' }, { kind: 'mortalWounds', on: 4, perSuccess: 'D7' }]);
    expect(mortalWoundSources([bad], ctx(), 10)).toEqual([]);
    expect(mortalWoundSources([hammer], charged, 0)).toEqual([]);
    expect(mortalWoundSources([hammer], charged, Number.NaN)).toEqual([]);
  });

  it('is ignored by applyAbilities', () => {
    const profile = weapon('Bolt rifle', 5, '2', 3, 4, -1, '1');
    expect(applyAbilities(profile, [hammer])).toEqual(profile);
  });

  it('is unit-level only when every effect inflicts mortal wounds', () => {
    expect(isUnitLevelOnly(hammer)).toBe(true);
    expect(isUnitLevelOnly(shockAssault)).toBe(false);
    expect(isUnitLevelOnly(ability('Mixed', [...hammer.effects, ...shockAssault.effects]))).toBe(false);
    expect(isUnitLevelOnly(ability('Empty', []))).toBe(false);
  });

  it('summarises the effect', () => {
    expect(effectSummary({ kind: 'mortalWounds', on: 4, perSuccess: '1' })).toBe('D6 per model, 4+: 1 MW');
    expect(effectSummary({ kind: 'mortalWounds', on: 5, perSuccess: 'd3' })).toBe('D6 per model, 5+: D3 MW');
    expect(abilitySummary(hammer)).toBe('Charged · Melee: D6 per model, 4+: 1 MW');
  });
});
