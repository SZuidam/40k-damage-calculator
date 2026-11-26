import { defenderOf } from '../state/loadout';
import { KEYWORD_NAMES, type DefenderSelection, type Unit } from '../types';
import { field, h, numberValue, setFieldError } from './dom';
import { validateDefender } from './validation';

export interface DefenderPanel {
  /** Redraw the stat line and validation after another unit was picked or the unit changed. */
  render(): void;
}

/**
 * The defender below its unit picker: the number of models (the only thing set here) and the
 * picked unit's stat line as read-only chips plus its keywords. The stats are edited in the
 * Units tab. Edits mutate `selection.models` in place and call `onChange`.
 */
export function renderDefenderPanel(container: HTMLElement, selection: DefenderSelection, unit: () => Unit | undefined, onChange: () => void): DefenderPanel {
  const models = h('input', { id: 'def-models', type: 'number', inputmode: 'numeric', min: 1, max: 40, value: selection.models });
  const stats = h('div', { class: 'stat-chips defender-stats', 'aria-label': 'Stats of the defending unit' });
  const errors = h('p', { class: 'row-errors', id: 'def-errors', 'aria-live': 'polite' });

  const render = () => {
    const u = unit();
    if (!u) {
      stats.replaceChildren(h('span', { class: 'chips-empty' }, 'Pick a unit to see its stats.'));
      setFieldError(models, undefined);
      models.removeAttribute('aria-describedby');
      errors.textContent = '';
      return;
    }
    const chip = (label: string, value: string, title: string) =>
      h('span', { class: 'chip', title }, h('span', { class: 'chip-label' }, label), ' ', value);
    stats.replaceChildren(
      chip('T', String(u.toughness), 'Toughness'),
      chip('Sv', u.save >= 7 ? '–' : `${u.save}+`, 'Armour save'),
      ...(u.invuln === null ? [] : [chip('Inv', `${u.invuln}++`, 'Invulnerable save')]),
      chip('W', String(u.wounds), 'Wounds per model'),
      ...(u.keywords.length === 0
        ? []
        : [h('span', { class: 'row-abilities' }, h('span', { class: 'visually-hidden' }, 'Keywords: '), u.keywords.map((k) => KEYWORD_NAMES[k]).join(', '))]),
    );
    const result = validateDefender(defenderOf(u, selection.models));
    setFieldError(models, result.models);
    if (result.models) models.setAttribute('aria-describedby', errors.id);
    else models.removeAttribute('aria-describedby');
    errors.textContent = Object.values(result).join(' · ');
  };

  models.addEventListener('input', () => {
    selection.models = numberValue(models);
    render();
    onChange();
  });

  container.append(h('div', { class: 'defender-body' }, field('Models', models, 'field--count'), stats), errors);
  render();
  return { render };
}
