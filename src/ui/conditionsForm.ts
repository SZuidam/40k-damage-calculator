import type { AttackConditions } from '../types';
import { h } from './dom';

const CONDITIONS: { key: keyof AttackConditions; label: string; title: string }[] = [
  { key: 'halfRange', label: 'Within half range', title: 'The target is within half range: Rapid Fire X adds X attacks per model, Melta X adds X damage.' },
  { key: 'charged', label: 'Charged this turn', title: 'The attacking unit charged this turn: Lance adds 1 to the wound roll.' },
];

export interface AttackConditionsOptions {
  /** Mutated in place. */
  conditions: AttackConditions;
  onChange: () => void;
}

/**
 * The built-in attack conditions as a row of toggle pills: "Within half range" and "Charged
 * this turn". They apply to every weapon in the attack and switch on Rapid Fire, Melta, Lance
 * and the abilities that need them. (Abilities switched on by hand have their own toggle in
 * the Abilities line.) Edits mutate `conditions` in place and call `onChange`.
 */
export function renderAttackConditions(container: HTMLElement, options: AttackConditionsOptions): void {
  const { conditions, onChange } = options;
  const pills = CONDITIONS.map(({ key, label, title }) => {
    const box = h('input', { id: `condition-${key}`, type: 'checkbox', class: 'toggle-input', checked: conditions[key] });
    box.addEventListener('change', () => {
      conditions[key] = box.checked;
      onChange();
    });
    return h('label', { class: 'toggle-pill', title }, box, h('span', {}, label));
  });
  container.append(h('fieldset', { class: 'toggle-group attack-conditions' }, h('legend', {}, 'Conditions'), h('div', { class: 'toggle-pills' }, ...pills)));
}
