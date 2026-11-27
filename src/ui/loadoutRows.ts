import type { SourcedAbility } from '../state/unitAbilities';
import type { AttackConditions, AttackerSelection, DamageRerollThresholds, LoadoutRow, StoredWeapon, Unit } from '../types';
import { h, numberValue, setFieldError } from './dom';
import { statChips, type ChipDefender, type ChipDefense } from './statChips';
import { validateLoadoutRow } from './validation';

export interface LoadoutRowsOptions {
  /** A row was ticked, its count changed, or it moved. */
  onChange: () => void;
  /** The attacking unit, whose weapons the rows refer to (undefined: no unit picked). */
  unit: () => Unit | undefined;
  /**
   * The defending unit: its models for the Blast / Cleave extra attacks shown on the A chip,
   * its keywords to mark Anti abilities that apply (undefined: no defender picked).
   */
  defender: () => ChipDefender | undefined;
  /**
   * The attack conditions: within half range Rapid Fire adds to the A chip and Melta to the D chip,
   * and conditional abilities are outlined while on.
   */
  conditions: () => AttackConditions;
  /** The unit, leader and army abilities active for `weapon` (their effects show on its chips). */
  abilities: (weapon: StoredWeapon) => SourcedAbility[];
  /** The Settings thresholds for "Re-roll damage", shown with that lever. */
  damageRerolls: () => DamageRerollThresholds;
  /** The defender's defensive abilities active for `weapon` and its Toughness (undefined: no defender picked). */
  defense: (weapon: StoredWeapon) => ChipDefense | undefined;
}

/**
 * The attacking unit's weapons on the main page, one row each: a checkbox for whether the unit
 * carries it, how many it carries (Count), the weapon's stat chips and ↑ ↓ to change the firing
 * order. Only carried rows fire; they are numbered in firing order. Edits mutate
 * `selection.rows` in place; after the caller replaces the rows (another unit), call render().
 */
export class LoadoutRows {
  private readonly list: HTMLOListElement;
  private readonly empty: HTMLParagraphElement;
  /** Per rendered row: refresh its number, validation and stat chips. */
  private updaters: (() => void)[] = [];

  constructor(
    container: HTMLElement,
    private readonly selection: AttackerSelection,
    private readonly options: LoadoutRowsOptions,
  ) {
    this.list = h('ol', { class: 'weapon-list', 'aria-label': 'Weapons of the attacking unit, in firing order' });
    this.empty = h('p', { class: 'list-empty' });
    container.append(this.list, this.empty);
    this.render();
  }

  render(): void {
    const unit = this.options.unit();
    const rows = this.selection.rows;
    this.updaters = [];
    const items = unit
      ? rows.flatMap((row, i) => {
          const weapon = unit.weapons.find((w) => w.id === row.weaponId);
          return weapon ? [this.row(row, weapon, i)] : [];
        })
      : [];
    this.list.replaceChildren(...items);
    this.list.hidden = items.length === 0;
    this.empty.hidden = items.length > 0;
    this.empty.textContent = unit ? 'This unit has no weapons yet. Add them under ☰ → Units.' : 'Pick a unit to see its weapons.';
    this.refreshStats();
  }

  /** Refresh numbers, validation and stat chips without re-rendering (keeps focus), e.g. after the defender changed. */
  refreshStats(): void {
    for (const update of this.updaters) update();
  }

  private move(index: number, delta: number, focusClass: string): void {
    const rows = this.selection.rows;
    const target = index + delta;
    if (target < 0 || target >= rows.length) return;
    const [row] = rows.splice(index, 1);
    rows.splice(target, 0, row);
    this.render();
    const item = this.list.children[target];
    const button = item?.querySelector<HTMLButtonElement>(`.${focusClass}`);
    (button && !button.disabled ? button : item?.querySelector<HTMLButtonElement>('button:not([disabled])'))?.focus();
    this.options.onChange();
  }

