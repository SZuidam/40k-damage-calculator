import { formatDiceSum, tryParseDice } from '../engine/dice';
import { bonusAttacks, bonusDamage } from '../engine/rules';
import { activeAbilities, normaliseDice } from '../state/abilities';
import { uid } from '../state/ids';
import { findWeapon, sortedLibrary } from '../state/presets';
import { KEYWORD_NAMES, noConditions, type AttackConditions, type AttackRow, type DefenderProfile, type StoredWeapon, type WeaponStats } from '../types';
import { field, h, numberValue, setFieldError } from './dom';
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
  /** Compact mode (unit editor): models + weapon + remove only. */
  compact?: boolean;
  /** Rows that can't be removed below this count. Default 1. */
  minRows?: number;
  /**
   * The defending unit: its models for the Blast / Cleave extra attacks shown on the A chip,
   * its keywords to mark Anti abilities that apply.
   */
  defender?: () => Pick<DefenderProfile, 'models' | 'keywords'>;
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
 * Reorderable list of attack rows. Each row picks a weapon from the library and shows
 * its stats read-only, with ✎ to edit the profile. Edits mutate `rows` in place.
 */
export class AttackList {
  private readonly list: HTMLOListElement;
  private readonly minRows: number;
  /** Per rendered row: refresh its validation and stat chips. */
  private updaters: (() => void)[] = [];

  constructor(
    container: HTMLElement,
    private readonly rows: AttackRow[],
    private readonly options: AttackListOptions,
  ) {
    this.minRows = options.minRows ?? 1;
    this.list = h('ol', { class: `weapon-list${options.compact ? ' weapon-list--compact' : ''}` });
    container.append(this.list);
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
    this.rows.splice(index, 1);
    this.render();
    if (this.rows.length > 0) this.focusRow(Math.min(index, this.rows.length - 1), '.row-models');
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
    const { compact } = this.options;
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
      if (compact) return;
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

    let li: HTMLLIElement;
    if (compact) {
      li = h('li', { class: 'weapon-row weapon-row--compact' }, field('Models', models), field('Weapon', weaponSelect, 'field--weapon'), h('div', { class: 'row-actions' }, remove), errors);
    } else {
      const up = h('button', { type: 'button', class: 'icon-button move-up', 'aria-label': `Move ${label} up`, title: 'Move up', disabled: index === 0 }, '↑');
      const down = h(
        'button',
        { type: 'button', class: 'icon-button move-down', 'aria-label': `Move ${label} down`, title: 'Move down', disabled: index === this.rows.length - 1 },
        '↓',
      );
      up.addEventListener('click', () => this.move(index, -1, 'move-up'));
      down.addEventListener('click', () => this.move(index, 1, 'move-down'));
      li = h(
        'li',
        { class: 'weapon-row' },
        h('span', { class: 'row-index', 'aria-hidden': 'true' }, String(index + 1)),
        field('Models', models, 'field--models'),
        field('Weapon', weaponSelect, 'field--weapon'),
        chips,
        h('div', { class: 'row-actions' }, edit, h('span', { class: 'row-actions-sep', 'aria-hidden': 'true' }), up, down, remove),
        errors,
      );
    }
    update();
    this.updaters.push(update);
    return li;
  }
}

const CHIP_LABELS: { key: Exclude<keyof WeaponStats, 'abilities'>; label: string; title: string; format?: (w: WeaponStats) => string }[] = [
  { key: 'attacks', label: 'A', title: 'Attacks' },
  { key: 'skill', label: 'BS', title: 'Ballistic / Weapon Skill', format: (w) => `${w.skill}+` },
  { key: 'strength', label: 'S', title: 'Strength' },
  { key: 'ap', label: 'AP', title: 'Armour penetration' },
  { key: 'damage', label: 'D', title: 'Damage' },
];

/** Why an attack condition makes an ability active, for its tooltip. */
const CONDITION_REASONS: Record<keyof AttackConditions, string> = {
  halfRange: 'the target is within half range',
  charged: 'the bearer charged this turn',
};

