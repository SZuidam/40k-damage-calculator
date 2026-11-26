import { bannerCss, isBannerUrl, type Banners } from '../state/banners';
import { uid } from '../state/ids';
import { byName, statsSummary } from '../state/presets';
import { copyUnit, deleteArmy, groupUnits, isNameTaken, newUnit, sameUnit, unitSummary, unitsInArmy, type ArmyFilter } from '../state/units';
import type { Army, StoredWeapon, Unit } from '../types';
import { abilityList } from './abilityList';
import { prepareBanner, prepareBannerUrl } from './bannerImage';
import { field, h, numberValue, select, setFieldError } from './dom';
import { Menu } from './menu';
import { MAX_PRESET_NAME, confirmDialog, openModal, promptName } from './modal';
import { INVULN_OPTIONS, SAVE_OPTIONS, keywordToggles } from './statFields';
import { hasErrors, validateUnit } from './validation';
import { openWeaponModal } from './weaponModal';

export interface UnitsPanelOptions {
  /** Mutated in place. */
  armies: Army[];
  /** Mutated in place. */
  units: Unit[];
  /** Armies or units changed (added, edited, deleted). */
  onChange: () => void;
  /** Banner images by unit id (only links are exported), mutated in place. */
  banners: Banners;
  /** A unit's banner was set or removed: save them; false when that failed (storage full). */
  onBannersChange: () => boolean;
}

const ARMY_TAKEN = 'An army with this name already exists';

/**
 * The Units tab of the configuration drawer. The list view has an army filter with a ⋯ menu
 * (New army…, Rename…, Delete) and the units grouped by army. ✎ and "+ New unit" replace the
 * list with an editor that works on a draft copy: Save writes it back, Back discards it.
 * Each unit holds its own weapons, edited with the weapon modal.
 */
export class UnitsPanel {
  readonly element: HTMLDivElement;
  private filter: ArmyFilter = 'all';
  private readonly listView: HTMLDivElement;
  private readonly editorView: HTMLDivElement;
  private readonly filterSelect: HTMLSelectElement;
  private readonly groups: HTMLDivElement;
  private readonly empty: HTMLParagraphElement;
  private readonly addUnit: HTMLButtonElement;
  private editing = false;

  constructor(private readonly options: UnitsPanelOptions) {
    this.filterSelect = h('select', { id: 'units-army-filter' });
    this.filterSelect.addEventListener('change', () => {
      this.filter = this.filterSelect.value;
      this.render();
    });
    const noArmy = () => (this.selectedArmy() ? null : 'Select an army first');
    const menu = new Menu({
      label: 'Army actions',
      items: [
        { label: 'New army…', onSelect: () => void this.createArmy() },
        { label: 'Army rules…', disabledReason: noArmy, onSelect: () => void this.editArmyRules() },
        { label: 'Rename…', disabledReason: noArmy, onSelect: () => void this.renameArmy() },
        { label: 'Delete', danger: true, disabledReason: noArmy, onSelect: () => void this.removeArmy() },
      ],
    });

    this.groups = h('div', { class: 'unit-groups' });
    this.empty = h('p', { class: 'list-empty' });
    this.addUnit = h('button', { type: 'button', class: 'button secondary manage-add' }, '+ New unit');
    this.addUnit.addEventListener('click', () => {
      const army = this.selectedArmy();
      this.openEditor(newUnit(army?.id ?? null), true);
    });

    this.listView = h(
      'div',
      { class: 'manage-panel' },
      h('p', { class: 'panel-hint' }, 'Define armies and their units. Every unit has its own weapons: two units can both have a Bolt rifle, each with its own profile.'),
      h('div', { class: 'preset-bar units-toolbar' }, h('div', { class: 'field preset-field' }, h('label', { for: this.filterSelect.id }, 'Army'), this.filterSelect), menu.element),
      this.groups,
      this.empty,
      h('div', { class: 'panel-actions-group' }, this.addUnit),
    );
    this.editorView = h('div', { class: 'unit-editor', hidden: true });
    this.element = h('div', { class: 'units-panel' }, this.listView, this.editorView);
    this.render();
  }

  /** The army picked in the filter, if it is one army (not "All armies" or "No army"). */
  private selectedArmy(): Army | undefined {
    return this.options.armies.find((a) => a.id === this.filter);
  }

