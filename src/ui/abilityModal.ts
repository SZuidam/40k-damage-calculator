import { BUILTIN_CONDITIONS, conditionSummary, copyAbility, emptyGrant, newAbility, sortConditions } from '../state/unitAbilities';
import { DEFENDER_KEYWORDS, KEYWORD_NAMES, WEAPON_TYPE_NAMES, type AbilityEffect, type AbilityTarget, type DefenderKeyword, type UnitAbility, type WeaponType } from '../types';
import { h, select, setFieldError } from './dom';
import { openModal } from './modal';
import { renderMarkup } from './markup';
import { MAX_DESCRIPTION, MAX_EFFECTS, MAX_WEAPON_NAME, hasErrors, validateAbility } from './validation';
import { weaponAbilityEditor } from './weaponAbilityEditor';

export interface AbilityModalOptions {
  /** 'unit' asks whom the ability helps (the unit or the unit it leads); army rules always help the unit. */
  scope: 'unit' | 'army';
  /** Names the ability may not have (the other abilities of the same unit or army). */
  takenNames: readonly string[];
}

/** The effect choices of the "Effect" dropdown, each a kind with its first field fixed. */
const EFFECT_CHOICES: { value: string; label: string; create: () => AbilityEffect; matches: (e: AbilityEffect) => boolean }[] = [
  { value: 'attacks', label: 'Attacks +X', create: () => ({ kind: 'stat', stat: 'attacks', amount: 1 }), matches: (e) => e.kind === 'stat' && e.stat === 'attacks' },
  { value: 'strength', label: 'Strength +X', create: () => ({ kind: 'stat', stat: 'strength', amount: 1 }), matches: (e) => e.kind === 'stat' && e.stat === 'strength' },
  { value: 'damage', label: 'Damage +X', create: () => ({ kind: 'stat', stat: 'damage', amount: 1 }), matches: (e) => e.kind === 'stat' && e.stat === 'damage' },
  { value: 'ap', label: 'Improve AP by X', create: () => ({ kind: 'ap', amount: 1 }), matches: (e) => e.kind === 'ap' },
  { value: 'hit', label: 'Hit roll modifier', create: () => ({ kind: 'roll', roll: 'hit', amount: 1 }), matches: (e) => e.kind === 'roll' && e.roll === 'hit' },
  { value: 'wound', label: 'Wound roll modifier', create: () => ({ kind: 'roll', roll: 'wound', amount: 1 }), matches: (e) => e.kind === 'roll' && e.roll === 'wound' },
  { value: 'critical-hit', label: 'Critical hits on', create: () => ({ kind: 'critical', roll: 'hit', on: 5 }), matches: (e) => e.kind === 'critical' && e.roll === 'hit' },
  { value: 'critical-wound', label: 'Critical wounds on', create: () => ({ kind: 'critical', roll: 'wound', on: 5 }), matches: (e) => e.kind === 'critical' && e.roll === 'wound' },
  { value: 'reroll-hit', label: 'Re-roll hits', create: () => ({ kind: 'reroll', roll: 'hit', which: 'ones' }), matches: (e) => e.kind === 'reroll' && e.roll === 'hit' },
  { value: 'reroll-wound', label: 'Re-roll wounds', create: () => ({ kind: 'reroll', roll: 'wound', which: 'ones' }), matches: (e) => e.kind === 'reroll' && e.roll === 'wound' },
  { value: 'reroll-damage', label: 'Re-roll damage', create: () => ({ kind: 'rerollDamage' }), matches: (e) => e.kind === 'rerollDamage' },
  { value: 'grant', label: 'Gain weapon abilities', create: emptyGrant, matches: (e) => e.kind === 'grant' },
];

const AMOUNT_OPTIONS = [1, 2, 3, 4, 5, 6].map((v) => ({ value: v, label: `+${v}` }));
const AP_AMOUNT_OPTIONS = [1, 2, 3, 4, 5, 6].map((v) => ({ value: v, label: String(v) }));
const MODIFIER_OPTIONS = [
  { value: 1, label: '+1' },
  { value: -1, label: '-1' },
];
const THRESHOLD_OPTIONS = [5, 4, 3, 2].map((v) => ({ value: v, label: `${v}+` }));
const REROLL_OPTIONS = [
  { value: 'ones', label: 'of 1' },
  { value: 'failed', label: 'that failed' },
];

