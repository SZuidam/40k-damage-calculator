import { situationKey } from '../state/unitAbilities';
import type { AttackConditions } from '../types';
import { h } from './dom';

const CONDITIONS: { key: keyof AttackConditions; label: string; title: string }[] = [
  { key: 'halfRange', label: 'Within half range', title: 'The target is within half range: Rapid Fire X adds X attacks per model, Melta X adds X damage.' },
  { key: 'charged', label: 'Charged this turn', title: 'The attacking unit charged this turn: Lance adds 1 to the wound roll.' },
];

export interface AttackConditionsForm {
  /** Rebuild the toggles: the built-in ones plus one per custom situation in use (after another attacker or leader was picked). */
  render(): void;
}

export interface AttackConditionsOptions {
  /** Mutated in place. */
  conditions: AttackConditions;
  /** The switched-on custom situations (situationKey()s), mutated in place. */
  situations: string[];
  /** The custom situations the attacker's abilities need (display names), read on every render. */
  customSituations: () => string[];
  onChange: () => void;
}

/**
 * Attack conditions that switch situational abilities on, as a row of toggle pills: the built-in
 * "Within half range" / "Charged this turn", then one per custom situation named in the abilities
 * of the attacker, its leader or its army ("Ingress move"). They apply to every weapon in the
 * attack. Edits mutate `conditions` / `situations` in place and call `onChange`.
 */
export function renderAttackConditions(container: HTMLElement, options: AttackConditionsOptions): AttackConditionsForm {
  const { conditions, situations, onChange } = options;
  const pills = h('div', { class: 'toggle-pills' });
  container.append(h('fieldset', { class: 'toggle-group attack-conditions' }, h('legend', {}, 'Conditions'), pills));

  const render = () => {
    const builtins = CONDITIONS.map(({ key, label, title }) => {
      const box = h('input', { id: `condition-${key}`, type: 'checkbox', class: 'toggle-input', checked: conditions[key] });
      box.addEventListener('change', () => {
        conditions[key] = box.checked;
        onChange();
      });
      return h('label', { class: 'toggle-pill', title }, box, h('span', {}, label));
    });
    const custom = options.customSituations().map((name) => {
      const key = situationKey(name);
      const box = h('input', { id: `situation-${key.replace(/[^a-z0-9]+/g, '-')}`, type: 'checkbox', class: 'toggle-input', checked: situations.includes(key), 'data-situation': key });
      box.addEventListener('change', () => {
        const index = situations.indexOf(key);
        if (box.checked && index < 0) situations.push(key);
        if (!box.checked && index >= 0) situations.splice(index, 1);
        onChange();
      });
      return h('label', { class: 'toggle-pill toggle-pill--custom', title: `${name}: a situation named in the attacker’s abilities.` }, box, h('span', {}, name));
    });
    // Keep focus on a toggle that is rebuilt.
    const focused = document.activeElement instanceof HTMLInputElement && pills.contains(document.activeElement) ? document.activeElement.id : null;
    pills.replaceChildren(...builtins, ...custom);
    if (focused) document.getElementById(focused)?.focus();
  };
  render();
  return { render };
}
