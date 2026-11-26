import { uid } from '../state/ids';
import { statLine } from '../state/presets';
import { applyImport, buildShareFile, parseShareText, planImport, serializeShareFile, type ConflictPolicy, type ImportItem, type ImportSummary, type ShareData, type ShareState } from '../state/share';
import { groupUnits } from '../state/units';
import type { UnitStats } from '../types';
import { h } from './dom';
import { openModal } from './modal';

/** "T4 · Sv 3+ · W2 · Infantry · 2 weapons", for a saved or an imported unit. */
function unitDetail(u: UnitStats & { weapons: unknown[] }): string {
  const count = u.weapons.length;
  return `${statLine(u)} · ${count === 0 ? 'no weapons' : `${count} weapon${count === 1 ? '' : 's'}`}`;
}

// ---------- checkbox picker ----------

interface PickerEntry {
  key: string;
  name: string;
  detail: string;
  checked: boolean;
  disabled?: boolean;
  tag?: { text: string; tone: 'muted' | 'warn' | 'danger' };
}

interface PickerGroup {
  title: string;
  entries: PickerEntry[];
}

/** Grouped checkboxes with a select-all box per group. */
function itemPicker(groups: PickerGroup[], onChange: () => void): { element: HTMLElement; selected: () => Set<string> } {
  const boxes = new Map<string, HTMLInputElement>();
  const element = h('div', { class: 'share-groups' });

  for (const group of groups) {
    if (group.entries.length === 0) continue;
    const allId = `share-all-${uid('f')}`;
    const all = h('input', { type: 'checkbox', id: allId, class: 'share-check' });
    const list = h('ul', { class: 'share-list' });
    const own: HTMLInputElement[] = [];

    const syncAll = () => {
      const enabled = own.filter((b) => !b.disabled);
      const checked = enabled.filter((b) => b.checked).length;
      all.checked = enabled.length > 0 && checked === enabled.length;
      all.indeterminate = checked > 0 && checked < enabled.length;
      all.disabled = enabled.length === 0;
    };

    for (const entry of group.entries) {
      const id = `share-item-${uid('f')}`;
      const box = h('input', { type: 'checkbox', id, class: 'share-check', checked: entry.checked && !entry.disabled, disabled: entry.disabled });
      box.addEventListener('change', () => {
        syncAll();
        onChange();
      });
      boxes.set(entry.key, box);
      own.push(box);
      list.append(
        h(
          'li',
          { class: `share-item${entry.disabled ? ' is-disabled' : ''}` },
          box,
          h(
            'label',
            { for: id, class: 'share-text' },
            h('span', { class: 'manage-name' }, entry.name, entry.tag ? h('span', { class: `share-tag share-tag--${entry.tag.tone}` }, entry.tag.text) : null),
            h('span', { class: 'manage-detail' }, entry.detail),
          ),
        ),
      );
    }

    all.addEventListener('change', () => {
      for (const box of own) if (!box.disabled) box.checked = all.checked;
      syncAll();
      onChange();
    });
    syncAll();
    element.append(
      h(
        'fieldset',
        { class: 'share-group' },
        h('legend', {}, h('label', { for: allId, class: 'share-group-title' }, all, `${group.title} (${group.entries.length})`)),
        list,
      ),
    );
  }

  const selected = () => new Set([...boxes].filter(([, box]) => box.checked && !box.disabled).map(([key]) => key));
  return { element, selected };
}

// ---------- export ----------

