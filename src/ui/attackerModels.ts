import type { AttackerSelection } from '../types';
import { field, h, numberValue, setFieldError } from './dom';
import { LIMITS, validateAttackerModels } from './validation';

export interface AttackerModels {
  /** The Models field, for the end of the attacker's picker row. */
  field: HTMLDivElement;
  /** The line under the row: the error, or how many D6 "per model" abilities roll with a leader. */
  hint: HTMLParagraphElement;
  /** Redraw the hint and validation (after the leader or the value changed). */
  render(): void;
}

/**
 * The attacker's Models: how many models the unit has, for abilities that roll one D6 per model
 * ("Inflict mortal wounds"). An attached leader adds one. Weapons keep their own counts per row.
 * Edits mutate `selection.models` in place and call `onChange`.
 */
export function renderAttackerModels(selection: AttackerSelection, onChange: () => void): AttackerModels {
  const { min, max } = LIMITS.attackerModels;
  const input = h('input', { id: 'attacker-models', type: 'number', inputmode: 'numeric', min, max, value: selection.models });
  const fieldEl = field('Models', input, 'picker-field picker-field--models');
  fieldEl.title = 'Models in the unit, for abilities that roll one D6 per model. An attached leader adds one.';
  const hint = h('p', { class: 'picker-hint attacker-models-hint', id: 'attacker-models-hint', 'aria-live': 'polite', hidden: true });

  const render = () => {
    const error = validateAttackerModels(selection.models);
    setFieldError(input, error);
    if (error) {
      hint.textContent = error;
      hint.classList.add('is-error');
    } else {
      hint.classList.remove('is-error');
      hint.textContent = selection.leaderId !== null ? `+1 leader = ${selection.models + 1} D6 for abilities that roll per model.` : '';
    }
    hint.hidden = hint.textContent === '';
    if (hint.hidden) input.removeAttribute('aria-describedby');
    else input.setAttribute('aria-describedby', hint.id);
  };

  input.addEventListener('input', () => {
    selection.models = numberValue(input);
    render();
    onChange();
  });

  render();
  return { field: fieldEl, hint, render };
}
