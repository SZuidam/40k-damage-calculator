import type { AttackConditions } from '../types';
import { h } from './dom';

const CONDITIONS: { key: keyof AttackConditions; label: string; title: string }[] = [
  { key: 'halfRange', label: 'Within half range', title: 'The target is within half range: Rapid Fire X adds X attacks per model.' },
  { key: 'charged', label: 'Charged this turn', title: 'The attacking unit charged this turn: Lance adds 1 to the wound roll.' },
];

export interface AttackConditionsForm {
  /** Write the current values of `conditions` back into the toggles. */
  setValues(): void;
}

/**
 * Attack conditions that switch situational abilities on, as a row of toggle pills. They
 * apply to every weapon in the attack. Edits mutate `conditions` in place and call `onChange`.
 */
export function renderAttackConditions(container: HTMLElement, conditions: AttackConditions, onChange: () => void): AttackConditionsForm {
  const boxes = CONDITIONS.map(({ key }) => {
    const box = h('input', { id: `condition-${key}`, type: 'checkbox', class: 'toggle-input', checked: conditions[key] });
    box.addEventListener('change', () => {
      conditions[key] = box.checked;
      onChange();
    });
    return box;
  });

  container.append(
    h(
      'fieldset',
      { class: 'toggle-group attack-conditions' },
      h('legend', {}, 'Conditions'),
      h(
        'div',
        { class: 'toggle-pills' },
        ...CONDITIONS.map(({ label, title }, i) => h('label', { class: 'toggle-pill', title }, boxes[i], h('span', {}, label))),
      ),
    ),
  );

  return {
    setValues() {
      boxes.forEach((box, i) => (box.checked = conditions[CONDITIONS[i].key]));
    },
  };
}
