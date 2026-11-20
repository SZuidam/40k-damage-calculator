import { uid } from '../state/ids';
import { byName, copyRows, uniqueName } from '../state/presets';
import type { AttackConditions, AttackProfile, StoredWeapon } from '../types';
import { AttackList } from './attackList';
import { h } from './dom';
import { Menu } from './menu';
import { confirmDialog, promptName } from './modal';
import type { ChipDefender } from './statChips';

export interface AttackEditorOptions {
  library: StoredWeapon[];
  attacks: AttackProfile[];
  activeAttack: () => AttackProfile;
  /** Make another attack active (the main page shows it too). */
  onSelectAttack: (id: string) => void;
  /** An attack was created, renamed, duplicated or deleted. */
  onAttacksChanged: () => void;
  /** A row of the active attack was edited, added, removed or moved. */
  onChange: () => void;
  /** A library profile was created or edited from a row. */
  onLibraryChange: () => void;
  /** Apply the optimiser's best order. */
  onOptimise: () => void;
  defender: () => ChipDefender;
  conditions: () => AttackConditions;
}

/**
 * The Attacks tab of the configuration drawer: pick the attack to edit (the same active
 * attack as the main page), a ⋯ menu to create, rename, duplicate or delete attacks, the
 * editable rows, "+ Add weapon" and "Optimise order". An attack is the complete attack of a
 * unit. Edits change the attack directly; there is nothing to save.
 */
export class AttackEditor {
  readonly element: HTMLDivElement;
  readonly optimiseButton: HTMLButtonElement;
  readonly optimiseBadge: HTMLSpanElement;
  readonly optimiseStatus: HTMLParagraphElement;
  private readonly select: HTMLSelectElement;
  private readonly list: AttackList;

  constructor(private readonly options: AttackEditorOptions) {
    const selectId = 'editor-attack-select';
    this.select = h('select', { id: selectId, class: 'preset-select' });
    this.select.addEventListener('change', () => options.onSelectAttack(this.select.value));

    const menu = new Menu({
      label: 'Attack actions',
      items: [
        { label: 'New attack…', onSelect: () => void this.create() },
        { label: 'Rename…', onSelect: () => void this.rename() },
        { label: 'Duplicate', onSelect: () => this.duplicate() },
        {
          label: 'Delete',
          danger: true,
          disabledReason: () => (options.attacks.length <= 1 ? 'The last attack can’t be deleted' : null),
          onSelect: () => void this.remove(),
        },
      ],
    });

    const rowsHost = h('div', { class: 'editor-rows' });
    this.list = new AttackList(rowsHost, options.activeAttack().rows, {
      library: options.library,
      minRows: 0,
      emptyText: 'No weapons yet. Add one below.',
      onChange: options.onChange,
      onLibraryChange: options.onLibraryChange,
      defender: options.defender,
      conditions: options.conditions,
    });

    const addWeapon = h('button', { type: 'button', class: 'button secondary list-add' }, '+ Add weapon');
    addWeapon.addEventListener('click', () => this.list.add());

    this.optimiseStatus = h('p', { id: 'optimise-status', class: 'optimise-status', 'aria-live': 'polite' });
    this.optimiseBadge = h('span', { class: 'badge', hidden: true });
    this.optimiseButton = h('button', { type: 'button', id: 'optimise', class: 'button secondary', 'aria-describedby': 'optimise-status' }, 'Optimise order ', this.optimiseBadge);
    this.optimiseButton.addEventListener('click', () => options.onOptimise());

    this.element = h(
      'div',
      { class: 'attack-editor' },
      h('div', { class: 'preset-bar' }, h('div', { class: 'field preset-field' }, h('label', { for: selectId }, 'Attack'), this.select), menu.element),
      h('p', { class: 'panel-hint' }, 'Weapons resolve top to bottom. Changes apply straight away.'),
      rowsHost,
      h('div', { class: 'editor-actions' }, h('div', { class: 'panel-actions-group' }, addWeapon), h('div', { class: 'optimise' }, this.optimiseButton, this.optimiseStatus)),
    );
    this.renderSelect();
  }

  /** The active attack changed: show its rows. */
  setAttack(): void {
    this.list.setRows(this.options.activeAttack().rows);
    this.renderSelect();
  }

  /** Attack names or the active attack changed. */
  renderSelect(): void {
    const { attacks, activeAttack } = this.options;
    this.select.replaceChildren(...byName(attacks).map((a) => h('option', { value: a.id }, a.name)));
    this.select.value = activeAttack().id;
  }

  /** The library changed: weapon selects and chips show library data. */
  renderRows(): void {
    this.list.render();
  }

  /** The defender or the conditions changed: refresh the chips without re-rendering (keeps focus). */
  refreshStats(): void {
    this.list.refreshStats();
  }

  /** Apply a new row order (indices into the current rows). */
  reorder(order: number[]): void {
    this.list.reorder(order);
  }

  private names(except?: AttackProfile): string[] {
    return this.options.attacks.filter((a) => a !== except).map((a) => a.name);
  }

  private add(name: string, rows: AttackProfile['rows']): void {
    const attack: AttackProfile = { id: uid('attack'), name: uniqueName(this.names(), name), rows };
    this.options.attacks.push(attack);
    this.options.onAttacksChanged();
    this.options.onSelectAttack(attack.id);
  }

  private async create(): Promise<void> {
    const name = await promptName('New attack', '', { confirmLabel: 'Create' });
    if (name) this.add(name, []);
  }

  private duplicate(): void {
    const current = this.options.activeAttack();
    this.add(current.name, copyRows(current.rows));
  }

  private async rename(): Promise<void> {
    const current = this.options.activeAttack();
    const name = await promptName('Rename attack', current.name, { confirmLabel: 'Rename' });
    if (!name || name === current.name) return;
    current.name = uniqueName(this.names(current), name);
    this.options.onAttacksChanged();
  }

  private async remove(): Promise<void> {
    const { attacks } = this.options;
    const current = this.options.activeAttack();
    if (attacks.length <= 1) return;
    const ok = await confirmDialog(`Delete the attack "${current.name}"? Its weapon profiles stay in the library.`, { confirmLabel: 'Delete', danger: true, title: 'Delete attack' });
    if (!ok) return;
    attacks.splice(attacks.indexOf(current), 1);
    this.options.onSelectAttack(byName(attacks)[0].id);
    this.options.onAttacksChanged();
  }
}
