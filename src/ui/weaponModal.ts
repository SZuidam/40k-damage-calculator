import { ABILITY_CHOICES, activeAbilities, withoutAbility } from '../state/abilities';
import { pickStats } from '../state/presets';
import { noAbilities, type WeaponStats } from '../types';
import { AP_OPTIONS, SKILL_OPTIONS, field, h, numberValue, select, setFieldError } from './dom';
import { openModal } from './modal';
import { MAX_WEAPON_NAME, hasErrors, validateWeaponStats } from './validation';

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

      // Abilities: an "Add ability…" dropdown plus a removable chip per ability.
      const renderAbilities = () => {
        const active = activeAbilities(draft.abilities);
        abilityList.replaceChildren(
          ...(active.length === 0
            ? [h('li', { class: 'ability-empty' }, 'No abilities')]
            : active.map(({ key, label, description }) => {
                const remove = h('button', { type: 'button', class: 'ability-remove', 'aria-label': `Remove ${label}`, title: 'Remove' }, '✕');
                remove.addEventListener('click', () => {
                  draft.abilities = withoutAbility(draft.abilities, key);
                  renderAbilities();
                  validate();
                  abilitySelect.focus();
                });
                return h('li', { class: 'chip ability-chip', title: description }, h('span', {}, label), remove);
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
      abilitySelect.addEventListener('change', () => {
        const choice = ABILITY_CHOICES.find((c) => c.value === abilitySelect.value);
        if (!choice) return;
        draft.abilities = choice.apply(draft.abilities);
        renderAbilities();
        validate();
        if (abilitySelect.disabled) abilityList.querySelector<HTMLButtonElement>('.ability-remove')?.focus();
        else abilitySelect.focus();
      });
      renderAbilities();

      const form = h(
        'form',
        { class: 'modal-body', novalidate: true },
        field('Name', name, 'field--name'),
        h('div', { class: 'weapon-stats-grid' }, field('A', attacks), field('BS/WS', skill), field('S', strength), field('AP', ap), field('D', damage)),
        h('div', { class: 'ability-editor' }, field('Abilities', abilitySelect, 'field--abilities'), abilityList),
        errors,
        h('p', { class: 'modal-hint' }, 'A and D take dice expressions: 3, D3, D6, 2D6, D6+1.'),
        h('div', { class: 'modal-actions' }, cancel, save),
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        nameTouched = true;
        if (hasErrors(validate())) return;
        const sustainedHits = draft.abilities.sustainedHits?.trim() ?? null;
        close({ ...draft, name: draft.name.trim(), attacks: draft.attacks.trim(), damage: draft.damage.trim(), abilities: { ...draft.abilities, sustainedHits } });
      });
      validate();
      return form;
    },
  });
}
