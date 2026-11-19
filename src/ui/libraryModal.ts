import { uid } from '../state/ids';
import { sortedLibrary, statsSummary, weaponUsage } from '../state/presets';
import type { AttackRow, StoredWeapon } from '../types';
import { h } from './dom';
import { confirmDialog, openModal } from './modal';
import { openWeaponModal } from './weaponModal';

export interface LibraryModalContext {
  library: StoredWeapon[];
  /** Live attack rows: a weapon they use can't be deleted. */
  rows: AttackRow[];
  /** The library changed (entry added, edited or deleted). */
  onChange: () => void;
}

/** "Weapon profiles…": list, create, edit and delete library entries. */
export function openLibraryModal(ctx: LibraryModalContext): Promise<void> {
  return openModal<void>({
    title: 'Weapon profiles',
    cancelValue: undefined,
    className: 'modal--wide',
    content: (close) => {
      const list = h('ul', { class: 'manage-list' });
      const empty = h('p', { class: 'modal-hint' }, 'No weapon profiles yet.');

      const render = (focusSelector?: string) => {
        const items = sortedLibrary(ctx.library).map((w) => item(w));
        list.replaceChildren(...items);
        empty.hidden = items.length > 0;
        if (focusSelector) list.closest('dialog')?.querySelector<HTMLElement>(focusSelector)?.focus();
      };

      const item = (w: StoredWeapon): HTMLLIElement => {
        const uses = weaponUsage(w.id, ctx.rows);
        const edit = h('button', { type: 'button', class: 'icon-button', 'data-id': w.id, 'data-action': 'edit', 'aria-label': `Edit ${w.name}`, title: 'Edit' }, '✎');
        const remove = h(
          'button',
          {
            type: 'button',
            class: 'icon-button remove',
            'aria-label': uses > 0 ? `Delete ${w.name} (used by ${uses} attack row${uses === 1 ? '' : 's'})` : `Delete ${w.name}`,
            title: uses > 0 ? `Used by ${uses} attack row${uses === 1 ? '' : 's'}` : 'Delete',
            disabled: uses > 0,
          },
          '✕',
        );
        edit.addEventListener('click', async () => {
          const stats = await openWeaponModal(w);
          if (stats) {
            Object.assign(w, stats);
            ctx.onChange();
          }
          render(`[data-id="${w.id}"][data-action="edit"]`);
        });
        remove.addEventListener('click', async () => {
          const ok = await confirmDialog(`Delete the weapon profile "${w.name}"? Saved presets keep their own copy.`, {
            confirmLabel: 'Delete',
            danger: true,
            title: 'Delete weapon profile',
          });
          if (!ok) return;
          const index = ctx.library.indexOf(w);
          if (index >= 0) ctx.library.splice(index, 1);
          ctx.onChange();
          render('.manage-add');
        });
        return h(
          'li',
          { class: 'manage-item' },
          h('div', { class: 'manage-text' }, h('span', { class: 'manage-name' }, w.name), h('span', { class: 'manage-detail' }, statsSummary(w))),
          h('div', { class: 'row-actions' }, edit, remove),
        );
      };

      const add = h('button', { type: 'button', class: 'button secondary manage-add' }, '+ New weapon profile');
      add.addEventListener('click', async () => {
        const stats = await openWeaponModal();
        if (stats) {
          const entry: StoredWeapon = { ...stats, id: uid('weapon') };
          ctx.library.push(entry);
          ctx.onChange();
          render(`[data-id="${entry.id}"][data-action="edit"]`);
        }
      });
      const done = h('button', { type: 'button', class: 'button primary' }, 'Done');
      done.addEventListener('click', () => close());

      render();
      return [
        h('div', { class: 'modal-body' }, list, empty),
        h('div', { class: 'modal-actions modal-actions--split' }, add, done),
      ];
    },
  });
}
