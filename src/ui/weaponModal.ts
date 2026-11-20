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
import { pickStats } from '../state/presets';
import { noAbilities, type DefenderKeyword, type WeaponStats } from '../types';
import { AP_OPTIONS, SKILL_OPTIONS, field, h, numberValue, select, setFieldError } from './dom';
import { openAbilityValuePopover } from './abilityValuePopover';
import { openModal } from './modal';
import { MAX_WEAPON_NAME, abilityValueError, antiValueError, hasErrors, validateWeaponStats } from './validation';

/** `data-ability` of an Anti chip, used to focus it again after a change: "anti-vehicle-monster". */
const antiChipId = (keywords: DefenderKeyword[]) => `anti-${keywords.join('-')}`;

const NEW_WEAPON: WeaponStats = { name: '', attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', abilities: noAbilities() };

let modalCounter = 0;

/**
 * Create (no `initial`) or edit a weapon profile in a modal.
 * Resolves the saved stats, or null when cancelled.
 */
export function openWeaponModal(initial?: WeaponStats): Promise<WeaponStats | null> {
  const draft = pickStats(initial ?? NEW_WEAPON);
  modalCounter += 1;
  const id = (name: string) => `weapon-modal-${modalCounter}-${name}`;
  let nameInput: HTMLInputElement | undefined;

  return openModal<WeaponStats | null>({
    title: initial ? 'Edit weapon profile' : 'New weapon profile',
    cancelValue: null,
    initialFocus: () => nameInput,
    content: (close) => {
      const name = h('input', { id: id('name'), type: 'text', value: draft.name, autocomplete: 'off', maxlength: MAX_WEAPON_NAME, placeholder: 'e.g. Bolt rifle' });
      nameInput = name;
      const attacks = h('input', { id: id('attacks'), type: 'text', value: draft.attacks, autocomplete: 'off', spellcheck: 'false', class: 'dice' });
      const skill = select({ id: id('skill') }, SKILL_OPTIONS, draft.skill);
      const strength = h('input', { id: id('strength'), type: 'number', inputmode: 'numeric', min: 1, max: 30, value: draft.strength });
      const ap = select({ id: id('ap') }, AP_OPTIONS, draft.ap);
      const damage = h('input', { id: id('damage'), type: 'text', value: draft.damage, autocomplete: 'off', spellcheck: 'false', class: 'dice' });
      const abilitySelect = h('select', { id: id('abilities'), class: 'ability-add' });
      const abilityList = h('ul', { class: 'ability-list', 'aria-label': 'Abilities of this weapon' });
      const errors = h('p', { class: 'row-errors', id: id('errors'), 'aria-live': 'polite' });
      const controls = { name, attacks, skill, strength, ap, damage, abilities: abilitySelect };

      const cancel = h('button', { type: 'button', class: 'button secondary' }, 'Cancel');
      const save = h('button', { type: 'submit', class: 'button primary' }, initial ? 'Save' : 'Create');
      cancel.addEventListener('click', () => close(null));

      // Only flag the name once the user has touched it, so a new form doesn't open red.
      let nameTouched = initial !== undefined;
      const validate = () => {
        const result = validateWeaponStats(draft);
        for (const [key, control] of Object.entries(controls)) {
          const message = key === 'name' && !nameTouched ? undefined : result[key as keyof WeaponStats];
          setFieldError(control, message);
          if (message) control.setAttribute('aria-describedby', errors.id);
          else control.removeAttribute('aria-describedby');
        }
        errors.textContent = Object.entries(result)
          .filter(([key]) => key !== 'name' || nameTouched)
          .map(([, message]) => message)
          .join(' · ');
        save.disabled = hasErrors(result);
        return result;
      };

      const bind = (control: HTMLInputElement | HTMLSelectElement, apply: () => void) => {
        control.addEventListener('input', () => {
          apply();
          validate();
        });
      };
      bind(name, () => {
        nameTouched = true;
        draft.name = name.value;
      });
      bind(attacks, () => (draft.attacks = attacks.value));
      bind(skill, () => (draft.skill = numberValue(skill)));
      bind(strength, () => (draft.strength = numberValue(strength)));
      bind(ap, () => (draft.ap = numberValue(ap)));
      bind(damage, () => (draft.damage = damage.value));

      // Abilities: an "Add ability…" dropdown plus a removable chip per ability. Abilities
      // with an X (Sustained Hits, Blast, Cleave, Rapid Fire, Melta) or a Y (Anti-X Y+) ask for it in a pop-up;
      // their chip reopens it.
      const abilityEditor = h('div', { class: 'ability-editor' });

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
        draft.abilities = withAbilityValue(draft.abilities, key, value);
        renderAbilities();
        validate();
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
        draft.abilities = withAntiValue(draft.abilities, keywords, y);
        renderAbilities();
        validate();
        return true;
      };

      const renderAbilities = () => {
        const active = activeAbilities(draft.abilities);
        abilityList.replaceChildren(
          ...(active.length === 0
            ? [h('li', { class: 'ability-empty' }, 'No abilities')]
            : active.map(({ key, label, description, valueKey, anti }) => {
                const remove = h('button', { type: 'button', class: 'ability-remove', 'aria-label': `Remove ${label}`, title: 'Remove' }, '✕');
                remove.addEventListener('click', () => {
                  draft.abilities = anti ? withoutAnti(draft.abilities, anti.keywords) : withoutAbility(draft.abilities, key);
                  renderAbilities();
                  validate();
                  abilitySelect.focus();
                });
                if (anti) {
                  const edit = h('button', { type: 'button', class: 'ability-edit', 'data-ability': antiChipId(anti.keywords), title: 'Change Y', 'aria-label': `${label}: change Y` }, label);
                  const chip = h('li', { class: 'chip ability-chip', title: description }, edit, remove);
                  edit.addEventListener('click', async () => {
                    if (await askAnti(anti.keywords, edit, `${anti.value}+`, chip)) {
                      // A new Y may merge this chip with another one: focus the chip that now holds its first keyword.
                      const group = activeAbilities(draft.abilities).find((a) => a.anti?.keywords.includes(anti.keywords[0]));
                      if (group?.anti) abilityList.querySelector<HTMLButtonElement>(`.ability-edit[data-ability="${antiChipId(group.anti.keywords)}"]`)?.focus();
                    }
                  });
                  return chip;
                }
                if (!valueKey) return h('li', { class: 'chip ability-chip', title: description }, h('span', {}, label), remove);
                const edit = h('button', { type: 'button', class: 'ability-edit', 'data-ability': valueKey, title: 'Change X', 'aria-label': `${label}: change X` }, label);
                const chip = h('li', { class: 'chip ability-chip', title: description }, edit, remove);
                edit.addEventListener('click', async () => {
                  if (await askValue(valueKey, edit, draft.abilities[valueKey] ?? '', chip)) {
                    abilityList.querySelector<HTMLButtonElement>(`.ability-edit[data-ability="${valueKey}"]`)?.focus();
                  }
                });
                return chip;
              })),
        );
        const choices = ABILITY_CHOICES.filter((c) => !c.isActive(draft.abilities));
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
        draft.abilities = choice.apply(draft.abilities);
        renderAbilities();
        validate();
        focusAfterAdd();
      });
      abilityEditor.append(field('Abilities', abilitySelect, 'field--abilities'), abilityList);
      renderAbilities();

      const form = h(
        'form',
        { class: 'modal-body', novalidate: true },
        field('Name', name, 'field--name'),
        h('div', { class: 'weapon-stats-grid' }, field('A', attacks), field('BS/WS', skill), field('S', strength), field('AP', ap), field('D', damage)),
        abilityEditor,
        errors,
        h('p', { class: 'modal-hint' }, 'A, D and ability X take dice expressions: 3, D3, D6, 2D6, D6+1. Anti Y takes 2+ to 6+.'),
        h('div', { class: 'modal-actions' }, cancel, save),
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        nameTouched = true;
        if (hasErrors(validate())) return;
        close({ ...draft, name: draft.name.trim(), attacks: draft.attacks.trim(), damage: draft.damage.trim() });
      });
      validate();
      return form;
    },
  });
}
