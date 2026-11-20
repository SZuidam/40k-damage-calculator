import { byName } from '../state/presets';
import { h } from './dom';
import { Menu } from './menu';
import { confirmDialog, promptName } from './modal';

export interface PresetItem {
  id: string;
  name: string;
}

export interface PresetBarOptions {
  /** Visible label, e.g. "Defender preset". */
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

/**
 * `[Preset ▾] [⋯]` for one kind of preset, the ⋯ menu holding Save, Save as… and Delete.
 * The workspace (e.g. the defender form) is separate from the presets: the select shows
 * `Name (modified)` while it differs from the active one. Call refresh() after state changes.
 */
export class PresetBar {
  readonly element: HTMLDivElement;
  private readonly select: HTMLSelectElement;
  private readonly menu: Menu;

  constructor(private readonly options: PresetBarOptions) {
    const selectId = `${options.idPrefix}-select`;
    this.select = h('select', { id: selectId, class: 'preset-select' });
    const fixFirst = () => (this.options.canSave?.() ?? true ? null : 'Fix the highlighted fields first');
    this.menu = new Menu({
      label: `${options.label} actions`,
      items: [
        {
          label: 'Save',
          disabledReason: () => {
            const active = this.options.activeId();
            if (!active) return 'Load or save a preset first';
            if (!this.options.isDirty()) return 'No changes to save';
            return fixFirst();
          },
          onSelect: () => {
            const id = this.options.activeId();
            if (id && this.options.isDirty()) this.options.onSave(id);
            this.refresh();
          },
        },
        { label: 'Save as…', disabledReason: fixFirst, onSelect: () => void this.saveAs() },
        { label: 'Delete', danger: true, disabledReason: () => (this.options.activeId() ? null : 'No preset selected'), onSelect: () => void this.deleteActive() },
      ],
    });

    this.element = h(
      'div',
      { class: 'preset-bar' },
      h('div', { class: 'field preset-field' }, h('label', { for: selectId }, options.label), this.select),
      this.menu.element,
    );

    this.select.addEventListener('change', () => void this.changeSelection());
    this.refresh();
  }

  refresh(): void {
    const { items, activeId, isDirty } = this.options;
    const active = activeId();
    const dirty = active !== null && isDirty();

    this.select.replaceChildren(
      h('option', { value: '' }, '— Unsaved —'),
      ...byName(items()).map((p) => h('option', { value: p.id }, p.id === active && dirty ? `${p.name} (modified)` : p.name)),
    );
    this.select.value = active ?? '';
    this.select.classList.toggle('is-modified', dirty);
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
