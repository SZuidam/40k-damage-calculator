import { abilitySummary, conditionNeeds, situationName, type AbilityContext, type SourcedAbility } from '../state/unitAbilities';
import { KEYWORD_NAMES, WEAPON_TYPE_NAMES, type WeaponType } from '../types';
import { h } from './dom';

/** Whether an ability of the attack is active, and if not, what it is waiting for. */
export interface AbilityStatus {
  active: boolean;
  /** "Needs: Ingress move", "Needs a Monster target", "No melee weapon ticked"; '' when active. */
  reason: string;
}

/**
 * The status of `sourced` for the attack: active when every situation is on, the target has the
 * keyword it needs and at least one ticked weapon is of its weapon type.
 */
export function abilityStatus(sourced: SourcedAbility, carriedTypes: readonly WeaponType[], ctx: AbilityContext): AbilityStatus {
  const { when } = sourced.ability;
  const needs = conditionNeeds(when, null, ctx);
  if (needs.situations.length > 0) return { active: false, reason: `Needs: ${needs.situations.map(situationName).join(', ')}` };
  if (needs.targetKeyword && when.targetKeyword !== null) return { active: false, reason: `Needs a ${KEYWORD_NAMES[when.targetKeyword]} target` };
  if (when.weaponType !== 'any' && !carriedTypes.includes(when.weaponType)) return { active: false, reason: `No ${WEAPON_TYPE_NAMES[when.weaponType].toLowerCase()} weapon ticked` };
  if (when.weaponType === 'any' && carriedTypes.length === 0) return { active: false, reason: 'No weapon ticked' };
  return { active: true, reason: '' };
}

const ORIGIN_TEXT = {
  unit: (from: string) => `Ability of ${from}`,
  leader: (from: string) => `From the leader, ${from}`,
  army: (from: string) => `Army rule of ${from}`,
};

export interface AbilitiesLine {
  /** Redraw the chips for these abilities and statuses (after any input changed). */
  update(abilities: readonly SourcedAbility[], carriedTypes: readonly WeaponType[], ctx: AbilityContext): void;
}

/**
 * The "Abilities" line under the attack conditions: one chip per unit, leader and army ability
 * of the attack. A chip is outlined while the ability applies and muted with what it still
 * needs ("Needs: Ingress move") while it doesn't. Hidden when there are none.
 */
export function renderAbilitiesLine(container: HTMLElement): AbilitiesLine {
  const list = h('ul', { class: 'attack-abilities-list', 'aria-label': 'Abilities of the attack' });
  const element = h('div', { class: 'attack-abilities', hidden: true }, h('span', { class: 'attack-abilities-label', 'aria-hidden': 'true' }, 'Abilities'), list);
  container.append(element);
  return {
    update(abilities, carriedTypes, ctx) {
      element.hidden = abilities.length === 0;
      list.replaceChildren(
        ...abilities.map((sourced) => {
          const { active, reason } = abilityStatus(sourced, carriedTypes, ctx);
          const title = `${ORIGIN_TEXT[sourced.origin](sourced.from)}: ${abilitySummary(sourced.ability)}${sourced.ability.description ? `\n${sourced.ability.description}` : ''}${active ? '\nActive.' : `\n${reason}.`}`;
          return h(
            'li',
            { class: `attack-ability ${active ? 'is-active' : 'is-waiting'} attack-ability--${sourced.origin}`, title },
            h('span', { class: 'attack-ability-name' }, sourced.ability.name),
            active ? h('span', { class: 'visually-hidden' }, ' (active)') : h('span', { class: 'attack-ability-reason' }, reason),
          );
        }),
      );
    },
  };
}
