import { armyChoices, unitsOfArmy } from '../state/loadout';
import type { Army, Unit } from '../types';
import { h } from './dom';

export interface UnitPickerOptions {
  /** Prefix of the select ids, e.g. "attacker" gives "attacker-army" and "attacker-unit". */
  idPrefix: string;
  /** Read on every render; the arrays are the app's own (mutated in place by the Units tab). */
  armies: readonly Army[];
  units: readonly Unit[];
  /** The current picks: an army id or null ("No army"), and a unit id or null. */
  selection: () => { armyId: string | null; unitId: string | null };
  /** Another army was picked; the caller decides what happens to the picked unit, then calls render(). */
  onArmyChange: (armyId: string | null) => void;
  /** Another unit was picked (null: the placeholder); the caller updates its state, then calls render(). */
  onUnitChange: (unitId: string | null) => void;
  /**
   * The attacker's "Led by" dropdown: the units that can lead the picked unit, the picked leader,
   * and what to do when another is picked (null: "No leader"). Leave out for the defender.
   */
  leader?: {
    choices: () => Unit[];
    selected: () => string | null;
    onChange: (leaderId: string | null) => void;
  };
}

/** Value of the "No army" option and of the unit placeholder (ids are never empty). */
const NONE = '';

/**
 * Two dropdowns on the main page, Army and Unit: the unit dropdown lists the units of the picked
 * army. Without any units both are disabled and a hint points to ☰ → Units.
 */
export class UnitPicker {
  readonly element: HTMLDivElement;
  private readonly army: HTMLSelectElement;
  private readonly unit: HTMLSelectElement;
  private readonly hint: HTMLParagraphElement;
  private readonly leader: HTMLSelectElement | null;
  private readonly leaderField: HTMLDivElement | null;

  constructor(private readonly options: UnitPickerOptions) {
    const { idPrefix } = options;
    this.army = h('select', { id: `${idPrefix}-army` });
    this.unit = h('select', { id: `${idPrefix}-unit` });
    this.hint = h('p', { class: 'picker-hint', id: `${idPrefix}-picker-hint` }, 'Create armies and units under ☰ → Units.');
    this.army.addEventListener('change', () => options.onArmyChange(this.army.value === NONE ? null : this.army.value));
    this.unit.addEventListener('change', () => options.onUnitChange(this.unit.value === NONE ? null : this.unit.value));
    this.leader = options.leader ? h('select', { id: `${idPrefix}-leader` }) : null;
    this.leaderField = this.leader ? h('div', { class: 'field picker-field picker-field--leader', hidden: true }, h('label', { for: this.leader.id }, 'Led by'), this.leader) : null;
    this.leader?.addEventListener('change', () => options.leader?.onChange(this.leader!.value === NONE ? null : this.leader!.value));
    this.element = h(
      'div',
      { class: 'unit-picker' },
      h('div', { class: 'field picker-field' }, h('label', { for: this.army.id }, 'Army'), this.army),
      h('div', { class: 'field picker-field' }, h('label', { for: this.unit.id }, 'Unit'), this.unit),
      this.leaderField,
      this.hint,
    );
    this.render();
  }

  /** Rebuild both option lists from the armies, units and current picks (keeps focus on the selects). */
  render(): void {
    const { armies, units } = this.options;
    const { armyId, unitId } = this.options.selection();
    const none = units.length === 0;

    this.army.replaceChildren(...armyChoices(armies, units).map((c) => h('option', { value: c.id ?? NONE }, c.name)));
    this.army.value = armyId ?? NONE;

    const listed = unitsOfArmy(units, armies, armyId);
    const placeholder = none ? 'No units yet' : listed.length === 0 ? 'No units in this army' : 'Pick a unit…';
    this.unit.replaceChildren(h('option', { value: NONE }, placeholder), ...listed.map((u) => h('option', { value: u.id }, u.name)));
    this.unit.value = unitId !== null && listed.some((u) => u.id === unitId) ? unitId : NONE;

    this.army.disabled = none;
    this.unit.disabled = listed.length === 0;

    // "Led by" only shows while a unit is picked and some unit of its army can lead it.
    if (this.leader && this.leaderField && this.options.leader) {
      const choices = this.unit.value === NONE ? [] : this.options.leader.choices();
      const leaderId = this.options.leader.selected();
      this.leader.replaceChildren(h('option', { value: NONE }, 'No leader'), ...choices.map((u) => h('option', { value: u.id }, u.name)));
      this.leader.value = leaderId !== null && choices.some((u) => u.id === leaderId) ? leaderId : NONE;
      this.leaderField.hidden = choices.length === 0;
    }
    this.hint.hidden = !none;
    for (const select of [this.army, this.unit]) {
      if (none) select.setAttribute('aria-describedby', this.hint.id);
      else select.removeAttribute('aria-describedby');
    }
  }
}
