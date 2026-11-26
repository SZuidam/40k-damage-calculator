import {
  ABILITY_CHOICES,
  VALUE_ABILITY_NAMES,
  activeAbilities,
  antiName,
  isAntiChoice,
  isValueChoice,
  parseAntiValue,
  withAbilityValue,
  withAntiValue,
  withoutAbility,
  withoutAnti,
  type ValueAbilityKey,
} from '../state/abilities';
import type { DefenderKeyword, WeaponAbilities } from '../types';
import { openAbilityValuePopover } from './abilityValuePopover';
import { field, h } from './dom';
import { abilityValueError, antiValueError } from './validation';

/** `data-ability` of an Anti chip, used to focus it again after a change: "anti-vehicle-monster". */
const antiChipId = (keywords: DefenderKeyword[]) => `anti-${keywords.join('-')}`;

export interface WeaponAbilityEditorOptions {
  /** Id of the "Add ability…" select. */
  id: string;
  /** Label of the select's field. */
  label: string;
  /** Accessible name of the chip list. */
  listLabel: string;
  get: () => WeaponAbilities;
  /** Store the changed abilities (a new object). */
  set: (abilities: WeaponAbilities) => void;
  /** Called after every change, e.g. to validate. */
  onChange: () => void;
}

export interface WeaponAbilityEditor {
  element: HTMLDivElement;
  /** The "Add ability…" select (for error marking). */
  select: HTMLSelectElement;
}

/**
 * Weapon abilities as an "Add ability…" dropdown plus a removable chip per ability. Abilities
 * with an X (Sustained Hits, Blast, Cleave, Rapid Fire, Melta) or a Y (Anti-X Y+) ask for it in
 * a pop-up; their chip reopens it. Used by the weapon modal and by "Gain weapon abilities"
 * effects in the ability modal.
 */
export function weaponAbilityEditor(options: WeaponAbilityEditorOptions): WeaponAbilityEditor {
  const { get, set, onChange } = options;
  const abilitySelect = h('select', { id: options.id, class: 'ability-add' });
  const abilityList = h('ul', { class: 'ability-list', 'aria-label': options.listLabel });
  const abilityEditor = h('div', { class: 'ability-editor' });

  const update = (abilities: WeaponAbilities) => {
    set(abilities);
    renderAbilities();
    onChange();
  };

  const askValue = async (key: ValueAbilityKey, anchor: HTMLElement, initial: string, placeBy?: HTMLElement): Promise<boolean> => {
    const label = VALUE_ABILITY_NAMES[key];
    const value = await openAbilityValuePopover({
      container: abilityEditor,
      anchor,
      placeBy,
      title: `${label} X`,
      initial,
      validate: (x) => abilityValueError(x, label),
    });
    if (value === null) return false;
    update(withAbilityValue(get(), key, value));
    return true;
  };

  /** Ask for Y of Anti-X Y+ and set it for every keyword in `keywords` (one chip). */
  const askAnti = async (keywords: DefenderKeyword[], anchor: HTMLElement, initial: string, placeBy?: HTMLElement): Promise<boolean> => {
    const label = antiName(keywords);
    const value = await openAbilityValuePopover({
      container: abilityEditor,
      anchor,
      placeBy,
      title: `${label} Y+`,
      initial,
      placeholder: 'e.g. 4+',
      validate: (y) => antiValueError(y, label),
    });
    const y = value === null ? null : parseAntiValue(value);
    if (y === null) return false;
    update(withAntiValue(get(), keywords, y));
    return true;
  };

  const renderAbilities = () => {
    const active = activeAbilities(get());
    abilityList.replaceChildren(
      ...(active.length === 0
        ? [h('li', { class: 'ability-empty' }, 'No abilities')]
        : active.map(({ key, label, description, valueKey, anti }) => {
            const remove = h('button', { type: 'button', class: 'ability-remove', 'aria-label': `Remove ${label}`, title: 'Remove' }, '✕');
            remove.addEventListener('click', () => {
              update(anti ? withoutAnti(get(), anti.keywords) : withoutAbility(get(), key));
              abilitySelect.focus();
            });
            if (anti) {
              const edit = h('button', { type: 'button', class: 'ability-edit', 'data-ability': antiChipId(anti.keywords), title: 'Change Y', 'aria-label': `${label}: change Y` }, label);
              const chip = h('li', { class: 'chip ability-chip', title: description }, edit, remove);
              edit.addEventListener('click', async () => {
                if (await askAnti(anti.keywords, edit, `${anti.value}+`, chip)) {
                  // A new Y may merge this chip with another one: focus the chip that now holds its first keyword.
                  const group = activeAbilities(get()).find((a) => a.anti?.keywords.includes(anti.keywords[0]));
                  if (group?.anti) abilityList.querySelector<HTMLButtonElement>(`.ability-edit[data-ability="${antiChipId(group.anti.keywords)}"]`)?.focus();
                }
              });
              return chip;
            }
            if (!valueKey) return h('li', { class: 'chip ability-chip', title: description }, h('span', {}, label), remove);
            const edit = h('button', { type: 'button', class: 'ability-edit', 'data-ability': valueKey, title: 'Change X', 'aria-label': `${label}: change X` }, label);
            const chip = h('li', { class: 'chip ability-chip', title: description }, edit, remove);
            edit.addEventListener('click', async () => {
              if (await askValue(valueKey, edit, get()[valueKey] ?? '', chip)) {
                abilityList.querySelector<HTMLButtonElement>(`.ability-edit[data-ability="${valueKey}"]`)?.focus();
              }
            });
            return chip;
          })),
    );
    const choices = ABILITY_CHOICES.filter((c) => !c.isActive(get()));
    abilitySelect.replaceChildren(
      h('option', { value: '' }, choices.length > 0 ? 'Add ability…' : 'All abilities added'),
      ...choices.map((c) => h('option', { value: c.value, title: c.description }, c.label)),
    );
    abilitySelect.value = '';
    abilitySelect.disabled = choices.length === 0;
  };
  const focusAfterAdd = () => {
    if (abilitySelect.disabled) abilityList.querySelector<HTMLButtonElement>('.ability-remove')?.focus();
    else abilitySelect.focus();
  };
  abilitySelect.addEventListener('change', async () => {
    const choice = ABILITY_CHOICES.find((c) => c.value === abilitySelect.value);
    if (!choice) return;
    if (isValueChoice(choice)) {
      abilitySelect.value = '';
      if (await askValue(choice.valueKey, abilitySelect, '')) focusAfterAdd();
      return;
    }
    if (isAntiChoice(choice)) {
      abilitySelect.value = '';
      if (await askAnti([choice.keyword], abilitySelect, '')) focusAfterAdd();
      return;
    }
    update(choice.apply(get()));
    focusAfterAdd();
  });
  abilityEditor.append(field(options.label, abilitySelect, 'field--abilities'), abilityList);
  renderAbilities();
  return { element: abilityEditor, select: abilitySelect };
}