function statChips(weapon: WeaponStats | undefined, defender: Pick<DefenderProfile, 'models' | 'keywords'> | undefined, conditions: AttackConditions): HTMLElement[] {
  if (!weapon) return [h('span', { class: 'chips-empty' }, 'No weapon chosen')];
  const chips = CHIP_LABELS.map(({ key, label, title, format }) =>
    h('span', { class: 'chip', title }, h('span', { class: 'chip-label' }, label), ' ', format ? format(weapon) : String(weapon[key])),
  );
  const bonus = attacksBonus(weapon, defender?.models, conditions);
  if (bonus) {
    // The A chip comes first: "A 4+2" or "A D6+2D6+4", with the Blast / Cleave / Rapid Fire extra attacks in blue.
    chips[0].append(h('span', { class: 'chip-bonus' }, `+${bonus.value}`));
    chips[0].title = `Attacks: ${weapon.attacks}, plus ${bonus.value} from ${bonus.sources}`;
  }
  const extraDamage = damageBonus(weapon, conditions);
  if (extraDamage) {
    // The D chip comes last: "D D6+2", with the Melta extra damage in blue.
    const chip = chips[chips.length - 1];
    chip.append(h('span', { class: 'chip-bonus' }, `+${extraDamage.value}`));
    chip.title = `Damage: ${weapon.damage}, plus ${extraDamage.value} from ${extraDamage.sources}`;
  }
  const abilities = activeAbilities(weapon.abilities);
  if (abilities.length === 0) return chips;
  // Read-only here; abilities are edited in the weapon profile modal (✎).
  const text = h('span', { class: 'row-abilities' }, h('span', { class: 'visually-hidden' }, 'Abilities: '));
  abilities.forEach(({ label, description, anti, condition }, i) => {
    if (i > 0) text.append(', ');
    // An Anti ability is outlined when the current defender has one of its keywords, a
    // conditional ability (Rapid Fire, Melta, Lance) while its attack condition is on.
    let active: string | null = null;
    const matched = anti && defender ? anti.keywords.filter((k) => defender.keywords.includes(k)) : [];
    if (matched.length > 0) {
      const names = matched.map((k) => KEYWORD_NAMES[k]).join(' and ');
      active = `Active: the target has the ${names} keyword${matched.length === 1 ? '' : 's'}.`;
    } else if (condition && conditions[condition]) {
      active = `Active: ${CONDITION_REASONS[condition]}.`;
    }
    if (active === null) {
      text.append(h('span', { title: description }, label));
      return;
    }
    text.append(h('span', { class: 'ability-active', title: `${description} ${active}` }, label, h('span', { class: 'visually-hidden' }, ' (active)')));
  });
  return [...chips, text];
}

/**
 * Blast / Cleave / Rapid Fire extra attacks per model against the current defender and
 * under the current conditions ("2D6+4"), with their sources for the tooltip, or null when
 * there are none or an X is invalid (the row shows that error instead).
 */
function attacksBonus(weapon: WeaponStats, defenderModels: number | undefined, conditions: AttackConditions): { value: string; sources: string } | null {
  const { blast, cleave, rapidFire } = weapon.abilities;
  if ([blast, cleave, rapidFire].some((x) => x !== null && !tryParseDice(x))) return null;
  // Without a valid model count Blast / Cleave add nothing here; Rapid Fire still can.
  const models = defenderModels !== undefined && Number.isInteger(defenderModels) && defenderModels >= 1 ? defenderModels : 0;
  const terms = bonusAttacks({ abilities: weapon.abilities, conditions }, { models });
  if (terms.length === 0) return null;
  const perFive = models >= 5 ? [blast === null ? '' : `Blast ${normaliseDice(blast)}`, cleave === null ? '' : `Cleave ${normaliseDice(cleave)}`].filter(Boolean) : [];
  const sources: string[] = [];
  if (perFive.length > 0) sources.push(`${perFive.join(' and ')} (${models} models in the target unit)`);
  if (rapidFire !== null && conditions.halfRange) sources.push(`Rapid Fire ${normaliseDice(rapidFire)} (within half range)`);
  return { value: formatDiceSum(terms), sources: sources.join(' and ') };
}

/**
 * Melta extra damage per unsaved wound under the current conditions ("D3"), with its source
 * for the tooltip, or null when there is none or X is invalid (the row shows that error instead).
 */
function damageBonus(weapon: WeaponStats, conditions: AttackConditions): { value: string; sources: string } | null {
  const { melta } = weapon.abilities;
  if (melta === null || !tryParseDice(melta)) return null;
  const terms = bonusDamage({ abilities: weapon.abilities, conditions });
  if (terms.length === 0) return null;
  return { value: formatDiceSum(terms), sources: `Melta ${normaliseDice(melta)} (within half range)` };
}
