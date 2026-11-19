import type { WeaponProfile } from '../types';
import { AP_OPTIONS, SKILL_OPTIONS, field, h, numberValue, select, setFieldError, uid } from './dom';
import { validateWeapon } from './validation';

export function newWeapon(partial: Partial<WeaponProfile> = {}): WeaponProfile {
  return {
    id: uid('weapon'),
    name: 'Weapon',
    models: 1,
    attacks: '1',
    skill: 3,
    strength: 4,
    ap: 0,
    damage: '1',
    ...partial,
  };
}

/**
 * Editable, reorderable list of weapon profiles. Edits mutate `weapons` in place
 * and call `onChange`; add / remove / reorder re-render the list.
 */
export class WeaponList {
  private readonly list: HTMLOListElement;

  constructor(
    container: HTMLElement,
    private readonly weapons: WeaponProfile[],
    private readonly onChange: () => void,
  ) {
    this.list = h('ol', { class: 'weapon-list' });
    container.append(this.list);
    this.render();
  }

  add(): void {
    const n = this.weapons.length + 1;
    this.weapons.push(newWeapon({ name: `Weapon ${n}` }));
    this.render();
    this.list.querySelector<HTMLInputElement>('.weapon-row:last-child input')?.select();
    this.onChange();
  }

  /** Apply a new order given as indices into the current list. */
  reorder(order: number[]): void {
    const reordered = order.map((i) => this.weapons[i]);
    this.weapons.splice(0, this.weapons.length, ...reordered);
    this.render();
    this.onChange();
  }

  render(): void {
    this.list.replaceChildren(...this.weapons.map((w, i) => this.row(w, i)));
  }

  private move(index: number, delta: number, focusClass: string): void {
    const target = index + delta;
    if (target < 0 || target >= this.weapons.length) return;
    const [w] = this.weapons.splice(index, 1);
    this.weapons.splice(target, 0, w);
    this.render();
    const button = this.list.children[target]?.querySelector<HTMLButtonElement>(`.${focusClass}`);
    (button && !button.disabled ? button : this.list.children[target]?.querySelector<HTMLButtonElement>('button:not([disabled])'))?.focus();
    this.onChange();
  }

  private remove(index: number): void {
    this.weapons.splice(index, 1);
    this.render();
    const next = this.list.children[Math.min(index, this.weapons.length - 1)];
    next?.querySelector<HTMLInputElement>('input')?.focus();
    this.onChange();
  }

  private row(w: WeaponProfile, index: number): HTMLLIElement {
    const id = (name: string) => `${w.id}-${name}`;

    const name = h('input', { id: id('name'), type: 'text', value: w.name, autocomplete: 'off', maxlength: 40 });
    const models = h('input', { id: id('models'), type: 'number', inputmode: 'numeric', min: 1, max: 50, value: w.models });
    const attacks = h('input', { id: id('attacks'), type: 'text', value: w.attacks, autocomplete: 'off', spellcheck: 'false', class: 'dice' });
    const skill = select({ id: id('skill') }, SKILL_OPTIONS, w.skill);
    const strength = h('input', { id: id('strength'), type: 'number', inputmode: 'numeric', min: 1, max: 30, value: w.strength });
    const ap = select({ id: id('ap') }, AP_OPTIONS, w.ap);
    const damage = h('input', { id: id('damage'), type: 'text', value: w.damage, autocomplete: 'off', spellcheck: 'false', class: 'dice' });

    const errors = h('p', { class: 'row-errors', id: id('errors'), 'aria-live': 'polite' });
    const controls = { models, attacks, skill, strength, ap, damage };

    const validate = () => {
      const result = validateWeapon(w);
      for (const [key, control] of Object.entries(controls)) {
        const message = result[key as keyof WeaponProfile];
        setFieldError(control, message);
        if (message) control.setAttribute('aria-describedby', errors.id);
        else control.removeAttribute('aria-describedby');
      }
      errors.textContent = Object.values(result).join(' · ');
    };

    const bind = (control: HTMLInputElement | HTMLSelectElement, apply: () => void) => {
      control.addEventListener('input', () => {
        apply();
        validate();
        this.onChange();
      });
    };
    bind(name, () => (w.name = name.value));
    bind(models, () => (w.models = numberValue(models)));
    bind(attacks, () => (w.attacks = attacks.value));
    bind(skill, () => (w.skill = numberValue(skill)));
    bind(strength, () => (w.strength = numberValue(strength)));
    bind(ap, () => (w.ap = numberValue(ap)));
    bind(damage, () => (w.damage = damage.value));

    const label = w.name || `weapon ${index + 1}`;
    const up = h('button', { type: 'button', class: 'icon-button move-up', 'aria-label': `Move ${label} up`, title: 'Move up', disabled: index === 0 }, '↑');
    const down = h(
      'button',
      { type: 'button', class: 'icon-button move-down', 'aria-label': `Move ${label} down`, title: 'Move down', disabled: index === this.weapons.length - 1 },
      '↓',
    );
    const remove = h(
      'button',
      { type: 'button', class: 'icon-button remove', 'aria-label': `Remove ${label}`, title: 'Remove', disabled: this.weapons.length === 1 },
      '✕',
    );
    up.addEventListener('click', () => this.move(index, -1, 'move-up'));
    down.addEventListener('click', () => this.move(index, 1, 'move-down'));
    remove.addEventListener('click', () => this.remove(index));

    const li = h(
      'li',
      { class: 'weapon-row' },
      h('span', { class: 'row-index', 'aria-hidden': 'true' }, String(index + 1)),
      field('Name', name, 'field--name'),
      field('Models', models),
      field('A', attacks),
      field('BS/WS', skill),
      field('S', strength),
      field('AP', ap),
      field('D', damage),
      h('div', { class: 'row-actions' }, up, down, remove),
      errors,
    );
    validate();
    return li;
  }
}
