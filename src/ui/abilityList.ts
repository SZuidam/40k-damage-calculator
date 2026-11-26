import { abilitySummary } from '../state/unitAbilities';
import type { UnitAbility } from '../types';
import { openAbilityModal } from './abilityModal';
import { h } from './dom';
import { confirmDialog } from './modal';

export interface AbilityListOptions {
  /** Mutated in place. */
  abilities: UnitAbility[];
  /** 'unit' for a unit's abilities, 'army' for army rules. */
  scope: 'unit' | 'army';
  /** Accessible name of the list, e.g. "Abilities of this unit". */
  label: string;
  /** Text of the add button. */
  addLabel: string;
  /** Custom situation names in use anywhere, for the ability modal. */
  knownSituations: () => string[];
  /** An ability was added, edited or removed. */
  onChange: () => void;
}

/** "For the unit it leads · Charged · Melee: +1 A". */
export function abilityDetail(a: UnitAbility, scope: 'unit' | 'army'): string {
  return `${scope === 'unit' && a.appliesTo === 'ledUnit' ? 'For the unit it leads · ' : ''}${abilitySummary(a)}`;
}

/**
 * A list of abilities with ✎ / ✕ per ability and a "+ New ability" button below, editing them
 * with the ability modal. Used by the unit editor (a unit's abilities) and the army rules modal.
 */
export function abilityList(options: AbilityListOptions): HTMLDivElement {
  const { abilities } = options;
  const list = h('ul', { class: 'manage-list', 'aria-label': options.label });
  const empty = h('p', { class: 'list-empty' }, options.scope === 'army' ? 'No army rules yet.' : 'No abilities yet.');
  const add = h('button', { type: 'button', class: 'button secondary ability-list-add' }, options.addLabel);
  const element = h('div', { class: 'ability-manager' }, list, empty, h('div', { class: 'panel-actions-group' }, add));

  const takenNames = (except?: UnitAbility) => abilities.filter((a) => a !== except).map((a) => a.name);
  const modalOptions = (except?: UnitAbility) => ({ scope: options.scope, takenNames: takenNames(except), knownSituations: options.knownSituations() });

  const render = (focusSelector?: string) => {
    list.replaceChildren(
      ...abilities.map((a) => {
        const edit = h('button', { type: 'button', class: 'icon-button', 'data-id': a.id, 'data-action': 'edit', 'aria-label': `Edit ${a.name}`, title: 'Edit' }, '✎');
        const remove = h('button', { type: 'button', class: 'icon-button remove', 'aria-label': `Delete ${a.name}`, title: 'Delete' }, '✕');
        edit.addEventListener('click', async () => {
          const saved = await openAbilityModal(a, modalOptions(a));
          if (saved) {
            Object.assign(a, saved);
            options.onChange();
          }
          render(`[data-id="${a.id}"][data-action="edit"]`);
        });
        remove.addEventListener('click', async () => {
          const noun = options.scope === 'army' ? 'army rule' : 'ability';
          const ok = await confirmDialog(`Delete the ${noun} "${a.name}"?`, { confirmLabel: 'Delete', danger: true, title: `Delete ${noun}` });
          if (!ok) return;
          abilities.splice(abilities.indexOf(a), 1);
          options.onChange();
          render('.ability-list-add');
        });
        return h(
          'li',
          { class: 'manage-item' },
          h(
            'div',
            { class: 'manage-text' },
            h('span', { class: 'manage-name' }, a.name),
            h('span', { class: 'manage-detail' }, abilityDetail(a, options.scope)),
            a.description ? h('span', { class: 'manage-detail ability-description' }, a.description) : null,
          ),
          h('div', { class: 'row-actions' }, edit, remove),
        );
      }),
    );
    empty.hidden = abilities.length > 0;
    if (focusSelector) element.querySelector<HTMLElement>(focusSelector)?.focus();
  };

  add.addEventListener('click', async () => {
    const saved = await openAbilityModal(undefined, modalOptions());
    if (!saved) return;
    abilities.push(saved);
    options.onChange();
    render(`[data-id="${saved.id}"][data-action="edit"]`);
  });

  render();
  return element;
}