  /** Redraw the list view (not the editor), then focus the element matching `focusSelector` if given. */
  render(focusSelector?: string): void {
    const { armies, units } = this.options;
    if (this.filter !== 'all' && this.filter !== 'none' && !this.selectedArmy()) this.filter = 'all';
    this.filterSelect.replaceChildren(
      h('option', { value: 'all' }, 'All armies'),
      ...byName(armies).map((a) => h('option', { value: a.id }, a.name)),
      h('option', { value: 'none' }, 'No army'),
    );
    this.filterSelect.value = this.filter;

    const groups = groupUnits(units, armies, this.filter);
    this.groups.replaceChildren(
      ...groups.map((group) =>
        h(
          'section',
          { class: 'unit-group' },
          h('h3', { class: 'unit-group-title' }, group.army?.name ?? 'No army'),
          h('ul', { class: 'manage-list' }, ...group.units.map((u) => this.item(u))),
        ),
      ),
    );
    this.empty.hidden = groups.length > 0;
    this.empty.textContent =
      units.length === 0 ? 'No units yet.' : this.filter === 'none' ? 'Every unit belongs to an army.' : `No units in ${this.selectedArmy()?.name ?? 'this army'} yet.`;
    if (focusSelector && !this.editing) this.element.querySelector<HTMLElement>(focusSelector)?.focus();
  }

  private item(u: Unit): HTMLLIElement {
    const edit = h('button', { type: 'button', class: 'icon-button', 'data-id': u.id, 'data-action': 'edit', 'aria-label': `Edit ${u.name}`, title: 'Edit' }, '✎');
    const remove = h('button', { type: 'button', class: 'icon-button remove', 'aria-label': `Delete ${u.name}`, title: 'Delete' }, '✕');
    edit.addEventListener('click', () => this.openEditor(copyUnit(u), false));
    remove.addEventListener('click', async () => {
      const ok = await confirmDialog(`Delete the unit "${u.name}" and its weapons?`, { confirmLabel: 'Delete', danger: true, title: 'Delete unit' });
      if (!ok) return;
      const index = this.options.units.indexOf(u);
      if (index >= 0) this.options.units.splice(index, 1);
      this.options.onChange();
      this.render('.manage-add');
    });
    return h(
      'li',
      { class: 'manage-item' },
      h('div', { class: 'manage-text' }, h('span', { class: 'manage-name' }, u.name), h('span', { class: 'manage-detail' }, unitSummary(u))),
      h('div', { class: 'row-actions' }, edit, remove),
    );
  }

  // ---------- armies ----------

  /** "Army rules…": the abilities every unit of the selected army has, edited in place. */
  private async editArmyRules(): Promise<void> {
    const army = this.selectedArmy();
    if (!army) return;
    await openModal<void>({
      title: `Army rules: ${army.name}`,
      cancelValue: undefined,
      className: 'modal--wide',
      content: (close) => {
        const done = h('button', { type: 'button', class: 'button primary' }, 'Done');
        done.addEventListener('click', () => close());
        return [
          h(
            'div',
            { class: 'modal-body' },
            h('p', { class: 'modal-hint' }, `Rules every unit of ${army.name} has when it attacks, such as a detachment rule. Changes are saved straight away.`),
            abilityList({
              abilities: army.abilities,
              scope: 'army',
              label: `Army rules of ${army.name}`,
              addLabel: '+ New army rule',
              onChange: () => {
                this.options.onChange();
                this.render();
              },
            }),
          ),
          h('div', { class: 'modal-actions' }, done),
        ];
      },
    });
  }

  private armyNames(except?: Army): string[] {
    return this.options.armies.filter((a) => a !== except).map((a) => a.name);
  }

  private async createArmy(): Promise<void> {
    const taken = this.armyNames();
    const name = await promptName('New army', '', { confirmLabel: 'Create', validate: (n) => (isNameTaken(taken, n) ? ARMY_TAKEN : undefined) });
    if (!name) return;
    const army: Army = { id: uid('army'), name, abilities: [] };
    this.options.armies.push(army);
    this.filter = army.id;
    this.options.onChange();
    this.render();
    this.filterSelect.focus();
  }

  private async renameArmy(): Promise<void> {
    const army = this.selectedArmy();
    if (!army) return;
    const taken = this.armyNames(army);
    const name = await promptName('Rename army', army.name, { confirmLabel: 'Rename', validate: (n) => (isNameTaken(taken, n) ? ARMY_TAKEN : undefined) });
    if (!name || name === army.name) return;
    army.name = name;
    this.options.onChange();
    this.render();
  }

