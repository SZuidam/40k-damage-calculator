import type { DefenderProfile } from '../types';
import { field, h, numberValue, select, setFieldError } from './dom';
import { INVULN_OPTIONS, SAVE_OPTIONS, keywordToggles } from './statFields';
import { validateDefender } from './validation';

export interface DefenderForm {
  /** Write the current values of `defender` back into the controls (after loading a preset). */
  setValues(): void;
}

/** Defender profile form. Edits mutate `defender` in place and call `onChange`. */
export function renderDefenderForm(container: HTMLElement, defender: DefenderProfile, onChange: () => void): DefenderForm {
  const models = h('input', { id: 'def-models', type: 'number', inputmode: 'numeric', min: 1, max: 40, value: defender.models });
  const toughness = h('input', { id: 'def-toughness', type: 'number', inputmode: 'numeric', min: 1, max: 20, value: defender.toughness });
  const save = select({ id: 'def-save' }, SAVE_OPTIONS, defender.save);
  const invuln = select({ id: 'def-invuln' }, INVULN_OPTIONS, defender.invuln ?? '');
  const wounds = h('input', { id: 'def-wounds', type: 'number', inputmode: 'numeric', min: 1, max: 40, value: defender.wounds });
  const errors = h('p', { class: 'row-errors', id: 'def-errors', 'aria-live': 'polite' });

  const controls = { models, toughness, save, invuln, wounds };

  const validate = () => {
    const result = validateDefender(defender);
    for (const [key, control] of Object.entries(controls)) {
      const message = result[key as keyof DefenderProfile];
      setFieldError(control, message);
      if (message) control.setAttribute('aria-describedby', errors.id);
      else control.removeAttribute('aria-describedby');
    }
    errors.textContent = Object.values(result).join(' · ');
  };

  const bind = (control: HTMLInputElement | HTMLSelectElement, apply: () => void) => {
    control.addEventListener('input', () => {
      apply();
      validate();
      onChange();
    });
  };
  bind(models, () => (defender.models = numberValue(models)));
  bind(toughness, () => (defender.toughness = numberValue(toughness)));
  bind(save, () => (defender.save = numberValue(save)));
  bind(invuln, () => (defender.invuln = invuln.value === '' ? null : numberValue(invuln)));
  bind(wounds, () => (defender.wounds = numberValue(wounds)));

  // Keywords (for Anti-X Y+): one toggle per keyword, styled as a small chip.
  const keywords = keywordToggles('def-keyword', defender.keywords, (checked) => {
    defender.keywords = checked;
    onChange();
  });

  container.append(
    h(
      'div',
      { class: 'defender-grid' },
      field('Models', models),
      field('T', toughness),
      field('Sv', save),
      field('Inv', invuln),
      field('W', wounds),
    ),
    keywords.element,
    errors,
  );
  validate();

  return {
    setValues() {
      models.value = String(defender.models);
      toughness.value = String(defender.toughness);
      save.value = String(defender.save);
      invuln.value = defender.invuln === null ? '' : String(defender.invuln);
      wounds.value = String(defender.wounds);
      keywords.setValues(defender.keywords);
      validate();
    },
  };
}
