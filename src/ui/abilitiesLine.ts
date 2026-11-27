import { abilityNeeds, abilitySummary, conditionName, isUnitLevelOnly, type AbilityContext, type SourcedAbility } from '../state/unitAbilities';
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
 * The status of `sourced` for the attack: active when it is switched on (if it is switched on by
 * hand), every built-in condition it needs is on, the target has the keyword it needs and at
 * least one ticked weapon is of its weapon type. An ability that only inflicts mortal wounds
 * doesn't need a weapon: it is rolled for the unit.
 */
export function abilityStatus(sourced: SourcedAbility, carriedTypes: readonly WeaponType[], ctx: AbilityContext): AbilityStatus {
  const { when } = sourced.ability;
  const needs = abilityNeeds(sourced.ability, null, ctx);
  if (needs.toggle) return { active: false, reason: 'Switched off' };
  if (needs.conditions.length > 0) return { active: false, reason: `Needs: ${needs.conditions.map(conditionName).join(', ')}` };
  if (needs.targetKeyword && when.targetKeyword !== null) return { active: false, reason: `Needs a ${KEYWORD_NAMES[when.targetKeyword]} target` };
  if (isUnitLevelOnly(sourced.ability)) return { active: true, reason: '' };
  if (when.weaponType !== 'any' && !carriedTypes.includes(when.weaponType)) return { active: false, reason: `No ${WEAPON_TYPE_NAMES[when.weaponType].toLowerCase()} weapon ticked` };
  if (when.weaponType === 'any' && carriedTypes.length === 0) return { active: false, reason: 'No weapon ticked' };
  return { active: true, reason: '' };
}

const ORIGIN_TEXT = {
  unit: (from: string) => `Ability of ${from}`,
  leader: (from: string) => `From the leader, ${from}`,
  army: (from: string) => `Army rule of ${from}`,
};

export interface AbilitiesLineOptions {
  /** The ids of the abilities switched on by hand, mutated in place. */
  toggles: string[];
  /** An ability was switched on or off. */
  onToggle: () => void;
}

export interface AbilitiesLine {
  /** Redraw the chips for these abilities and statuses (after any input changed). */
  update(abilities: readonly SourcedAbility[], carriedTypes: readonly WeaponType[], ctx: AbilityContext): void;
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
  const list = h('ul', { class: 'attack-abilities-list', 'aria-label': 'Abilities of the attack' });
  const element = h('div', { class: 'attack-abilities', hidden: true }, h('span', { class: 'attack-abilities-label', 'aria-hidden': 'true' }, 'Abilities'), list);
  container.append(element);

  const toggleChip = (sourced: SourcedAbility, active: boolean, reason: string, title: string) => {
    const { id, name } = sourced.ability;
    const on = toggles.includes(id);
    const box = h('input', { id: `ability-toggle-${id}`, type: 'checkbox', class: 'toggle-input', checked: on });
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
    update(abilities, carriedTypes, ctx) {
      element.hidden = abilities.length === 0;
      // Keep focus on a toggle that is rebuilt.
      const focused = document.activeElement instanceof HTMLInputElement && list.contains(document.activeElement) ? document.activeElement.id : null;
      list.replaceChildren(
        ...abilities.map((sourced) => {
          const { active, reason } = abilityStatus(sourced, carriedTypes, ctx);
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
