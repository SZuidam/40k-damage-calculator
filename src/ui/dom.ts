type Attrs = Record<string, string | number | boolean | undefined>;

/** Tiny element builder: h('div', { class: 'x' }, child, 'text'). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value === undefined || value === false) continue;
    el.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child);
  }
  return el;
}

export function numberValue(input: HTMLInputElement | HTMLSelectElement): number {
  return input.value.trim() === '' ? Number.NaN : Number(input.value);
}

export interface Option {
  value: string | number;
  label: string;
}

export function select(attrs: Attrs, options: Option[], selected: string | number): HTMLSelectElement {
  const el = h('select', attrs);
  for (const option of options) {
    const opt = h('option', { value: option.value }, option.label);
    if (String(option.value) === String(selected)) opt.selected = true;
    el.append(opt);
  }
  return el;
}

/** Labelled form field with an id-linked error slot. */
export function field(label: string, control: HTMLInputElement | HTMLSelectElement, className = ''): HTMLDivElement {
  return h('div', { class: `field ${className}`.trim() }, h('label', { for: control.id }, label), control);
}

export function setFieldError(control: HTMLInputElement | HTMLSelectElement, message: string | undefined): void {
  if (message) {
    control.setAttribute('aria-invalid', 'true');
    control.title = message;
  } else {
    control.removeAttribute('aria-invalid');
    control.removeAttribute('title');
  }
}

let counter = 0;
export function uid(prefix = 'id'): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export const SKILL_OPTIONS: Option[] = [2, 3, 4, 5, 6].map((v) => ({ value: v, label: `${v}+` }));
export const AP_OPTIONS: Option[] = [0, -1, -2, -3, -4, -5, -6].map((v) => ({ value: v, label: v === 0 ? '0' : String(v) }));
