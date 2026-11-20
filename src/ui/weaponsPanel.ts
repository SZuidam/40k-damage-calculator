import { uid } from '../state/ids';
import { sortedLibrary, statsSummary, weaponUsage } from '../state/presets';
import type { AttackProfile, StoredWeapon } from '../types';
import { h } from './dom';
import { confirmDialog } from './modal';
import { openWeaponModal } from './weaponModal';

export interface WeaponsPanelOptions {
  library: StoredWeapon[];
  /** A weapon an attack uses can't be deleted. */
  attacks: AttackProfile[];
  /** The library changed (entry added, edited or deleted). */
  onChange: () => void;
}

/**
 * The Weapons tab of the configuration drawer: list, create, edit and delete library profiles.
 * Editing a profile changes every attack that uses it; deleting is blocked while an attack
 * uses it.
 */
export class WeaponsPanel {
  readonly element: HTMLDivElement;
  private readonly list: HTMLUListElement;
  private readonly empty: HTMLParagraphElement;

  constructor(private readonly options: WeaponsPanelOptions) {
    this.list = h('ul', { class: 'manage-list' });
    this.empty = h('p', { class: 'list-empty' }, 'No weapon profiles yet.');
    const add = h('button', { type: 'button', class: 'button secondary manage-add' }, '+ New weapon profile');
    add.addEventListener('click', async () => {
      const stats = await openWeaponModal();
      if (!stats) return;
      const entry: StoredWeapon = { ...stats, id: uid('weapon') };
      options.library.push(entry);
      options.onChange();
      this.render(`[data-id="${entry.id}"][data-action="edit"]`);
    });
    this.element = h(
      'div',
      { class: 'manage-panel' },
      h('p', { class: 'panel-hint' }, 'Editing a profile changes every attack that uses it.'),
      this.list,
      this.empty,
      h('div', { class: 'panel-actions-group' }, add),
    );
    this.render();
  }

  /** Redraw the list, then focus the element matching `focusSelector` if given. */
  render(focusSelector?: string): void {
    const items = sortedLibrary(this.options.library).map((w) => this.item(w));
    this.list.replaceChildren(...items);
    this.empty.hidden = items.length > 0;
    if (focusSelector) this.element.querySelector<HTMLElement>(focusSelector)?.focus();
  }

  /** "Gunline, Intercessors": the attacks that use a weapon, for the tooltip of a blocked delete. */
  private usedBy(weaponId: string): string {
    return this.options.attacks
      .filter((a) => a.rows.some((r) => r.weaponId === weaponId))
      .map((a) => a.name)
      .join(', ');
  }

  private item(w: StoredWeapon): HTMLLIElement {
    const { library, attacks, onChange } = this.options;
    const uses = weaponUsage(w.id, attacks);
    const usedBy = uses > 0 ? this.usedBy(w.id) : '';
    const edit = h('button', { type: 'button', class: 'icon-button', 'data-id': w.id, 'data-action': 'edit', 'aria-label': `Edit ${w.name}`, title: 'Edit' }, '✎');
    const remove = h(
      'button',
      {
        type: 'button',
        class: 'icon-button remove',
        'aria-label': uses > 0 ? `Delete ${w.name} (in use by ${usedBy})` : `Delete ${w.name}`,
        title: uses > 0 ? `In use by ${usedBy}` : 'Delete',
        disabled: uses > 0,
      },
      '✕',
    );
    edit.addEventListener('click', async () => {
      const stats = await openWeaponModal(w);
      if (stats) {
        Object.assign(w, stats);
        onChange();
      }
      this.render(`[data-id="${w.id}"][data-action="edit"]`);
    });
    remove.addEventListener('click', async () => {
      const ok = await confirmDialog(`Delete the weapon profile "${w.name}"?`, { confirmLabel: 'Delete', danger: true, title: 'Delete weapon profile' });
      if (!ok) return;
      const index = library.indexOf(w);
      if (index >= 0) library.splice(index, 1);
      onChange();
      this.render('.manage-add');
    });
    return h(
      'li',
      { class: 'manage-item' },
      h(
        'div',
        { class: 'manage-text' },
        h('span', { class: 'manage-name' }, w.name),
        h('span', { class: 'manage-detail' }, statsSummary(w)),
        uses > 0 ? h('span', { class: 'manage-usage' }, `Used by ${usedBy}`) : null,
      ),
      h('div', { class: 'row-actions' }, edit, remove),
    );
  }
}
