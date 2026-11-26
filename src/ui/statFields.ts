import { DEFENDER_KEYWORDS, KEYWORD_NAMES, type DefenderKeyword } from '../types';
import { h, type Option } from './dom';

/** Armour save: 2+ to 6+, or None (stored as 7). */
export const SAVE_OPTIONS: Option[] = [
  ...[2, 3, 4, 5, 6].map((v) => ({ value: v, label: `${v}+` })),
  { value: 7, label: 'None' },
];

/** Invulnerable save: None (stored as null, the option value '') or 2++ to 6++. */
export const INVULN_OPTIONS: Option[] = [{ value: '', label: 'None' }, ...[2, 3, 4, 5, 6].map((v) => ({ value: v, label: `${v}++` }))];

export interface KeywordToggles {
  element: HTMLFieldSetElement;
  /** Check exactly the toggles of `keywords` (after loading other values). */
  setValues(keywords: readonly DefenderKeyword[]): void;
}

/**
 * The "Keywords" group: one pill-shaped checkbox per keyword, ids `<idPrefix>-<keyword>`.
 * `onChange` gets the checked keywords in DEFENDER_KEYWORDS order.
 */
export function keywordToggles(idPrefix: string, keywords: readonly DefenderKeyword[], onChange: (keywords: DefenderKeyword[]) => void): KeywordToggles {
  const boxes = DEFENDER_KEYWORDS.map((keyword) => {
    const box = h('input', { id: `${idPrefix}-${keyword}`, type: 'checkbox', class: 'toggle-input', checked: keywords.includes(keyword) });
    box.addEventListener('change', () => onChange(DEFENDER_KEYWORDS.filter((_, i) => boxes[i].checked)));
    return box;
  });
  const element = h(
    'fieldset',
    { class: 'toggle-group' },
    h('legend', {}, 'Keywords'),
    h(
      'div',
      { class: 'toggle-pills' },
      ...DEFENDER_KEYWORDS.map((keyword, i) => h('label', { class: 'toggle-pill' }, boxes[i], h('span', {}, KEYWORD_NAMES[keyword]))),
    ),
  );
  return {
    element,
    setValues(next) {
      boxes.forEach((box, i) => (box.checked = next.includes(DEFENDER_KEYWORDS[i])));
    },
  };
}
