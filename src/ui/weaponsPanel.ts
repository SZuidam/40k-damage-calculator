import { uid } from '../state/ids';
import { sortedLibrary, statsSummary } from '../state/presets';
import type { StoredWeapon } from '../types';
import { h } from './dom';
import { confirmDialog } from './modal';
import { openWeaponModal } from './weaponModal';

export interface WeaponsPanelOptions {
  library: StoredWeapon[];
  /** The library changed (entry added, edited or deleted). */
  onChange: () => void;
}

/**
 * The Weapons tab of the configuration drawer: list, create, edit and delete library profiles.
 * Rows on the main page and saved profiles hold their own weapon copies, so editing or
 * deleting a library profile never changes them.
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
      h('p', { class: 'panel-hint' }, "Rows and saved profiles keep their own copy, so editing a profile here doesn't change them."),
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

  private item(w: StoredWeapon): HTMLLIElement {
    const { library, onChange } = this.options;
    const edit = h('button', { type: 'button', class: 'icon-button', 'data-id': w.id, 'data-action': 'edit', 'aria-label': `Edit ${w.name}`, title: 'Edit' }, '✎');
    const remove = h('button', { type: 'button', class: 'icon-button remove', 'aria-label': `Delete ${w.name}`, title: 'Delete' }, '✕');
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
      ),
      h('div', { class: 'row-actions' }, edit, remove),
    );
  }
}