/** "Export…": pick units (grouped by army) and download them as JSON or copy them to the clipboard. */
export function openExportModal(state: ShareState): Promise<void> {
  return openModal<void>({
    title: 'Export',
    cancelValue: undefined,
    className: 'modal--wide',
    content: (close) => {
      const groups = groupUnits(state.units, state.armies, 'all');
      const status = h('p', { class: 'modal-hint share-status', 'aria-live': 'polite' });
      const copy = h('button', { type: 'button', class: 'button secondary' }, 'Copy');
      const download = h('button', { type: 'button', class: 'button primary' }, 'Download');
      const cancel = h('button', { type: 'button', class: 'button secondary' }, 'Close');
      cancel.addEventListener('click', () => close());

      const picker = itemPicker(
        groups.map((g) => ({
          title: g.army?.name ?? 'No army',
          entries: g.units.map((u) => ({ key: u.id, name: u.name, detail: unitDetail(u), checked: true })),
        })),
        () => sync(),
      );

      const json = () => serializeShareFile(buildShareFile(state, [...picker.selected()]));
      const sync = () => {
        const count = picker.selected().size;
        copy.disabled = download.disabled = count === 0;
        status.textContent = count === 0 ? 'Select at least one unit.' : `${count} unit${count === 1 ? '' : 's'} selected.`;
      };

      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(json());
          status.textContent = 'Copied. Paste it into Import… on the other device or browser.';
        } catch {
          status.textContent = 'This browser blocked copying. Use Download instead.';
        }
      });
      download.addEventListener('click', () => {
        const blob = new Blob([json()], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = h('a', { href: url, download: `damage-calculator-${new Date().toISOString().slice(0, 10)}.json` });
        document.body.append(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        status.textContent = 'Downloaded. Open it with Import… to load it.';
      });

      if (state.units.length === 0) {
        return [h('p', { class: 'modal-text' }, 'Nothing to export yet. Create units in the Units tab first.'), h('div', { class: 'modal-actions' }, cancel)];
      }
      sync();
      return [
        h(
          'div',
          { class: 'modal-body' },
          h('p', { class: 'modal-hint' }, 'Choose the units to share. Each unit takes its stats, keywords, weapons and the name of its army along.'),
          picker.element,
          status,
        ),
        h('div', { class: 'modal-actions' }, cancel, copy, download),
      ];
    },
  });
}

// ---------- import ----------

export interface ImportContext {
  state: ShareState;
  /** Items were added to or replaced in `state`. */
  onImported: (summary: ImportSummary) => void;
}

function itemTag(item: ImportItem): PickerEntry['tag'] {
  switch (item.status) {
    case 'duplicate':
      return { text: 'Already saved', tone: 'muted' };
    case 'conflict':
      return { text: 'Name in use in this army', tone: 'warn' };
    case 'invalid':
      return { text: item.problem ?? 'Invalid', tone: 'danger' };
    default:
      return undefined;
  }
}

function summaryText({ added, renamed, replaced, armies }: ImportSummary): string {
  const parts = [
    added > 0 ? `${added} added` : '',
    renamed > 0 ? `${renamed} added under a new name` : '',
    replaced > 0 ? `${replaced} replaced` : '',
  ].filter(Boolean);
  const total = added + renamed + replaced;
  if (total === 0) return 'Nothing was imported.';
  const created = armies > 0 ? ` Created ${armies} new arm${armies === 1 ? 'y' : 'ies'}.` : '';
  return `Imported ${total} unit${total === 1 ? '' : 's'}: ${parts.join(', ')}.${created}`;
}

