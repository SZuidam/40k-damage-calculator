import { h } from './dom';
import { confirmDialog, promptName } from './modal';

export interface PresetItem {
  id: string;
  name: string;
}

export interface PresetBarOptions {
  /** Visible label, e.g. "Attack profile". */
  label: string;
  /** Prefix for element ids. */
  idPrefix: string;
  items: () => PresetItem[];
  activeId: () => string | null;
  /** Whether the workspace differs from the active preset. */
  isDirty: () => boolean;
  /** Whether the workspace can be saved at all (e.g. every row valid). */
  canSave?: () => boolean;
  /** Load a preset, or detach from the active one when `id` is null. */
  onLoad: (id: string | null) => void;
  /** Overwrite preset `id` with the workspace and make it active. */
  onSave: (id: string) => void;
  /** Save the workspace as a new preset and make it active. */
  onSaveAs: (name: string) => void;
  onDelete: (id: string) => void;
}

/** `[Preset ▾] [Save] [Save as…] [Delete]` for one kind of preset. Call refresh() after state changes. */
export class PresetBar {
  readonly element: HTMLDivElement;
  private readonly select: HTMLSelectElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly saveAsButton: HTMLButtonElement;
  private readonly deleteButton: HTMLButtonElement;

  constructor(private readonly options: PresetBarOptions) {
    const selectId = `${options.idPrefix}-select`;
    this.select = h('select', { id: selectId, class: 'preset-select' });
    this.saveButton = h('button', { type: 'button', class: 'button secondary small' }, 'Save');
    this.saveAsButton = h('button', { type: 'button', class: 'button secondary small' }, 'Save as…');
    this.deleteButton = h('button', { type: 'button', class: 'button secondary small danger-text' }, 'Delete');

    this.element = h(
      'div',
      { class: 'preset-bar' },
      h('div', { class: 'field preset-field' }, h('label', { for: selectId }, options.label), this.select),
      h('div', { class: 'preset-buttons' }, this.saveButton, this.saveAsButton, this.deleteButton),
    );

    this.select.addEventListener('change', () => void this.changeSelection());
    this.saveButton.addEventListener('click', () => {
      const id = this.options.activeId();
      if (id && this.options.isDirty()) this.options.onSave(id);
    });
    this.saveAsButton.addEventListener('click', () => void this.saveAs());
    this.deleteButton.addEventListener('click', () => void this.deleteActive());
    this.refresh();
  }

  refresh(): void {
    const { items, activeId, isDirty, canSave } = this.options;
    const active = activeId();
    const dirty = active !== null && isDirty();
    const savable = canSave?.() ?? true;
    const all = [...items()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));

    this.select.replaceChildren(
      h('option', { value: '' }, '— Unsaved —'),
      ...all.map((p) => h('option', { value: p.id }, p.id === active && dirty ? `${p.name} (modified)` : p.name)),
    );
    this.select.value = active ?? '';
    this.select.classList.toggle('is-modified', dirty);

    this.saveButton.disabled = !dirty || !savable;
    this.saveButton.title = !active ? 'Load or save a preset first' : !dirty ? 'No changes to save' : !savable ? 'Fix the highlighted fields first' : `Overwrite "${this.activeName()}"`;
    this.saveAsButton.disabled = !savable;
    this.saveAsButton.title = savable ? '' : 'Fix the highlighted fields first';
    this.deleteButton.disabled = active === null;
  }

  private activeName(): string {
    const id = this.options.activeId();
    return this.options.items().find((p) => p.id === id)?.name ?? '';
  }

  private async changeSelection(): Promise<void> {
    const next = this.select.value || null;
    const active = this.options.activeId();
    if (next === active) return;
    // Detaching keeps the workspace as is, so there is nothing to discard.
    if (next !== null && active !== null && this.options.isDirty()) {
      const ok = await confirmDialog(`Discard changes to "${this.activeName()}"?`, { confirmLabel: 'Discard', danger: true, title: 'Unsaved changes' });
      if (!ok) {
        this.refresh();
        return;
      }
    }
    this.options.onLoad(next);
    this.refresh();
  }

  private async saveAs(): Promise<void> {
    const name = await promptName(`Save ${this.options.label.toLowerCase()} as`, this.activeName());
    if (!name) return;
    const existing = this.options.items().find((p) => p.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      const ok = await confirmDialog(`A preset named "${existing.name}" already exists. Overwrite it?`, { confirmLabel: 'Overwrite', danger: true, title: 'Overwrite preset' });
      if (!ok) return;
      this.options.onSave(existing.id);
    } else {
      this.options.onSaveAs(name);
    }
    this.refresh();
  }

  private async deleteActive(): Promise<void> {
    const id = this.options.activeId();
    if (!id) return;
    const ok = await confirmDialog(`Delete the preset "${this.activeName()}"? The current inputs stay as they are.`, { confirmLabel: 'Delete', danger: true, title: 'Delete preset' });
    if (!ok) return;
    this.options.onDelete(id);
    this.refresh();
  }
}