  private async removeArmy(): Promise<void> {
    const army = this.selectedArmy();
    if (!army) return;
    const count = unitsInArmy(this.options.units, army.id);
    const note = count === 0 ? '' : ` Its ${count === 1 ? 'unit stays' : `${count} units stay`}, without an army.`;
    const ok = await confirmDialog(`Delete the army "${army.name}"?${note}`, { confirmLabel: 'Delete', danger: true, title: 'Delete army' });
    if (!ok) return;
    deleteArmy(this.options.armies, this.options.units, army.id);
    this.filter = 'all';
    this.options.onChange();
    this.render();
    this.filterSelect.focus();
  }

  // ---------- unit editor ----------

  /** Replace the list with an editor on `draft` (a copy; `isNew` when it isn't in the list yet). */
  private openEditor(draft: Unit, isNew: boolean): void {
    const { armies, units } = this.options;
    const original = copyUnit(draft);
    const id = (name: string) => `unit-editor-${name}`;
    // Only flag the name once the user has touched it, so a new unit doesn't open red.
    let nameTouched = !isNew;

    const name = h('input', { id: id('name'), type: 'text', value: draft.name, autocomplete: 'off', maxlength: MAX_PRESET_NAME, placeholder: 'e.g. Intercessor Squad' });
    const army = select({ id: id('army') }, [{ value: '', label: 'No army' }, ...byName(armies).map((a) => ({ value: a.id, label: a.name }))], draft.armyId ?? '');
    const toughness = h('input', { id: id('toughness'), type: 'number', inputmode: 'numeric', min: 1, max: 20, value: draft.toughness });
    const save = select({ id: id('save') }, SAVE_OPTIONS, draft.save);
    const invuln = select({ id: id('invuln') }, INVULN_OPTIONS, draft.invuln ?? '');
    const wounds = h('input', { id: id('wounds'), type: 'number', inputmode: 'numeric', min: 1, max: 40, value: draft.wounds });
    const keywords = keywordToggles(id('keyword'), draft.keywords, (checked) => (draft.keywords = checked));
    const errors = h('p', { class: 'row-errors', id: id('errors'), 'aria-live': 'polite' });
    const weaponList = h('ul', { class: 'manage-list', 'aria-label': 'Weapons of this unit' });
    const noWeapons = h('p', { class: 'list-empty' }, 'No weapons yet.');
    const addWeapon = h('button', { type: 'button', class: 'button secondary unit-add-weapon' }, '+ New weapon');
    const back = h('button', { type: 'button', class: 'button secondary' }, '‹ Back');
    const saveButton = h('button', { type: 'submit', class: 'button primary' }, isNew ? 'Create' : 'Save');
    const controls = { name, armyId: army, toughness, save, invuln, wounds };

    // ---------- banner ----------
    // Part of the draft: written to the banners on Save, dropped on Back.
    const banners = this.options.banners;
    const originalBanner: string | null = banners[draft.id] ?? null;
    let bannerDraft: string | null = originalBanner;
    const bannerFile = h('input', { id: id('banner-file'), type: 'file', accept: 'image/*', class: 'visually-hidden', tabindex: -1 });
    const bannerPreview = h('div', { class: 'unit-banner-preview', role: 'img', 'aria-label': 'Banner image' });
    const chooseBanner = h('button', { type: 'button', class: 'button secondary' }, 'Choose image…');
    const removeBanner = h('button', { type: 'button', class: 'button secondary' }, 'Remove');
    const bannerUrl = h('input', {
      id: id('banner-url'),
      type: 'url',
      inputmode: 'url',
      autocomplete: 'off',
      spellcheck: false,
      placeholder: 'https://…/image.png',
      'aria-label': 'Link to an online image',
    });
    const useBannerUrl = h('button', { type: 'button', class: 'button secondary' }, 'Use link');
    const bannerError = h('p', { class: 'row-errors', 'aria-live': 'polite' });
    const renderBanner = () => {
      bannerPreview.hidden = bannerDraft === null;
      bannerPreview.style.backgroundImage = bannerCss(bannerDraft);
      chooseBanner.textContent = bannerDraft === null || isBannerUrl(bannerDraft) ? 'Choose image…' : 'Replace image…';
      removeBanner.hidden = bannerDraft === null;
      bannerUrl.value = isBannerUrl(bannerDraft) ? bannerDraft : '';
    };
    chooseBanner.addEventListener('click', () => bannerFile.click());
    bannerFile.addEventListener('change', async () => {
      const file = bannerFile.files?.[0];
      bannerFile.value = '';
      if (!file) return;
      bannerError.textContent = 'Reading the image…';
      try {
        bannerDraft = await prepareBanner(file);
        bannerError.textContent = '';
      } catch (error) {
        bannerError.textContent = error instanceof Error ? error.message : 'This image could not be used.';
      }
      renderBanner();
      chooseBanner.focus();
    });
    const applyBannerUrl = async () => {
      if (bannerUrl.value.trim() === '') {
        bannerError.textContent = 'Paste a link to an online image first.';
        bannerUrl.focus();
        return;
      }
      bannerError.textContent = 'Loading the image…';
      useBannerUrl.disabled = true;
      try {
        bannerDraft = await prepareBannerUrl(bannerUrl.value);
        bannerError.textContent = '';
        renderBanner();
      } catch (error) {
        bannerError.textContent = error instanceof Error ? error.message : 'This link could not be used.';
      } finally {
        useBannerUrl.disabled = false;
      }
      bannerUrl.focus();
    };
    useBannerUrl.addEventListener('click', () => void applyBannerUrl());
    // Enter in the link field uses the link instead of saving the unit.
    bannerUrl.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      void applyBannerUrl();
    });
    removeBanner.addEventListener('click', () => {
      bannerDraft = null;
      bannerError.textContent = '';
      renderBanner();
      chooseBanner.focus();
    });
    /** Store the draft's banner; false (with the error shown) when it doesn't fit in storage. */
    const commitBanner = (): boolean => {
      if (bannerDraft === originalBanner) return true;
      if (bannerDraft === null) delete banners[draft.id];
      else banners[draft.id] = bannerDraft;
      if (this.options.onBannersChange()) return true;
      if (originalBanner === null) delete banners[draft.id];
      else banners[draft.id] = originalBanner;
      this.options.onBannersChange();
      bannerError.textContent = 'There is no room left to store this image. Remove the banners of other units, or pick a smaller image.';
      chooseBanner.focus();
      return false;
    };

    /** Names of the other units in the draft's army. */
    const takenUnitNames = () => units.filter((u) => u.id !== draft.id && u.armyId === draft.armyId).map((u) => u.name);

    const validate = () => {
      const result = validateUnit(draft, takenUnitNames());
      for (const [key, control] of Object.entries(controls)) {
        const message = key === 'name' && !nameTouched ? undefined : result[key as keyof Unit];
        setFieldError(control, message);
        if (message) control.setAttribute('aria-describedby', errors.id);
        else control.removeAttribute('aria-describedby');
      }
      errors.textContent = Object.entries(result)
        .filter(([key]) => key !== 'name' || nameTouched)
        .map(([, message]) => message)
        .join(' · ');
      saveButton.disabled = hasErrors(result);
      return result;
    };

    const bind = (control: HTMLInputElement | HTMLSelectElement, apply: () => void) => {
      control.addEventListener('input', () => {
        apply();
        validate();
      });
    };
    bind(name, () => {
      nameTouched = true;
      draft.name = name.value;
    });
    // Another army may hold a unit with the same name, so the name is checked again.
    bind(army, () => (draft.armyId = army.value === '' ? null : army.value));
    bind(toughness, () => (draft.toughness = numberValue(toughness)));
    bind(save, () => (draft.save = numberValue(save)));
    bind(invuln, () => (draft.invuln = invuln.value === '' ? null : numberValue(invuln)));
    bind(wounds, () => (draft.wounds = numberValue(wounds)));

    /** Names of the draft's weapons other than `except`. */
    const takenWeaponNames = (except?: StoredWeapon) => draft.weapons.filter((w) => w !== except).map((w) => w.name);

    const renderWeapons = (focusSelector?: string) => {
      weaponList.replaceChildren(
        ...draft.weapons.map((w) => {
          const edit = h('button', { type: 'button', class: 'icon-button', 'data-id': w.id, 'data-action': 'edit', 'aria-label': `Edit ${w.name}`, title: 'Edit' }, '✎');
          const remove = h('button', { type: 'button', class: 'icon-button remove', 'aria-label': `Delete ${w.name}`, title: 'Delete' }, '✕');
          edit.addEventListener('click', async () => {
            const stats = await openWeaponModal(w, { takenNames: takenWeaponNames(w) });
            if (stats) Object.assign(w, stats);
            renderWeapons(`[data-id="${w.id}"][data-action="edit"]`);
            validate();
          });
          remove.addEventListener('click', async () => {
            const ok = await confirmDialog(`Remove the weapon "${w.name}" from this unit?`, { confirmLabel: 'Remove', danger: true, title: 'Remove weapon' });
            if (!ok) return;
            draft.weapons.splice(draft.weapons.indexOf(w), 1);
            renderWeapons('.unit-add-weapon');
            validate();
          });
          return h(
            'li',
            { class: 'manage-item' },
            h('div', { class: 'manage-text' }, h('span', { class: 'manage-name' }, w.name), h('span', { class: 'manage-detail' }, statsSummary(w))),
            h('div', { class: 'row-actions' }, edit, remove),
          );
        }),
      );
      noWeapons.hidden = draft.weapons.length > 0;
      if (focusSelector) this.editorView.querySelector<HTMLElement>(focusSelector)?.focus();
    };

    addWeapon.addEventListener('click', async () => {
      const stats = await openWeaponModal(undefined, { takenNames: takenWeaponNames() });
      if (!stats) return;
      const weapon: StoredWeapon = { ...stats, id: uid('weapon') };
      draft.weapons.push(weapon);
      renderWeapons(`[data-id="${weapon.id}"][data-action="edit"]`);
      validate();
    });

    const closeEditor = (focusSelector: string) => {
      this.editing = false;
      this.editorView.hidden = true;
      this.editorView.replaceChildren();
      this.listView.hidden = false;
      this.render(focusSelector);
    };
    const focusAfter = isNew ? '.manage-add' : `[data-id="${draft.id}"][data-action="edit"]`;

    back.addEventListener('click', async () => {
      if (!sameUnit(draft, original) || bannerDraft !== originalBanner) {
        const ok = await confirmDialog(isNew ? 'Discard this new unit?' : `Discard the changes to "${original.name}"?`, { confirmLabel: 'Discard', danger: true, title: 'Unsaved changes' });
        if (!ok) return;
      }
      closeEditor(focusAfter);
    });

    const form = h(
      'form',
      { class: 'unit-editor-form', novalidate: true, 'aria-labelledby': id('title') },
      h('div', { class: 'unit-editor-head' }, back, h('h3', { id: id('title') }, isNew ? 'New unit' : 'Edit unit'), saveButton),
      h('div', { class: 'unit-editor-names' }, field('Name', name, 'field--name'), field('Army', army)),
      h('div', { class: 'defender-grid' }, field('T', toughness), field('Sv', save), field('Inv', invuln), field('W', wounds)),
      keywords.element,
      errors,
      h(
        'section',
        { class: 'settings-section unit-weapons unit-banner-section' },
        h('h3', {}, 'Banner'),
        h(
          'p',
          { class: 'panel-hint' },
          'An image from your PC or a link to an online image, shown faintly behind the Army and Unit pickers when this unit attacks. An image from your PC stays on this device; a link is included in exports.',
        ),
        bannerPreview,
        h('div', { class: 'panel-actions-group' }, chooseBanner, removeBanner),
        h('div', { class: 'unit-banner-url' }, bannerUrl, useBannerUrl),
        bannerFile,
        bannerError,
      ),
      h(
        'section',
        { class: 'settings-section unit-weapons' },
        h('h3', {}, 'Weapons'),
        h('p', { class: 'panel-hint' }, 'Weapons belong to this unit only. Names must be unique within the unit.'),
        weaponList,
        noWeapons,
        h('div', { class: 'panel-actions-group' }, addWeapon),
      ),
      h(
        'section',
        { class: 'settings-section unit-weapons unit-abilities' },
        h('h3', {}, 'Abilities'),
        h('p', { class: 'panel-hint' }, 'What the unit does to its attacks, and (for a character) to the unit it leads. Army rules are under the ⋯ menu of the army.'),
        abilityList({
          abilities: draft.abilities,
          scope: 'unit',
          label: 'Abilities of this unit',
          addLabel: '+ New ability',
          onChange: () => validate(),
        }),
      ),
    );
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      nameTouched = true;
      if (hasErrors(validate())) return;
      if (!commitBanner()) return;
      const saved = copyUnit({ ...draft, name: draft.name.trim() });
      const existing = units.find((u) => u.id === draft.id);
      if (existing) Object.assign(existing, saved);
      else units.push(saved);
      // Keep the saved unit visible when it moved out of the filtered army.
      if (this.filter !== 'all' && this.filter !== (saved.armyId ?? 'none')) this.filter = 'all';
      this.options.onChange();
      closeEditor(`[data-id="${saved.id}"][data-action="edit"]`);
    });

    this.editing = true;
    this.listView.hidden = true;
    this.editorView.replaceChildren(form);
    this.editorView.hidden = false;
    renderWeapons();
    renderBanner();
    validate();
    name.focus();
  }
}