  /** The firing number of `row` (1-based among the carried rows), or null when it isn't carried. */
  private firingNumber(row: LoadoutRow): number | null {
    if (!row.carried) return null;
    return this.selection.rows.filter((r) => r.carried).indexOf(row) + 1;
  }

  private row(row: LoadoutRow, weapon: StoredWeapon, index: number): HTMLLIElement {
    const id = (name: string) => `loadout-${weapon.id}-${name}`;
    const name = weapon.name;
    const last = this.selection.rows.length - 1;

    const carried = h('input', { id: id('carried'), type: 'checkbox', class: 'row-carried', checked: row.carried });
    const count = h('input', { id: id('count'), class: 'row-count', type: 'number', inputmode: 'numeric', min: 1, max: 50, value: row.count, 'aria-label': `Number of ${name} carried` });
    const number = h('span', { class: 'row-index', 'aria-hidden': 'true' });
    const chips = h('div', { class: 'stat-chips' });
    const abilities = h('span', { class: 'row-ability-slot' });
    const errors = h('p', { class: 'row-errors', id: id('errors'), 'aria-live': 'polite' });
    const li = h('li', { class: 'weapon-row loadout-row' });

    const update = () => {
      // Only a carried weapon fires, so only its count and stats can block the simulation.
      const result = row.carried ? validateLoadoutRow(row.count, weapon) : {};
      setFieldError(count, result.count);
      if (result.count) count.setAttribute('aria-describedby', errors.id);
      else count.removeAttribute('aria-describedby');
      errors.textContent = Object.values(result).join(' · ');
      li.classList.toggle('is-invalid', result.weapon !== undefined);
      li.classList.toggle('is-off', !row.carried);
      number.textContent = String(this.firingNumber(row) ?? '');
      // The stat chips go on the second line, the abilities beside the name, so every row has
      // the same two lines and the chips line up from row to row.
      const parts = statChips(weapon, this.options.defender(), this.options.conditions(), this.options.abilities(weapon), this.options.damageRerolls(), this.options.defense(weapon));
      const isAbilities = (el: HTMLElement) => el.classList.contains('row-abilities');
      chips.replaceChildren(...parts.filter((el) => !isAbilities(el)));
      abilities.replaceChildren(...parts.filter(isAbilities));
    };

    carried.addEventListener('change', () => {
      row.carried = carried.checked;
      // The firing numbers of the other rows change too.
      this.refreshStats();
      this.options.onChange();
    });
    count.addEventListener('input', () => {
      row.count = numberValue(count);
      update();
      this.options.onChange();
    });

    const up = h('button', { type: 'button', class: 'icon-button move-up', 'aria-label': `Move ${name} up`, title: 'Move up', disabled: index === 0 }, '↑');
    const down = h('button', { type: 'button', class: 'icon-button move-down', 'aria-label': `Move ${name} down`, title: 'Move down', disabled: index === last }, '↓');
    up.addEventListener('click', () => this.move(index, -1, 'move-up'));
    down.addEventListener('click', () => this.move(index, 1, 'move-down'));

    // A two-toned pill: the equip cell (checkbox and firing number) on the left, then the weapon on
    // two lines: count × name with its abilities and the order buttons, and below it the stat chips.
    li.append(
      h('label', { class: 'row-equip', title: 'Equip' }, carried, h('span', { class: 'visually-hidden' }, 'Equip '), number),
      h(
        'div',
        { class: 'row-body' },
        h(
          'div',
          { class: 'row-head' },
          count,
          h('span', { class: 'row-times', 'aria-hidden': 'true' }, '×'),
          h('div', { class: 'row-title' }, h('label', { class: 'row-name', for: carried.id }, name), abilities),
          h('div', { class: 'row-actions' }, up, down),
        ),
        chips,
        errors,
      ),
    );
    this.updaters.push(update);
    return li;
  }
}