let modalCounter = 0;

/** A group of radio pills joined into one segmented control. */
function segmented<T extends string>(name: string, legend: string, choices: { value: T; label: string }[], value: T, onChange: (value: T) => void): HTMLFieldSetElement {
  const pills = choices.map((c) => {
    const radio = h('input', { id: `${name}-${c.value}`, type: 'radio', name, value: c.value, class: 'toggle-input', checked: c.value === value });
    radio.addEventListener('change', () => radio.checked && onChange(c.value));
    return h('label', { class: 'toggle-pill' }, radio, h('span', {}, c.label));
  });
  return h('fieldset', { class: 'toggle-group segmented' }, h('legend', {}, legend), h('div', { class: 'toggle-pills' }, ...pills));
}

/**
 * Create (no `initial`) or edit a unit ability or army rule in a modal: its name, an optional
 * description (with markup and a live preview), whom it helps (units only), when it applies
 * (switched on by hand, built-in conditions, weapon type, target keyword) and its effects. Resolves the saved ability, or null when cancelled.
 */
export function openAbilityModal(initial: UnitAbility | undefined, options: AbilityModalOptions): Promise<UnitAbility | null> {
  const draft = initial ? copyAbility(initial) : newAbility();
  if (options.scope === 'army') draft.appliesTo = 'unit';
  modalCounter += 1;
  const id = (name: string) => `ability-modal-${modalCounter}-${name}`;
  let nameInput: HTMLInputElement | undefined;
  const noun = options.scope === 'army' ? 'army rule' : 'ability';

  return openModal<UnitAbility | null>({
    title: initial ? `Edit ${noun}` : `New ${noun}`,
    cancelValue: null,
    className: 'modal--wide',
    initialFocus: () => nameInput,
    content: (close) => {
      const name = h('input', { id: id('name'), type: 'text', value: draft.name, autocomplete: 'off', maxlength: MAX_WEAPON_NAME, placeholder: 'e.g. Shock Assault' });
      nameInput = name;
      const description = h('textarea', { id: id('description'), class: 'ability-description-input', rows: 5, maxlength: MAX_DESCRIPTION, placeholder: 'Optional: the rule text, for your own reference' });
      description.value = draft.description;
      const descriptionCount = h('span', { class: 'field-count', id: id('description-count') });
      const descriptionPreview = h('div', { class: 'markup ability-description-preview', 'aria-label': 'Preview of the description' });
      description.setAttribute('aria-describedby', `${id('description-hint')} ${descriptionCount.id}`);
      const renderDescription = () => {
        descriptionCount.textContent = `${draft.description.length} / ${MAX_DESCRIPTION}`;
        descriptionPreview.replaceChildren(...renderMarkup(draft.description));
        descriptionPreview.hidden = draft.description.trim() === '';
      };
      const errors = h('p', { class: 'row-errors', id: id('errors'), 'aria-live': 'polite' });
      const cancel = h('button', { type: 'button', class: 'button secondary' }, 'Cancel');
      const save = h('button', { type: 'submit', class: 'button primary' }, initial ? 'Save' : 'Create');
      cancel.addEventListener('click', () => close(null));

      // ---------- when ----------
      const summary = h('p', { class: 'modal-hint ability-when-summary', 'aria-live': 'polite' });
      const togglePill = (inputId: string, label: string, title: string, checked: boolean, onChange: (checked: boolean) => void) => {
        const box = h('input', { id: inputId, type: 'checkbox', class: 'toggle-input', checked });
        box.addEventListener('change', () => {
          onChange(box.checked);
          validate();
        });
        return h('label', { class: 'toggle-pill', title }, box, h('span', {}, label));
      };
      const toggle = togglePill(id('toggle'), 'Switched on by hand', 'The ability’s name becomes a toggle on the main page, and it only applies while that is on.', draft.when.toggle, (on) => (draft.when.toggle = on));
      const builtins = BUILTIN_CONDITIONS.map(({ key, toggle: label }) =>
        togglePill(id(`condition-${key}`), label, `Only while “${label}” is on on the main page.`, draft.when.conditions.includes(key), (on) => {
          draft.when.conditions = sortConditions(on ? [...draft.when.conditions, key] : draft.when.conditions.filter((k) => k !== key));
        }),
      );
      const needs = h('fieldset', { class: 'toggle-group ability-needs' }, h('legend', {}, 'Needs (all must be on)'), h('div', { class: 'toggle-pills' }, toggle, ...builtins));

      const weaponType = segmented<WeaponType | 'any'>(
        id('weapon-type'),
        'Weapons',
        [{ value: 'any', label: 'Any' }, ...(['ranged', 'melee'] as const).map((t) => ({ value: t, label: WEAPON_TYPE_NAMES[t] }))],
        draft.when.weaponType,
        (value) => {
          draft.when.weaponType = value;
          validate();
        },
      );
      const target = select({ id: id('target') }, [{ value: '', label: 'Any target' }, ...DEFENDER_KEYWORDS.map((k) => ({ value: k, label: KEYWORD_NAMES[k] }))], draft.when.targetKeyword ?? '');
      target.addEventListener('input', () => {
        draft.when.targetKeyword = target.value === '' ? null : (target.value as DefenderKeyword);
        validate();
      });

      const appliesTo =
        options.scope === 'unit'
          ? segmented<AbilityTarget>(
              id('applies-to'),
              'Applies to',
              [
                { value: 'unit', label: 'This unit' },
                { value: 'ledUnit', label: 'The unit it leads' },
              ],
              draft.appliesTo,
              (value) => (draft.appliesTo = value),
            )
          : null;

      // ---------- effects ----------
      const effectList = h('ol', { class: 'effect-list', 'aria-label': 'Effects' });
      const addEffect = h('button', { type: 'button', class: 'button secondary effect-add' }, '+ Add effect');
      addEffect.addEventListener('click', () => {
        draft.effects.push(EFFECT_CHOICES[0].create());
        renderEffects();
        validate();
        effectList.querySelector<HTMLSelectElement>('.effect-row:last-child .effect-kind')?.focus();
      });

      const numberSelect = (label: string, opts: { value: number | string; label: string }[], value: number | string, apply: (v: string) => void, i: number) => {
        const el = select({ id: id(`effect-${i}-value`), class: 'effect-value', 'aria-label': label }, opts, value);
        el.addEventListener('input', () => {
          apply(el.value);
          validate();
        });
        return el;
      };

      const effectFields = (e: AbilityEffect, i: number): HTMLElement[] => {
        switch (e.kind) {
          case 'stat':
            return [numberSelect('Amount', AMOUNT_OPTIONS, e.amount, (v) => (e.amount = Number(v)), i)];
          case 'ap':
            return [numberSelect('Improve AP by', AP_AMOUNT_OPTIONS, e.amount, (v) => (e.amount = Number(v)), i)];
          case 'roll':
            return [numberSelect('Modifier', MODIFIER_OPTIONS, e.amount, (v) => (e.amount = Number(v)), i)];
          case 'critical':
            return [numberSelect('Unmodified roll', THRESHOLD_OPTIONS, e.on, (v) => (e.on = Number(v)), i)];
          case 'reroll':
            return [numberSelect('Which rolls', REROLL_OPTIONS, e.which, (v) => (e.which = v === 'failed' ? 'failed' : 'ones'), i)];
          case 'rerollDamage':
            // Which rolls is a setting: below the D3 / D6 threshold under ☰ → Settings.
            return [h('span', { class: 'effect-note', title: 'A D3 or D6 damage roll below its threshold under ☰ → Settings is re-rolled once.' }, 'below the Settings threshold')];
          case 'grant':
            return [];
        }
      };

      const renderEffects = () => {
        effectList.replaceChildren(
          ...draft.effects.map((effect, i) => {
            const kind = select(
              { id: id(`effect-${i}-kind`), class: 'effect-kind', 'aria-label': `Effect ${i + 1}` },
              EFFECT_CHOICES.map((c) => ({ value: c.value, label: c.label })),
              EFFECT_CHOICES.find((c) => c.matches(effect))?.value ?? '',
            );
            kind.addEventListener('input', () => {
              draft.effects[i] = EFFECT_CHOICES.find((c) => c.value === kind.value)!.create();
              renderEffects();
              validate();
              effectList.querySelector<HTMLSelectElement>(`#${CSS.escape(kind.id)}`)?.focus();
            });
            const remove = h('button', { type: 'button', class: 'icon-button remove', 'aria-label': `Remove effect ${i + 1}`, title: 'Remove' }, '✕');
            remove.addEventListener('click', () => {
              draft.effects.splice(i, 1);
              renderEffects();
              validate();
              (effectList.querySelector<HTMLSelectElement>('.effect-kind') ?? addEffect).focus();
            });
            const row = h('li', { class: 'effect-row' }, h('div', { class: 'effect-line' }, kind, ...effectFields(effect, i), remove));
            if (effect.kind === 'grant') {
              const editor = weaponAbilityEditor({
                id: id(`effect-${i}-grant`),
                label: 'Weapon abilities to gain',
                listLabel: 'Weapon abilities gained',
                get: () => effect.abilities,
                set: (abilities) => (effect.abilities = abilities),
                onChange: () => validate(),
              });
              row.append(editor.element);
            }
            return row;
          }),
        );
        addEffect.disabled = draft.effects.length >= MAX_EFFECTS;
      };

      // ---------- validation ----------
      let nameTouched = initial !== undefined;
      const validate = () => {
        const result = validateAbility(draft, options.takenNames);
        const nameError = nameTouched ? result.name : undefined;
        setFieldError(name, nameError);
        if (nameError) name.setAttribute('aria-describedby', errors.id);
        else name.removeAttribute('aria-describedby');
        errors.textContent = Object.entries(result)
          .filter(([key]) => key !== 'name' || nameTouched)
          .map(([, message]) => message)
          .join(' · ');
        const when = conditionSummary(draft.when);
        summary.textContent = when === '' ? 'Applies to every attack.' : `Applies when: ${when}.`;
        save.disabled = hasErrors(result);
        return result;
      };
      name.addEventListener('input', () => {
        nameTouched = true;
        draft.name = name.value;
        validate();
      });
      description.addEventListener('input', () => {
        draft.description = description.value;
        renderDescription();
        validate();
      });

      const form = h(
        'form',
        { class: 'modal-body ability-form', novalidate: true },
        h('div', { class: 'field field--name' }, h('label', { for: name.id }, 'Name'), name),
        h(
          'div',
          { class: 'field ability-description-field' },
          h('div', { class: 'field-label-row' }, h('label', { for: description.id }, 'Description'), descriptionCount),
          description,
          h('p', { class: 'modal-hint', id: id('description-hint') }, 'Markup: **bold**, *italic*, lines starting with "- " or "1. " for lists, a blank line for a new paragraph.'),
          descriptionPreview,
        ),
        appliesTo,
        h(
          'section',
          { class: 'ability-section', 'aria-labelledby': id('when-title') },
          h('h3', { id: id('when-title') }, 'When'),
          needs,
          h('div', { class: 'ability-when-grid' }, weaponType, h('div', { class: 'field' }, h('label', { for: target.id }, 'Target'), target)),
          summary,
        ),
        h(
          'section',
          { class: 'ability-section', 'aria-labelledby': id('effects-title') },
          h('h3', { id: id('effects-title') }, 'Effects'),
          effectList,
          h('div', { class: 'panel-actions-group' }, addEffect),
        ),
        errors,
        h('p', { class: 'modal-hint' }, 'Switch on by hand what the page can’t know, like “the Oath target” or “after an Ingress move”: the ability then gets its own toggle on the main page. Hit and wound modifiers add up to at most +1 / -1.'),
        h('div', { class: 'modal-actions' }, cancel, save),
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        nameTouched = true;
        if (hasErrors(validate())) return;
        close({
          ...draft,
          name: draft.name.trim(),
          description: draft.description.trim(),
        });
      });
      // A new ability starts with one effect to fill in.
      if (!initial && draft.effects.length === 0) draft.effects.push(EFFECT_CHOICES[0].create());
      renderDescription();
      renderEffects();
      validate();
      return form;
    },
  });
}
