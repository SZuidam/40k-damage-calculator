import { uid } from '../state/ids';
import { pickStats } from '../state/presets';
import type { AttackConditions, ProfileRow, WeaponStats } from '../types';
import { field, h, numberValue, setFieldError } from './dom';
import { statChips, type ChipDefender } from './statChips';
import { validateRow } from './validation';

export interface ProfileRowsOptions {
  /** A row was edited, added, removed or moved. */
  onChange: () => void;
  /**
   * The defending unit: its models for the Blast / Cleave extra attacks shown on the A chip,
   * its keywords to mark Anti abilities that apply.
   */
  defender: () => ChipDefender;
  /**
   * The attack conditions: within half range Rapid Fire adds to the A chip and Melta to the D chip,
   * and conditional abilities are outlined while on.
   */
  conditions: () => AttackConditions;
  /** Where focus goes when the last row is removed (e.g. the Add weapon picker). */
  focusWhenEmpty?: () => void;
}

/**
 * The working area on the main page: a reorderable list of rows, each `models` models firing a
 * copy of a weapon. The copy's stats are read-only (chips plus abilities); only the number of
 * models can change. Edits mutate the `rows` array in place, so the caller can replace its
 * contents (load a profile) and call render().
 */
export class ProfileRows {
  private readonly list: HTMLOListElement;
  private readonly empty: HTMLParagraphElement;
  /** Per rendered row: refresh its validation and stat chips. */
  private updaters: (() => void)[] = [];

  constructor(
    container: HTMLElement,
    private readonly rows: ProfileRow[],
    private readonly options: ProfileRowsOptions,
  ) {
    this.list = h('ol', { class: 'weapon-list', 'aria-label': 'Weapons, in firing order' });
    this.empty = h('p', { class: 'list-empty' }, 'No weapons yet. Pick a profile or add weapons below.');
    container.append(this.list, this.empty);
    this.render();
  }

  /** Append a row of 1 model firing a copy of `weapon`, and focus its Models field. */
  add(weapon: WeaponStats): void {
    this.rows.push({ id: uid('row'), models: 1, weapon: pickStats(weapon) });
    this.render();
    this.focusRow(this.rows.length - 1, '.row-models');
    this.options.onChange();
  }

  /** Apply a new order given as indices into the current list. */
  reorder(order: number[]): void {
    const reordered = order.map((i) => this.rows[i]);
    this.rows.splice(0, this.rows.length, ...reordered);
    this.render();
    this.options.onChange();
  }

  render(): void {
    this.updaters = [];
    this.list.replaceChildren(...this.rows.map((row, i) => this.row(row, i)));
    this.list.hidden = this.rows.length === 0;
    this.empty.hidden = this.rows.length > 0;
  }

  /** Refresh validation and stat chips without re-rendering (keeps focus), e.g. after the defender changed. */
  refreshStats(): void {
    for (const update of this.updaters) update();
  }

  private focusRow(index: number, selector: string): void {
    const el = this.list.children[index]?.querySelector<HTMLElement>(selector);
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  }

  private move(index: number, delta: number, focusClass: string): void {
    const target = index + delta;
    if (target < 0 || target >= this.rows.length) return;
    const [row] = this.rows.splice(index, 1);
    this.rows.splice(target, 0, row);
    this.render();
    const button = this.list.children[target]?.querySelector<HTMLButtonElement>(`.${focusClass}`);
    (button && !button.disabled ? button : this.list.children[target]?.querySelector<HTMLButtonElement>('button:not([disabled])'))?.focus();
    this.options.onChange();
  }

  private remove(index: number): void {
    const wasFocused = this.list.contains(document.activeElement);
    this.rows.splice(index, 1);
    this.render();
    if (this.rows.length > 0) this.focusRow(Math.min(index, this.rows.length - 1), '.row-models');
    else if (wasFocused) this.options.focusWhenEmpty?.();
    this.options.onChange();
  }

  private row(row: ProfileRow, index: number): HTMLLIElement {
    const id = (name: string) => `${row.id}-${name}`;
    const name = row.weapon.name || `Weapon ${index + 1}`;

    const models = h('input', { id: id('models'), class: 'row-models', type: 'number', inputmode: 'numeric', min: 1, max: 50, value: row.models, 'aria-label': `Models firing ${name}` });
    const chips = h('div', { class: 'stat-chips' });
    const errors = h('p', { class: 'row-errors', id: id('errors'), 'aria-live': 'polite' });
    const li = h('li', { class: 'weapon-row' });

    const update = () => {
      const result = validateRow(row);
      setFieldError(models, result.models);
      if (result.models) models.setAttribute('aria-describedby', errors.id);
      else models.removeAttribute('aria-describedby');
      errors.textContent = Object.values(result).join(' · ');
      li.classList.toggle('is-invalid', result.weapon !== undefined);
      chips.replaceChildren(...statChips(row.weapon, this.options.defender(), this.options.conditions()));
    };

    models.addEventListener('input', () => {
      row.models = numberValue(models);
      update();
      this.options.onChange();
    });

    const remove = h('button', { type: 'button', class: 'icon-button remove', 'aria-label': `Remove ${name}`, title: 'Remove' }, '✕');
    remove.addEventListener('click', () => this.remove(index));
    const up = h('button', { type: 'button', class: 'icon-button move-up', 'aria-label': `Move ${name} up`, title: 'Move up', disabled: index === 0 }, '↑');
    const down = h(
      'button',
      { type: 'button', class: 'icon-button move-down', 'aria-label': `Move ${name} down`, title: 'Move down', disabled: index === this.rows.length - 1 },
      '↓',
    );
    up.addEventListener('click', () => this.move(index, -1, 'move-up'));
    down.addEventListener('click', () => this.move(index, 1, 'move-down'));

    li.append(
      h('span', { class: 'row-index', 'aria-hidden': 'true' }, String(index + 1)),
      field('Models', models, 'field--models'),
      h('span', { class: 'row-name' }, name),
      chips,
      h('div', { class: 'row-actions' }, up, down, remove),
      errors,
    );
    update();
    this.updaters.push(update);
    return li;
  }
}
