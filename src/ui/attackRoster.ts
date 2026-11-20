import { findWeapon } from '../state/presets';
import type { AttackConditions, AttackRow, StoredWeapon } from '../types';
import { h } from './dom';
import { statChips, type ChipDefender } from './statChips';
import { validateRow } from './validation';

export interface AttackRosterOptions {
  /** The rows of the active attack. */
  rows: () => AttackRow[];
  library: StoredWeapon[];
  defender: () => ChipDefender;
  conditions: () => AttackConditions;
}

/**
 * The main page's read-only view of the active attack: one line per row
 * (`1  10× Bolt rifle  [A 2] [BS 3+] …`) with the abilities, Blast / Rapid Fire / Melta
 * bonuses and active Anti / condition outlines from `statChips`. Rows are edited in the
 * configuration drawer (✎ Edit attack).
 */
export class AttackRoster {
  private readonly list: HTMLOListElement;
  private readonly message: HTMLParagraphElement;

  constructor(
    container: HTMLElement,
    private readonly options: AttackRosterOptions,
  ) {
    this.list = h('ol', { class: 'roster', 'aria-label': 'Weapons in this attack, in firing order' });
    this.message = h('p', { class: 'roster-message' });
    container.append(this.list, this.message);
    this.render();
  }

  /** Redraw every row: the rows, the library, the defender or the conditions changed. */
  render(): void {
    const { rows, library, defender, conditions } = this.options;
    const current = rows();
    let invalid = 0;
    this.list.replaceChildren(
      ...current.map((row, i) => {
        const weapon = findWeapon(library, row.weaponId);
        const problem = Object.values(validateRow(row, library)).join(' · ');
        if (problem) invalid += 1;
        return h(
          'li',
          { class: `roster-row${problem ? ' is-invalid' : ''}` },
          h('span', { class: 'row-index', 'aria-hidden': 'true' }, String(i + 1)),
          h(
            'span',
            { class: 'roster-name' },
            h('span', { class: 'roster-models' }, `${Number.isFinite(row.models) ? row.models : '?'}×`),
            ' ',
            weapon?.name ?? 'No weapon',
          ),
          h('div', { class: 'stat-chips' }, ...(weapon ? statChips(weapon, defender(), conditions()) : [])),
          problem ? h('p', { class: 'row-errors' }, problem) : null,
        );
      }),
    );
    this.list.hidden = current.length === 0;
    if (current.length === 0) this.message.textContent = 'This attack has no weapons yet. Add them with ✎ Edit attack.';
    else if (invalid > 0) this.message.textContent = `Fix ${invalid === 1 ? 'the highlighted row' : `the ${invalid} highlighted rows`} with ✎ Edit attack to simulate.`;
    else this.message.textContent = '';
  }
}
