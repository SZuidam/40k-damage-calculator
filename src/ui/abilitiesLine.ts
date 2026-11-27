import { abilityNeeds, abilitySummary, conditionName, isDefensiveEffect, isUnitLevelOnly, type AbilityContext, type AbilityOrigin, type SourcedAbility } from '../state/unitAbilities';
import { KEYWORD_NAMES, WEAPON_TYPE_NAMES, type WeaponType } from '../types';
import { h } from './dom';
import { markupToText } from './markup';

/** Whether an ability of the attack is active, and if not, what it is waiting for. */
export interface AbilityStatus {
  active: boolean;
  /** "Switched off", "Needs: Charged", "Needs a Monster target", "No melee weapon ticked"; '' when active. */
  reason: string;
}

/**
 * For the defender's abilities: its Toughness and the attacking weapons (their type and their
 * Strength after the attacker's abilities), to tell whether a "-1 to wound if S > T" can apply.
 */
export interface DefenseStatus {
  toughness: number;
  weapons: readonly { type: WeaponType; strength: number }[];
}

/**
 * The status of `sourced` for the attack: active when it is switched on (if it is switched on by
 * hand), every built-in condition it needs is on, the target has the keyword it needs and at
 * least one ticked weapon is of its weapon type. An ability that only inflicts mortal wounds
 * doesn't need a weapon: it is rolled for the unit. With `defense` it is one of the defender's
 * abilities: its "target" is the attacking unit, and an ability whose defensive effects all need
 * S > T also needs a ticked weapon of its type with a Strength above the defender's Toughness.
 */
export function abilityStatus(sourced: SourcedAbility, carriedTypes: readonly WeaponType[], ctx: AbilityContext, defense?: DefenseStatus): AbilityStatus {
  const { ability } = sourced;
  const { when } = ability;
  const needs = abilityNeeds(ability, null, ctx);
  if (needs.toggle) return { active: false, reason: 'Switched off' };
  if (needs.conditions.length > 0) return { active: false, reason: `Needs: ${needs.conditions.map(conditionName).join(', ')}` };
  if (needs.targetKeyword && when.targetKeyword !== null) return { active: false, reason: `Needs a ${KEYWORD_NAMES[when.targetKeyword]} ${defense ? 'attacker' : 'target'}` };
  if (!defense && isUnitLevelOnly(ability)) return { active: true, reason: '' };
  if (when.weaponType !== 'any' && !carriedTypes.includes(when.weaponType)) return { active: false, reason: `No ${WEAPON_TYPE_NAMES[when.weaponType].toLowerCase()} weapon ticked` };
  if (when.weaponType === 'any' && carriedTypes.length === 0) return { active: false, reason: 'No weapon ticked' };
  if (defense) {
    const defensive = ability.effects.filter(isDefensiveEffect);
    const strongerOnly = defensive.length > 0 && defensive.every((e) => e.kind === 'woundPenalty' && e.strongerOnly);
    const matching = defense.weapons.filter((w) => when.weaponType === 'any' || w.type === when.weaponType);
    if (strongerOnly && !matching.some((w) => w.strength > defense.toughness)) return { active: false, reason: `Needs S above T ${defense.toughness}` };
  }
  return { active: true, reason: '' };
}

const ORIGIN_TEXT: Record<AbilityOrigin, (from: string) => string> = {
  unit: (from) => `Ability of ${from}`,
  leader: (from) => `From the leader, ${from}`,
  army: (from) => `Army rule of ${from}`,
  defender: (from) => `Ability of the defender, ${from}`,
  defenderArmy: (from) => `Army rule of the defender’s army, ${from}`,
};

export interface AbilitiesLineOptions {
  /** The ids of the abilities switched on by hand, mutated in place. */
  toggles: string[];
  /** An ability was switched on or off. */
  onToggle: () => void;
  /** Whose abilities: the attack's (the default) or the defender's; sets the ids and labels. */
  side?: 'attack' | 'defense';
}

export interface AbilitiesLine {
  /**
   * Redraw the chips for these abilities and statuses (after any input changed). `defense` is
   * given for the defender's line (see abilityStatus).
   */
  update(abilities: readonly SourcedAbility[], carriedTypes: readonly WeaponType[], ctx: AbilityContext, defense?: DefenseStatus): void;
}

/**
 * The "Abilities" line under the attack conditions: one chip per unit, leader and army ability
 * of the attack. A chip is outlined while the ability applies and muted with what it still
 * needs ("Needs: Charged") while it doesn't. An ability that is switched on by hand is a toggle
 * pill with its name instead, like the conditions; switched on, it is filled while it applies
 * and dashed with what else it needs while it doesn't. Hidden when there are none.
 */
export function renderAbilitiesLine(container: HTMLElement, options: AbilitiesLineOptions): AbilitiesLine {
  const { toggles } = options;
  const defenseSide = options.side === 'defense';
  // The same unit can attack and defend: its toggle then shows on both lines, each with its own element id.
  const idPrefix = defenseSide ? 'defense-ability-toggle' : 'ability-toggle';
  const list = h('ul', { class: 'attack-abilities-list', 'aria-label': defenseSide ? 'Abilities of the defender' : 'Abilities of the attack' });
  const element = h(
    'div',
    { class: `attack-abilities${defenseSide ? ' attack-abilities--defense' : ''}`, hidden: true },
    h('span', { class: 'attack-abilities-label', 'aria-hidden': 'true' }, 'Abilities'),
    list,
  );
  container.append(element);

  const toggleChip = (sourced: SourcedAbility, active: boolean, reason: string, title: string) => {
    const { id, name } = sourced.ability;
    const on = toggles.includes(id);
    const box = h('input', { id: `${idPrefix}-${id}`, type: 'checkbox', class: 'toggle-input', checked: on });
    box.addEventListener('change', () => {
      const index = toggles.indexOf(id);
      if (box.checked && index < 0) toggles.push(id);
      if (!box.checked && index >= 0) toggles.splice(index, 1);
      options.onToggle();
    });
    const waiting = on && !active;
    return h(
      'li',
      { class: `attack-ability-toggle attack-ability--${sourced.origin}${waiting ? ' is-waiting' : ''}` },
      h(
        'label',
        { class: 'toggle-pill', title },
        box,
        h('span', {}, name, waiting ? h('small', { class: 'attack-ability-reason' }, reason) : null),
      ),
    );
  };

  return {
    update(abilities, carriedTypes, ctx, defense) {
      element.hidden = abilities.length === 0;
      // Keep focus on a toggle that is rebuilt.
      const focused = document.activeElement instanceof HTMLInputElement && list.contains(document.activeElement) ? document.activeElement.id : null;
      list.replaceChildren(
        ...abilities.map((sourced) => {
          const { active, reason } = abilityStatus(sourced, carriedTypes, ctx, defense);
          const { description, when } = sourced.ability;
          const title = [
            `${ORIGIN_TEXT[sourced.origin](sourced.from)}: ${abilitySummary(sourced.ability)}`,
            description ? markupToText(description) : '',
            active ? 'Active.' : `${reason}.`,
          ]
            .filter(Boolean)
            .join('\n');
          if (when.toggle) return toggleChip(sourced, active, reason, title);
          return h(
            'li',
            { class: `attack-ability ${active ? 'is-active' : 'is-waiting'} attack-ability--${sourced.origin}`, title },
            h('span', { class: 'attack-ability-name' }, sourced.ability.name),
            active ? h('span', { class: 'visually-hidden' }, ' (active)') : h('span', { class: 'attack-ability-reason' }, reason),
          );
        }),
      );
      if (focused) document.getElementById(focused)?.focus();
    },
  };
}
