import { formatDiceSum, tryParseDice } from '../engine/dice';
import { bonusAttacks, bonusDamage } from '../engine/rules';
import { activeAbilities, normaliseDice } from '../state/abilities';
import { KEYWORD_NAMES, type AttackConditions, type DefenderProfile, type WeaponStats } from '../types';
import { h } from './dom';

/** What the stat chips need to know about the defender: its size (Blast / Cleave) and keywords (Anti). */
export type ChipDefender = Pick<DefenderProfile, 'models' | 'keywords'>;

export const CHIP_LABELS: { key: Exclude<keyof WeaponStats, 'abilities'>; label: string; title: string; format?: (w: WeaponStats) => string }[] = [
  { key: 'attacks', label: 'A', title: 'Attacks' },
  { key: 'skill', label: 'BS', title: 'Ballistic / Weapon Skill', format: (w) => `${w.skill}+` },
  { key: 'strength', label: 'S', title: 'Strength' },
  { key: 'ap', label: 'AP', title: 'Armour penetration' },
  { key: 'damage', label: 'D', title: 'Damage' },
];

/** Why an attack condition makes an ability active, for its tooltip. */
export const CONDITION_REASONS: Record<keyof AttackConditions, string> = {
  halfRange: 'the target is within half range',
  charged: 'the bearer charged this turn',
};

/**
 * Read-only stats of a weapon as chips (`A 2`, `BS 3+`, …) plus its abilities as text, for the
 * rows on the main page. Blast / Cleave / Rapid Fire extra attacks show on
 * the A chip and Melta extra damage on the D chip; abilities that apply to the defender's
 * keywords or the current conditions are outlined.
 */
export function statChips(weapon: WeaponStats | undefined, defender: ChipDefender | undefined, conditions: AttackConditions): HTMLElement[] {
  if (!weapon) return [h('span', { class: 'chips-empty' }, 'No weapon chosen')];
  const chips = CHIP_LABELS.map(({ key, label, title, format }) =>
    h('span', { class: 'chip', title }, h('span', { class: 'chip-label' }, label), ' ', format ? format(weapon) : String(weapon[key])),
  );
  const bonus = attacksBonus(weapon, defender?.models, conditions);
  if (bonus) {
    // The A chip comes first: "A 4+2" or "A D6+2D6+4", with the Blast / Cleave / Rapid Fire extra attacks in blue.
    chips[0].append(h('span', { class: 'chip-bonus' }, `+${bonus.value}`));
    chips[0].title = `Attacks: ${weapon.attacks}, plus ${bonus.value} from ${bonus.sources}`;
  }
  const extraDamage = damageBonus(weapon, conditions);
  if (extraDamage) {
    // The D chip comes last: "D D6+2", with the Melta extra damage in blue.
    const chip = chips[chips.length - 1];
    chip.append(h('span', { class: 'chip-bonus' }, `+${extraDamage.value}`));
    chip.title = `Damage: ${weapon.damage}, plus ${extraDamage.value} from ${extraDamage.sources}`;
  }
  const abilities = activeAbilities(weapon.abilities);
  if (abilities.length === 0) return chips;
  // Read-only; abilities are edited in the weapon profile modal (Weapons tab), and rows keep their copy.
  const text = h('span', { class: 'row-abilities' }, h('span', { class: 'visually-hidden' }, 'Abilities: '));
  abilities.forEach(({ label, description, anti, condition }, i) => {
    if (i > 0) text.append(', ');
    // An Anti ability is outlined when the current defender has one of its keywords, a
    // conditional ability (Rapid Fire, Melta, Lance) while its attack condition is on.
    let active: string | null = null;
    const matched = anti && defender ? anti.keywords.filter((k) => defender.keywords.includes(k)) : [];
    if (matched.length > 0) {
      const names = matched.map((k) => KEYWORD_NAMES[k]).join(' and ');
      active = `Active: the target has the ${names} keyword${matched.length === 1 ? '' : 's'}.`;
    } else if (condition && conditions[condition]) {
      active = `Active: ${CONDITION_REASONS[condition]}.`;
    }
    if (active === null) {
      text.append(h('span', { title: description }, label));
      return;
    }
    text.append(h('span', { class: 'ability-active', title: `${description} ${active}` }, label, h('span', { class: 'visually-hidden' }, ' (active)')));
  });
  return [...chips, text];
}

/**
 * Blast / Cleave / Rapid Fire extra attacks per model against the current defender and
 * under the current conditions ("2D6+4"), with their sources for the tooltip, or null when
 * there are none or an X is invalid (the row shows that error instead).
 */
export function attacksBonus(weapon: WeaponStats, defenderModels: number | undefined, conditions: AttackConditions): { value: string; sources: string } | null {
  const { blast, cleave, rapidFire } = weapon.abilities;
  if ([blast, cleave, rapidFire].some((x) => x !== null && !tryParseDice(x))) return null;
  // Without a valid model count Blast / Cleave add nothing here; Rapid Fire still can.
  const models = defenderModels !== undefined && Number.isInteger(defenderModels) && defenderModels >= 1 ? defenderModels : 0;
  const terms = bonusAttacks({ abilities: weapon.abilities, conditions }, { models });
  if (terms.length === 0) return null;
  const perFive = models >= 5 ? [blast === null ? '' : `Blast ${normaliseDice(blast)}`, cleave === null ? '' : `Cleave ${normaliseDice(cleave)}`].filter(Boolean) : [];
  const sources: string[] = [];
  if (perFive.length > 0) sources.push(`${perFive.join(' and ')} (${models} models in the target unit)`);
  if (rapidFire !== null && conditions.halfRange) sources.push(`Rapid Fire ${normaliseDice(rapidFire)} (within half range)`);
  return { value: formatDiceSum(terms), sources: sources.join(' and ') };
}

/**
 * Melta extra damage per unsaved wound under the current conditions ("D3"), with its source
 * for the tooltip, or null when there is none or X is invalid (the row shows that error instead).
 */
export function damageBonus(weapon: WeaponStats, conditions: AttackConditions): { value: string; sources: string } | null {
  const { melta } = weapon.abilities;
  if (melta === null || !tryParseDice(melta)) return null;
  const terms = bonusDamage({ abilities: weapon.abilities, conditions });
  if (terms.length === 0) return null;
  return { value: formatDiceSum(terms), sources: `Melta ${normaliseDice(melta)} (within half range)` };
}
