import { describe, expect, it } from 'vitest';
import type { SourcedAbility } from '../state/unitAbilities';
import { noConditions, type AbilityCondition } from '../types';
import { abilityStatus } from './abilitiesLine';

const sourced = (when: Partial<AbilityCondition>): SourcedAbility => ({
  ability: { id: 'a', name: 'A', description: '', appliesTo: 'unit', when: { situations: [], weaponType: 'any', targetKeyword: null, ...when }, effects: [{ kind: 'stat', stat: 'attacks', amount: 1 }] },
  origin: 'unit',
  from: 'Intercessors',
});

const ctx = { conditions: noConditions(), situations: [] as string[], keywords: ['infantry' as const] };

describe('abilityStatus', () => {
  it('is active when the situations are on, the target fits and a weapon of its type is ticked', () => {
    expect(abilityStatus(sourced({}), ['ranged'], ctx)).toEqual({ active: true, reason: '' });
    expect(abilityStatus(sourced({ situations: [{ builtin: 'charged' }], weaponType: 'melee' }), ['ranged', 'melee'], { ...ctx, conditions: { halfRange: false, charged: true } }).active).toBe(true);
  });

  it('says what it is waiting for', () => {
    expect(abilityStatus(sourced({ situations: [{ name: 'Ingress move' }, { builtin: 'charged' }] }), ['ranged'], ctx).reason).toBe('Needs: Ingress move, Charged');
    expect(abilityStatus(sourced({ targetKeyword: 'monster' }), ['ranged'], ctx).reason).toBe('Needs a Monster target');
    expect(abilityStatus(sourced({ weaponType: 'melee' }), ['ranged'], ctx).reason).toBe('No melee weapon ticked');
    expect(abilityStatus(sourced({}), [], ctx).reason).toBe('No weapon ticked');
  });
});
