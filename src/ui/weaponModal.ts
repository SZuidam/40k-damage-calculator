import { pickStats } from '../state/presets';
import { isNameTaken } from '../state/units';
import { WEAPON_TYPES, WEAPON_TYPE_NAMES, noAbilities, type WeaponStats } from '../types';
import { AP_OPTIONS, SKILL_OPTIONS, field, h, numberValue, select, setFieldError } from './dom';
import { openModal } from './modal';
import { MAX_WEAPON_NAME, hasErrors, validateWeaponStats } from './validation';
import { weaponAbilityEditor } from './weaponAbilityEditor';

const NEW_WEAPON: WeaponStats = { name: '', type: 'ranged', attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', abilities: noAbilities() };

let modalCounter = 0;

export interface WeaponModalOptions {
  /**
   * Names the weapon may not have (case-insensitive), e.g. the other weapons of the same unit.
   * Leave out when names may repeat (the weapon library).
   */
  takenNames?: readonly string[];
}

/** Shown when the name is in `WeaponModalOptions.takenNames`. */
export const NAME_TAKEN_IN_UNIT = 'This unit already has a weapon with this name';

/**
 * Create (no `initial`) or edit a weapon profile in a modal.
 * Resolves the saved stats, or null when cancelled.
 */
export function openWeaponModal(initial?: WeaponStats, { takenNames }: WeaponModalOptions = {}): Promise<WeaponStats | null> {
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
      // Torrent: the weapon never rolls to hit, so BS / WS reads "N/A" and can't be changed. The
      // stored skill stays as it was, for when Torrent is taken off again.
      const notApplicable = h('option', { value: '' }, 'N/A');
      const syncTorrent = () => {
        const torrent = draft.abilities.torrent;
        if (torrent === skill.disabled) return;
        skill.disabled = torrent;
        if (torrent) {
          skill.prepend(notApplicable);
          skill.value = '';
          skill.title = 'Torrent: every attack hits automatically, without a hit roll.';
        } else {
          notApplicable.remove();
          skill.value = String(draft.skill);
          skill.removeAttribute('title');
        }
      };
      const strength = h('input', { id: id('strength'), type: 'number', inputmode: 'numeric', min: 1, max: 30, value: draft.strength });
      const ap = select({ id: id('ap') }, AP_OPTIONS, draft.ap);
      const damage = h('input', { id: id('damage'), type: 'text', value: draft.damage, autocomplete: 'off', spellcheck: 'false', class: 'dice' });
      const errors = h('p', { class: 'row-errors', id: id('errors'), 'aria-live': 'polite' });
      const controls: Record<string, HTMLInputElement | HTMLSelectElement> = { name, attacks, skill, strength, ap, damage };

      const cancel = h('button', { type: 'button', class: 'button secondary' }, 'Cancel');
      const save = h('button', { type: 'submit', class: 'button primary' }, initial ? 'Save' : 'Create');
      cancel.addEventListener('click', () => close(null));

      // Only flag the name once the user has touched it, so a new form doesn't open red.
      let nameTouched = initial !== undefined;
      const validate = () => {
        const result = validateWeaponStats(draft);
        if (!result.name && takenNames && isNameTaken(takenNames, draft.name)) result.name = NAME_TAKEN_IN_UNIT;
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
      // Ranged / Melee: a segmented pair of radio pills. Unit abilities can target one kind only.
      const skillField = field(draft.type === 'melee' ? 'WS' : 'BS', skill);
      const typeRadios = WEAPON_TYPES.map((type) => {
        const radio = h('input', { id: id(`type-${type}`), type: 'radio', name: id('type'), value: type, class: 'toggle-input', checked: draft.type === type });
        radio.addEventListener('change', () => {
          if (!radio.checked) return;
          draft.type = type;
          skillField.querySelector('label')!.textContent = type === 'melee' ? 'WS' : 'BS';
        });
        return h('label', { class: 'toggle-pill' }, radio, h('span', {}, WEAPON_TYPE_NAMES[type]));
      });
      const typeGroup = h('fieldset', { class: 'toggle-group segmented' }, h('legend', {}, 'Type'), h('div', { class: 'toggle-pills' }, ...typeRadios));

      bind(attacks, () => (draft.attacks = attacks.value));
      bind(skill, () => (draft.skill = numberValue(skill)));
      bind(strength, () => (draft.strength = numberValue(strength)));
      bind(ap, () => (draft.ap = numberValue(ap)));
      bind(damage, () => (draft.damage = damage.value));

      // Abilities: an "Add ability…" dropdown plus a removable chip per ability (see weaponAbilityEditor).
      const abilityEditor = weaponAbilityEditor({
        id: id('abilities'),
        label: 'Abilities',
        listLabel: 'Abilities of this weapon',
        get: () => draft.abilities,
        set: (abilities) => (draft.abilities = abilities),
        onChange: () => {
          syncTorrent();
          validate();
        },
      });
      controls.abilities = abilityEditor.select;
      syncTorrent();

      const form = h(
        'form',
        { class: 'modal-body', novalidate: true },
        field('Name', name, 'field--name'),
        typeGroup,
        h('div', { class: 'weapon-stats-grid' }, field('A', attacks), skillField, field('S', strength), field('AP', ap), field('D', damage)),
        abilityEditor.element,
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
