import { describe, expect, it } from 'vitest';
import type { SourcedAbility } from '../state/unitAbilities';
import { noConditions, type AbilityCondition, type WeaponType } from '../types';
import { abilityStatus } from './abilitiesLine';

const sourced = (when: Partial<AbilityCondition>): SourcedAbility => ({
  ability: { id: 'a', name: 'A', description: '', appliesTo: 'unit', when: { toggle: false, conditions: [], weaponType: 'any', targetKeyword: null, ...when }, effects: [{ kind: 'stat', stat: 'attacks', amount: 1 }] },
  origin: 'unit',
  from: 'Intercessors',
});

const ctx = { conditions: noConditions(), toggles: [] as string[], keywords: ['infantry' as const] };

describe('abilityStatus', () => {
  it('is active when its toggle and conditions are on, the target fits and a weapon of its type is ticked', () => {
    expect(abilityStatus(sourced({}), ['ranged'], ctx)).toEqual({ active: true, reason: '' });
    expect(abilityStatus(sourced({ conditions: ['charged'], weaponType: 'melee' }), ['ranged', 'melee'], { ...ctx, conditions: { halfRange: false, charged: true } }).active).toBe(true);
    expect(abilityStatus(sourced({ toggle: true }), ['ranged'], { ...ctx, toggles: ['a'] }).active).toBe(true);
  });

  it('says what it is waiting for', () => {
    expect(abilityStatus(sourced({ toggle: true, conditions: ['charged'] }), ['ranged'], ctx).reason).toBe('Switched off');
    expect(abilityStatus(sourced({ toggle: true, conditions: ['halfRange', 'charged'] }), ['ranged'], { ...ctx, toggles: ['a'] }).reason).toBe('Needs: Half range, Charged');
    expect(abilityStatus(sourced({ targetKeyword: 'monster' }), ['ranged'], ctx).reason).toBe('Needs a Monster target');
    expect(abilityStatus(sourced({ weaponType: 'melee' }), ['ranged'], ctx).reason).toBe('No melee weapon ticked');
    expect(abilityStatus(sourced({}), [], ctx).reason).toBe('No weapon ticked');
  });

  it('for the defender: the attacker is the target, and "S > T" needs a ticked weapon stronger than its Toughness', () => {
    const hide = sourced({});
    hide.ability.effects = [{ kind: 'woundPenalty', strongerOnly: true }];
    hide.origin = 'defender';
    const defense = (...weapons: [WeaponType, number][]) => ({ toughness: 4, weapons: weapons.map(([type, strength]) => ({ type, strength })) });
    expect(abilityStatus(hide, ['ranged'], ctx, defense(['ranged', 5]))).toEqual({ active: true, reason: '' });
    expect(abilityStatus(hide, ['ranged'], ctx, defense(['ranged', 4])).reason).toBe('Needs S above T 4');
    expect(abilityStatus(hide, [], ctx, defense()).reason).toBe('No weapon ticked');
    hide.ability.when.weaponType = 'melee';
    expect(abilityStatus(hide, ['ranged', 'melee'], ctx, defense(['ranged', 8], ['melee', 4])).reason).toBe('Needs S above T 4');
    expect(abilityStatus(hide, ['ranged', 'melee'], ctx, defense(['ranged', 8], ['melee', 5])).active).toBe(true);
    hide.ability.when = { ...hide.ability.when, weaponType: 'any', targetKeyword: 'monster' };
    expect(abilityStatus(hide, ['ranged'], ctx, defense(['ranged', 5])).reason).toBe('Needs a Monster attacker');
    // Always -1: no Strength needed.
    hide.ability.when.targetKeyword = null;
    hide.ability.effects = [{ kind: 'woundPenalty', strongerOnly: false }];
    expect(abilityStatus(hide, ['ranged'], ctx, defense(['ranged', 3])).active).toBe(true);
  });

  it('needs no weapon for an ability that only inflicts mortal wounds', () => {
    const hammer = sourced({ conditions: ['charged'], weaponType: 'melee' });
    hammer.ability.effects = [{ kind: 'mortalWounds', on: 4, perSuccess: '1' }];
    expect(abilityStatus(hammer, [], ctx).reason).toBe('Needs: Charged');
    expect(abilityStatus(hammer, ['ranged'], { ...ctx, conditions: { halfRange: false, charged: true } })).toEqual({ active: true, reason: '' });
  });
});