/** "Import…": paste or open an export, review what it contains, and add the chosen items. */
export function openImportModal(ctx: ImportContext): Promise<void> {
  return openModal<void>({
    title: 'Import',
    cancelValue: undefined,
    className: 'modal--wide',
    initialFocus: () => document.querySelector<HTMLTextAreaElement>('dialog[open] .share-textarea'),
    content: (close) => {
      const body = h('div', { class: 'modal-body' });
      const actions = h('div', { class: 'modal-actions' });
      let pastedText = '';

      const showInput = () => {
        const textId = `import-text-${uid('f')}`;
        const text = h('textarea', { id: textId, class: 'share-textarea', rows: 8, spellcheck: 'false', placeholder: '{ "format": "damage-calculator-share", … }' });
        text.value = pastedText;
        const error = h('p', { class: 'row-errors', 'aria-live': 'polite' });
        const file = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
        const choose = h('button', { type: 'button', class: 'button secondary' }, 'Choose file…');
        const cancel = h('button', { type: 'button', class: 'button secondary' }, 'Cancel');
        const next = h('button', { type: 'button', class: 'button primary' }, 'Review');

        const review = () => {
          pastedText = text.value;
          const result = parseShareText(pastedText);
          if (result.ok) showReview(result.data);
          else {
            error.textContent = result.error;
            text.setAttribute('aria-invalid', 'true');
            text.focus();
          }
        };
        text.addEventListener('input', () => {
          error.textContent = '';
          text.removeAttribute('aria-invalid');
        });
        choose.addEventListener('click', () => file.click());
        file.addEventListener('change', async () => {
          const chosen = file.files?.[0];
          if (!chosen) return;
          try {
            text.value = await chosen.text();
            review();
          } catch {
            error.textContent = `Could not read ${chosen.name}.`;
          }
        });
        cancel.addEventListener('click', () => close());
        next.addEventListener('click', review);

        body.replaceChildren(
          h('p', { class: 'modal-hint' }, 'Paste an export made with Export…, or open the downloaded .json file.'),
          h('div', { class: 'field' }, h('label', { for: textId }, 'Exported data'), text),
          error,
          file,
        );
        actions.className = 'modal-actions modal-actions--split';
        actions.replaceChildren(choose, h('div', { class: 'modal-actions' }, cancel, next));
        text.focus();
      };

      const showReview = (data: ShareData) => {
        const items = planImport(data, ctx.state);
        const keyOf = (item: ImportItem) => String(item.index);
        // One group per army name in the file, in file order ("No army" as its own group).
        const armyNames = [...new Set(items.map((item) => item.army))];
        const importButton = h('button', { type: 'button', class: 'button primary' }, 'Import');
        const back = h('button', { type: 'button', class: 'button secondary' }, 'Back');
        const status = h('p', { class: 'modal-hint share-status', 'aria-live': 'polite' });

        const picker = itemPicker(
          armyNames.map((army) => ({
            title: army === null ? 'No army' : items.some((item) => item.army === army && item.newArmy) ? `${army} (new army)` : army,
            entries: items
              .filter((item) => item.army === army)
              .map((item) => ({
                key: keyOf(item),
                name: item.name,
                detail: unitDetail(data.units[item.index]),
                checked: item.status === 'new' || item.status === 'conflict',
                disabled: item.status === 'duplicate' || item.status === 'invalid',
                tag: itemTag(item),
              })),
          })),
          () => sync(),
        );

        const policyName = `import-policy-${uid('f')}`;
        const radio = (value: ConflictPolicy, label: string, checked: boolean) => {
          const id = `${policyName}-${value}`;
          return h('div', { class: 'share-radio' }, h('input', { type: 'radio', name: policyName, id, value, checked, class: 'share-check' }), h('label', { for: id }, label));
        };
        const policyBox = h(
          'fieldset',
          { class: 'share-policy' },
          h('legend', {}, 'When a name is already in use'),
          radio('rename', 'Keep both: import under a numbered name, e.g. “Intercessors (2)”', true),
          radio('replace', 'Replace the saved unit', false),
        );
        const policy = (): ConflictPolicy => (policyBox.querySelector<HTMLInputElement>('input:checked')?.value === 'replace' ? 'replace' : 'rename');

        const chosen = () => {
          const keys = picker.selected();
          return items.filter((item) => keys.has(keyOf(item)));
        };
        const sync = () => {
          const selected = chosen();
          importButton.disabled = selected.length === 0;
          importButton.textContent = selected.length === 0 ? 'Import' : `Import ${selected.length}`;
          policyBox.hidden = !selected.some((item) => item.status === 'conflict');
          const skipped = items.length - selected.length;
          status.textContent = skipped > 0 ? `${skipped} unit${skipped === 1 ? '' : 's'} won't be imported.` : '';
        };

        back.addEventListener('click', showInput);
        importButton.addEventListener('click', () => {
          const summary = applyImport(data, chosen(), ctx.state, policy());
          ctx.onImported(summary);
          showDone(summary);
        });

        body.replaceChildren(picker.element, policyBox, status);
        actions.className = 'modal-actions';
        actions.replaceChildren(back, importButton);
        sync();
        importButton.focus();
      };

      const showDone = (summary: ImportSummary) => {
        const done = h('button', { type: 'button', class: 'button primary' }, 'Done');
        done.addEventListener('click', () => close());
        body.replaceChildren(
          h('p', { class: 'modal-text' }, summaryText(summary)),
          h('p', { class: 'modal-hint' }, 'Pick the imported units from the Army and Unit lists on the main page.'),
        );
        actions.className = 'modal-actions';
        actions.replaceChildren(done);
        done.focus();
      };

      showInput();
      return [body, actions];
    },
  });
}
