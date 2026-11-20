import { uid } from '../state/ids';
import { findWeapon, sortedLibrary } from '../state/presets';
import { noConditions, type AttackConditions, type AttackRow, type StoredWeapon } from '../types';
import { field, h, numberValue, setFieldError } from './dom';
import { statChips, type ChipDefender } from './statChips';
import { validateRow } from './validation';
import { openWeaponModal } from './weaponModal';

const NEW_WEAPON_VALUE = '__new__';

export interface AttackListOptions {
  /** The shared weapon library. New and edited profiles are written into it in place. */
  library: StoredWeapon[];
  /** A row was edited, added, removed or moved. */
  onChange: () => void;
  /** This list created or edited a library profile; other views showing the library should refresh. */
  onLibraryChange: () => void;
  /** Rows that can't be removed below this count. Default 1. */
  minRows?: number;
  /**
   * The defending unit: its models for the Blast / Cleave extra attacks shown on the A chip,
   * its keywords to mark Anti abilities that apply.
   */
  defender?: () => ChipDefender;
  /**
   * The attack conditions: within half range Rapid Fire adds to the A chip and Melta to the D chip,
   * and conditional abilities are outlined while on.
   */
  conditions?: () => AttackConditions;
}

export function newRow(weaponId: string | null, models = 1): AttackRow {
  return { id: uid('row'), models, weaponId };
}

/**
 * Reorderable list of attack rows (the attack editor). Each row picks a
 * weapon from the library and shows its stats read-only, with ✎ to edit the profile. Edits
 * mutate the `rows` array in place; `setRows` switches to another array.
 */
export class AttackList {
  private readonly list: HTMLOListElement;
  private readonly empty: HTMLParagraphElement;
  private readonly minRows: number;
  /** Per rendered row: refresh its validation and stat chips. */
  private updaters: (() => void)[] = [];

  constructor(
    container: HTMLElement,
    private rows: AttackRow[],
    private readonly options: AttackListOptions & { emptyText?: string },
  ) {
    this.minRows = options.minRows ?? 1;
    this.list = h('ol', { class: 'weapon-list' });
    this.empty = h('p', { class: 'list-empty' }, options.emptyText ?? 'No weapons yet.');
    container.append(this.list, this.empty);
    this.render();
  }

  /** Edit another array of rows (another attack). Doesn't call `onChange`. */
  setRows(rows: AttackRow[]): void {
    this.rows = rows;
    this.render();
  }

  /** Add a row with 1 model and the same weapon as the last row. */
  add(): void {
    this.rows.push(newRow(this.rows.at(-1)?.weaponId ?? null));
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
    this.empty.hidden = this.rows.length > 0;
  }

  /** Refresh the stat chips without re-rendering (keeps focus), e.g. after the defender changed. */
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
    else if (wasFocused) this.list.closest('[role="tabpanel"], dialog')?.querySelector<HTMLElement>('.list-add')?.focus();
    this.options.onChange();
  }

  /** Create a profile from the select's "+ New weapon profile…" option and link it. */
  private async createWeapon(row: AttackRow, index: number): Promise<void> {
    const stats = await openWeaponModal();
    if (stats) {
      const entry: StoredWeapon = { ...stats, id: uid('weapon') };
      this.options.library.push(entry);
      row.weaponId = entry.id;
      this.options.onLibraryChange();
      this.options.onChange();
    }
    this.render();
    this.focusRow(index, '.row-weapon');
  }

  private async editWeapon(weapon: StoredWeapon, index: number): Promise<void> {
    const stats = await openWeaponModal(weapon);
    if (stats) {
      Object.assign(weapon, stats);
      this.options.onLibraryChange();
      this.options.onChange();
    }
    this.render();
    this.focusRow(index, '.row-edit');
  }

  private weaponSelect(row: AttackRow): HTMLSelectElement {
    const el = h('select', { id: `${row.id}-weapon`, class: 'row-weapon' });
    el.append(h('option', { value: '' }, 'Choose weapon…'));
    for (const w of sortedLibrary(this.options.library)) el.append(h('option', { value: w.id }, w.name));
    el.append(h('option', { value: NEW_WEAPON_VALUE }, '+ New weapon profile…'));
    el.value = findWeapon(this.options.library, row.weaponId) ? (row.weaponId ?? '') : '';
    return el;
  }

  private row(row: AttackRow, index: number): HTMLLIElement {
    const id = (name: string) => `${row.id}-${name}`;

    const models = h('input', { id: id('models'), class: 'row-models', type: 'number', inputmode: 'numeric', min: 1, max: 50, value: row.models });
    const weaponSelect = this.weaponSelect(row);
    const chips = h('div', { class: 'stat-chips', 'aria-live': 'polite' });
    const errors = h('p', { class: 'row-errors', id: id('errors'), 'aria-live': 'polite' });
    const edit = h('button', { type: 'button', class: 'icon-button row-edit', title: 'Edit weapon profile' }, '✎');

    const update = () => {
      const weapon = findWeapon(this.options.library, row.weaponId);
      const result = validateRow(row, this.options.library);
      for (const [control, message] of [
        [models, result.models],
        [weaponSelect, result.weaponId],
      ] as const) {
        setFieldError(control, message);
        if (message) control.setAttribute('aria-describedby', errors.id);
        else control.removeAttribute('aria-describedby');
      }
      errors.textContent = Object.values(result).join(' · ');
      chips.replaceChildren(...statChips(weapon, this.options.defender?.(), this.options.conditions?.() ?? noConditions()));
      edit.disabled = !weapon;
      edit.setAttribute('aria-label', weapon ? `Edit ${weapon.name}` : 'Edit weapon profile');
    };

    models.addEventListener('input', () => {
      row.models = numberValue(models);
      update();
      this.options.onChange();
    });
    weaponSelect.addEventListener('change', () => {
      if (weaponSelect.value === NEW_WEAPON_VALUE) {
        weaponSelect.value = row.weaponId ?? '';
        void this.createWeapon(row, index);
        return;
      }
      row.weaponId = weaponSelect.value || null;
      update();
      this.options.onChange();
    });
    edit.addEventListener('click', () => {
      const weapon = findWeapon(this.options.library, row.weaponId);
      if (weapon) void this.editWeapon(weapon, index);
    });

    const label = findWeapon(this.options.library, row.weaponId)?.name ?? `row ${index + 1}`;
    const remove = h(
      'button',
      { type: 'button', class: 'icon-button remove', 'aria-label': `Remove ${label}`, title: 'Remove', disabled: this.rows.length <= this.minRows },
      '✕',
    );
    remove.addEventListener('click', () => this.remove(index));

    const up = h('button', { type: 'button', class: 'icon-button move-up', 'aria-label': `Move ${label} up`, title: 'Move up', disabled: index === 0 }, '↑');
    const down = h(
      'button',
      { type: 'button', class: 'icon-button move-down', 'aria-label': `Move ${label} down`, title: 'Move down', disabled: index === this.rows.length - 1 },
      '↓',
    );
    up.addEventListener('click', () => this.move(index, -1, 'move-up'));
    down.addEventListener('click', () => this.move(index, 1, 'move-down'));
    const li = h(
      'li',
      { class: 'weapon-row' },
      h('span', { class: 'row-index', 'aria-hidden': 'true' }, String(index + 1)),
      field('Models', models, 'field--models'),
      field('Weapon', weaponSelect, 'field--weapon'),
      chips,
      h('div', { class: 'row-actions' }, edit, h('span', { class: 'row-actions-sep', 'aria-hidden': 'true' }), up, down, remove),
      errors,
    );
    update();
    this.updaters.push(update);
    return li;
  }
}
