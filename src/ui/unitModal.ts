import { uid } from '../state/ids';
import { materialiseRows, rowsSummary, snapshotRows } from '../state/presets';
import type { AttackRow, StoredWeapon, UnitPreset } from '../types';
import { h } from './dom';
import { AttackList, newRow } from './attackList';
import { MAX_PRESET_NAME, confirmDialog, openModal } from './modal';
import { hasErrors, validateRow } from './validation';

export interface UnitModalContext {
  library: StoredWeapon[];
  /** Live attack rows, for "Copy rows from current attack". */
  rows: AttackRow[];
  units: UnitPreset[];
  /** Units changed (added, edited or deleted). */
  onUnitsChange: () => void;
  /** The library changed (a profile was created or edited, or a unit's weapon was restored). */
  onLibraryChange: () => void;
}

/** "Units…": list saved attacking units and edit them. */
export function openUnitModal(ctx: UnitModalContext): Promise<void> {
  return openModal<void>({
    title: 'Attacking units',
    cancelValue: undefined,
    className: 'modal--wide',
    content: (close) => {
      const body = h('div', { class: 'modal-body' });
      const actions = h('div', { class: 'modal-actions modal-actions--split' });

      const showList = (focusSelector?: string) => {
        const list = h('ul', { class: 'manage-list' });
        const units = [...ctx.units].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
        for (const unit of units) {
          const edit = h('button', { type: 'button', class: 'icon-button', 'data-id': unit.id, 'aria-label': `Edit ${unit.name}`, title: 'Edit' }, '✎');
          const remove = h('button', { type: 'button', class: 'icon-button remove', 'aria-label': `Delete ${unit.name}`, title: 'Delete' }, '✕');
          edit.addEventListener('click', () => showEditor(unit));
          remove.addEventListener('click', async () => {
            const ok = await confirmDialog(`Delete the unit "${unit.name}"?`, { confirmLabel: 'Delete', danger: true, title: 'Delete unit' });
            if (!ok) return;
            ctx.units.splice(ctx.units.indexOf(unit), 1);
            ctx.onUnitsChange();
            showList('.manage-add');
          });
          list.append(
            h(
              'li',
              { class: 'manage-item' },
              h('div', { class: 'manage-text' }, h('span', { class: 'manage-name' }, unit.name), h('span', { class: 'manage-detail' }, rowsSummary(unit.rows) || 'No rows')),
              h('div', { class: 'row-actions' }, edit, remove),
            ),
          );
        }
        body.replaceChildren(
          units.length > 0 ? list : h('p', { class: 'modal-hint' }, 'No units yet. A unit is a reusable block of attack rows you can append with “+ Add unit”.'),
        );

        const add = h('button', { type: 'button', class: 'button secondary manage-add' }, '+ New unit');
        const done = h('button', { type: 'button', class: 'button primary' }, 'Done');
        add.addEventListener('click', () => showEditor(null));
        done.addEventListener('click', () => close());
        actions.replaceChildren(add, done);
        (focusSelector ? body.closest('dialog')?.querySelector<HTMLElement>(focusSelector) : null)?.focus();
      };

      const showEditor = (unit: UnitPreset | null) => {
        // Editing works on live rows linked to the library, like the attack itself.
        let draftRows: AttackRow[] = [];
        if (unit) {
          const loaded = materialiseRows(unit.rows, ctx.library, unit.name);
          if (loaded.library.length !== ctx.library.length) {
            ctx.library.splice(0, ctx.library.length, ...loaded.library);
            ctx.onLibraryChange();
          }
          draftRows = loaded.rows;
        }

        const nameId = `unit-name-${uid('f')}`;
        const name = h('input', { id: nameId, type: 'text', value: unit?.name ?? '', autocomplete: 'off', maxlength: MAX_PRESET_NAME, placeholder: 'e.g. Intercessor squad' });
        const rowsHost = h('div', { class: 'unit-rows' });
        const status = h('p', { class: 'row-errors', 'aria-live': 'polite' });
        const save = h('button', { type: 'button', class: 'button primary' }, 'Save unit');
        const back = h('button', { type: 'button', class: 'button secondary' }, 'Back');

        const sync = () => {
          const nameMissing = name.value.trim() === '';
          const rowsInvalid = draftRows.some((r) => hasErrors(validateRow(r, ctx.library)));
          save.disabled = nameMissing || draftRows.length === 0 || rowsInvalid;
          status.textContent = draftRows.length === 0 ? 'Add at least one row.' : '';
        };
        const rowList = new AttackList(rowsHost, draftRows, {
          library: ctx.library,
          compact: true,
          minRows: 0,
          onChange: sync,
          onLibraryChange: ctx.onLibraryChange,
        });

        const addRow = h('button', { type: 'button', class: 'button secondary small' }, '+ Add row');
        const copy = h('button', { type: 'button', class: 'button secondary small', disabled: ctx.rows.length === 0 }, 'Copy rows from current attack');
        addRow.addEventListener('click', () => rowList.add());
        copy.addEventListener('click', () => {
          draftRows.splice(0, draftRows.length, ...ctx.rows.map((r) => newRow(r.weaponId, r.models)));
          rowList.render();
          sync();
        });
        name.addEventListener('input', sync);
        back.addEventListener('click', () => showList(unit ? `[data-id="${unit.id}"]` : '.manage-add'));

        const form = h(
          'form',
          { class: 'unit-editor', novalidate: true },
          h('div', { class: 'field' }, h('label', { for: nameId }, 'Unit name'), name),
          rowsHost,
          h('div', { class: 'unit-editor-buttons' }, addRow, copy),
          status,
        );
        form.addEventListener('submit', (event) => {
          event.preventDefault();
          sync();
          if (save.disabled) return;
          const rows = snapshotRows(draftRows, ctx.library);
          if (unit) {
            unit.name = name.value.trim();
            unit.rows = rows;
          } else {
            ctx.units.push({ id: uid('unit'), name: name.value.trim(), rows });
          }
          ctx.onUnitsChange();
          showList('.manage-add');
        });
        // The save button lives in the shared action bar, outside the form.
        save.addEventListener('click', () => form.requestSubmit());

        body.replaceChildren(form);
        actions.replaceChildren(back, save);
        sync();
        name.focus();
      };

      showList();
      return [body, actions];
    },
  });
}
