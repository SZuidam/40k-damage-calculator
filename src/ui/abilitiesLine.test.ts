import { describe, expect, it } from 'vitest';
import type { SourcedAbility } from '../state/unitAbilities';
import { noConditions, type AbilityCondition } from '../types';
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

  it('needs no weapon for an ability that only inflicts mortal wounds', () => {
    const hammer = sourced({ conditions: ['charged'], weaponType: 'melee' });
    hammer.ability.effects = [{ kind: 'mortalWounds', on: 4, perSuccess: '1' }];
    expect(abilityStatus(hammer, [], ctx).reason).toBe('Needs: Charged');
    expect(abilityStatus(hammer, ['ranged'], { ...ctx, conditions: { halfRange: false, charged: true } })).toEqual({ active: true, reason: '' });
  });
});
