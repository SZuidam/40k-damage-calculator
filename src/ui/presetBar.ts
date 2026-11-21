import { byName } from '../state/presets';
import { h } from './dom';
import { Menu, type MenuItem } from './menu';
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
  /** What one item is called in dialogs, e.g. "preset" or "profile". Default "preset". */
  noun?: string;
  /** The end of the Delete confirmation: what happens to the workspace. */
  deleteNote?: string;
  /**
   * Show `Name (modified)` in the select while the workspace differs from the active preset.
   * Default true. Save stays disabled ("No changes to save") either way.
   */
  markModified?: boolean;
  items: () => PresetItem[];
  activeId: () => string | null;
  /** Whether the workspace differs from the active preset. */
  isDirty: () => boolean;
  /**
   * Whether a detached workspace (no active preset) holds work that loading a preset would
   * throw away. Default: never.
   */
  hasUnsavedWork?: () => boolean;
  /** Why the workspace can't be saved (e.g. a field is invalid), or null when it can. */
  saveBlockedReason?: () => string | null;
  /** Load a preset, or detach from the active one when `id` is null. */
  onLoad: (id: string | null) => void;
  /** Overwrite preset `id` with the workspace and make it active. */
  onSave: (id: string) => void;
  /** Save the workspace as a new preset and make it active. */
  onSaveAs: (name: string) => void;
  /** Rename preset `id`. Adds "Rename…" to the menu when given. */
  onRename?: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

/**
 * `[Preset ▾] [⋯]` for one kind of preset, the ⋯ menu holding Save, Save as…, Rename… (when
 * supported) and Delete. The workspace (e.g. the defender form) is separate from the presets:
 * the select can show `Name (modified)` while it differs from the active one. Call refresh()
 * after state changes.
 */
export class PresetBar {
  readonly element: HTMLDivElement;
  private readonly select: HTMLSelectElement;
  private readonly menu: Menu;
  private readonly noun: string;

  constructor(private readonly options: PresetBarOptions) {
    this.noun = options.noun ?? 'preset';
    const selectId = `${options.idPrefix}-select`;
    this.select = h('select', { id: selectId, class: 'preset-select' });
    const blocked = () => this.options.saveBlockedReason?.() ?? null;
    const noneActive = () => (this.options.activeId() ? null : `No ${this.noun} selected`);
    const items: MenuItem[] = [
      {
        label: 'Save',
        disabledReason: () => {
          if (!this.options.activeId()) return `Load or save a ${this.noun} first`;
          if (!this.options.isDirty()) return 'No changes to save';
          return blocked();
        },
        onSelect: () => {
          const id = this.options.activeId();
          if (id && this.options.isDirty()) this.options.onSave(id);
          this.refresh();
        },
      },
      { label: 'Save as…', disabledReason: blocked, onSelect: () => void this.saveAs() },
    ];
    if (options.onRename) items.push({ label: 'Rename…', disabledReason: noneActive, onSelect: () => void this.renameActive() });
    items.push({ label: 'Delete', danger: true, disabledReason: noneActive, onSelect: () => void this.deleteActive() });
    this.menu = new Menu({ label: `${options.label} actions`, items });

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
    const modified = (this.options.markModified ?? true) && active !== null && isDirty();

    this.select.replaceChildren(
      h('option', { value: '' }, '— Unsaved —'),
      ...byName(items()).map((p) => h('option', { value: p.id }, p.id === active && modified ? `${p.name} (modified)` : p.name)),
    );
    this.select.value = active ?? '';
    this.select.classList.toggle('is-modified', modified);
  }

  private nameOf(id: string | null): string {
    return this.options.items().find((p) => p.id === id)?.name ?? '';
  }

  private activeName(): string {
    return this.nameOf(this.options.activeId());
  }

  private async changeSelection(): Promise<void> {
    const next = this.select.value || null;
    const active = this.options.activeId();
    if (next === active) return;
    // Detaching keeps the workspace as is, so there is nothing to discard.
    if (next !== null) {
      let question: string | null = null;
      if (active !== null && this.options.isDirty()) question = `Discard changes to "${this.activeName()}"?`;
      else if (active === null && this.options.hasUnsavedWork?.()) question = `Discard the unsaved changes and load "${this.nameOf(next)}"?`;
      if (question) {
        const ok = await confirmDialog(question, { confirmLabel: 'Discard', danger: true, title: 'Unsaved changes' });
        if (!ok) {
          this.refresh();
          return;
        }
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
      const ok = await confirmDialog(`A ${this.noun} named "${existing.name}" already exists. Overwrite it?`, { confirmLabel: 'Overwrite', danger: true, title: `Overwrite ${this.noun}` });
      if (!ok) return;
      this.options.onSave(existing.id);
    } else {
      this.options.onSaveAs(name);
    }
    this.refresh();
  }

  private async renameActive(): Promise<void> {
    const id = this.options.activeId();
    if (!id || !this.options.onRename) return;
    const current = this.activeName();
    const name = await promptName(`Rename ${this.noun}`, current, { confirmLabel: 'Rename' });
    if (!name || name === current) return;
    this.options.onRename(id, name);
    this.refresh();
  }

  private async deleteActive(): Promise<void> {
    const id = this.options.activeId();
    if (!id) return;
    const note = this.options.deleteNote ?? 'The current inputs stay as they are.';
    const ok = await confirmDialog(`Delete the ${this.noun} "${this.activeName()}"? ${note}`, { confirmLabel: 'Delete', danger: true, title: `Delete ${this.noun}` });
    if (!ok) return;
    this.options.onDelete(id);
    this.refresh();
  }
}
