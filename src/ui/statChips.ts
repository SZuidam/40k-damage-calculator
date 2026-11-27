import { formatDiceSum, tryParseDice, type DiceExpr } from '../engine/dice';
import { bonusAttacks, bonusDamage, hitModifier, woundModifier } from '../engine/rules';
import { activeAbilities, normaliseDice } from '../state/abilities';
import { pickStats, skillValue } from '../state/presets';
import { apAmount, applyAbilities, effectSummary, statAmount, type SourcedAbility } from '../state/unitAbilities';
import { KEYWORD_NAMES, MONSTER_VEHICLE, noModifiers, type AbilityEffect, type AttackConditions, type DamageRerollThresholds, type DefenderProfile, type WeaponProfile, type WeaponStats } from '../types';
import { h } from './dom';

/** What the stat chips need to know about the defender: its size (Blast / Cleave) and keywords (Anti). */
export type ChipDefender = Pick<DefenderProfile, 'models' | 'keywords'>;

export const CHIP_LABELS: { key: Exclude<keyof WeaponStats, 'abilities' | 'type'>; label: string; title: string; format?: (w: WeaponStats) => string }[] = [
  { key: 'attacks', label: 'A', title: 'Attacks' },
  { key: 'skill', label: 'BS', title: 'Ballistic / Weapon Skill', format: skillValue },
  { key: 'strength', label: 'S', title: 'Strength' },
  { key: 'ap', label: 'AP', title: 'Armour penetration' },
  { key: 'damage', label: 'D', title: 'Damage' },
];

/** Why an attack condition makes an ability active, for its tooltip. */
export const CONDITION_REASONS: Record<keyof AttackConditions, string> = {
  halfRange: 'the target is within half range',
  charged: 'the bearer charged this turn',
};

/** "Shock Assault and Oath": the names of the applied abilities with an effect matching `pred`. */
function sourcesOf(applied: readonly SourcedAbility[], pred: (e: AbilityEffect) => boolean): string {
  const names = applied.filter((a) => a.ability.effects.some(pred)).map((a) => a.ability.name);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** A constant +X as a dice term, so it can be summed with Blast / Melta terms. */
const constant = (x: number): DiceExpr => ({ count: 0, sides: 0, bonus: x });

/**
 * Read-only stats of a weapon as chips (`A 2`, `BS 3+`, …) plus its abilities as text, for the
 * rows on the main page. `applied` are the unit, leader and army abilities active for this weapon:
 * their +X shows on the A / S / D chips in blue (with Blast / Cleave / Rapid Fire extra attacks on
 * A and Melta on D), an improved AP in blue, a hit modifier on the BS chip, and their roll levers
 * and granted weapon abilities as dashed entries in the ability text. Weapon abilities that apply
 * to the defender's keywords or the current conditions are outlined. A Torrent weapon (its own or
 * granted) reads "BS N/A". An ability limited to non-Monster / non-Vehicle targets is struck
 * through while the defender is a Monster or Vehicle. `damageRerolls` are the Settings thresholds
 * for "Re-roll damage".
 */
export function statChips(
  weapon: WeaponStats | undefined,
  defender: ChipDefender | undefined,
  conditions: AttackConditions,
  applied: readonly SourcedAbility[] = [],
  damageRerolls?: DamageRerollThresholds,
): HTMLElement[] {
  if (!weapon) return [h('span', { class: 'chips-empty' }, 'No weapon chosen')];
  const effects = applied.flatMap((a) => a.ability.effects);
  const base: WeaponProfile = { ...pickStats(weapon), id: '', models: 1, conditions, modifiers: noModifiers() };
  const abilities = applied.map((a) => a.ability);
  // `resolved` is what the engine gets against the current defender; `listed` keeps the abilities
  // limited to non-Monster / non-Vehicle targets, so the row can show them as inactive.
  const resolved = applyAbilities(base, abilities, damageRerolls, defender?.keywords ?? null);
  const listed = applyAbilities(base, abilities, damageRerolls);
  const melee = weapon.type === 'melee';
  const chips = CHIP_LABELS.map(({ key, label, title, format }) =>
    h('span', { class: 'chip', title }, h('span', { class: 'chip-label' }, key === 'skill' && melee ? 'WS' : label), ' ', format ? format(weapon) : String(weapon[key])),
  );
  const [aChip, skillChip, sChip, apChip, dChip] = chips;
  // A small tag in front of the chips of a melee weapon (ranged is the default and gets none).
  const tag = melee ? [h('span', { class: 'chip chip-tag', title: 'Melee weapon' }, 'Melee')] : [];

  // A: "A 3+1" or "A D6+2D6+4": +X from abilities plus Blast / Cleave / Rapid Fire, in blue.
  const extraAttacks = statAmount(effects, 'attacks');
  const bonus = attacksBonus({ ...weapon, abilities: resolved.abilities }, defender?.models, conditions);
  if (extraAttacks > 0 || bonus) {
    const value = formatDiceSum([...(extraAttacks > 0 ? [constant(extraAttacks)] : []), ...(bonus?.terms ?? [])]);
    const sources = [extraAttacks > 0 ? `${extraAttacks} from ${sourcesOf(applied, (e) => e.kind === 'stat' && e.stat === 'attacks')}` : '', bonus ? `${bonus.value} from ${bonus.sources}` : ''].filter(Boolean);
    aChip.append(h('span', { class: 'chip-bonus' }, `+${value}`));
    aChip.title = `Attacks: ${weapon.attacks}, plus ${sources.join(' and ')}`;
  }

  // BS / WS: "BS N/A" with Torrent (it never rolls to hit, so hit modifiers don't matter), else
  // "BS 3+ (+1)" while a hit modifier applies (capped at -1 / +1, as in the engine).
  const toHit = hitModifier(resolved);
  if (resolved.abilities.torrent) {
    skillChip.replaceChildren(h('span', { class: 'chip-label' }, melee ? 'WS' : 'BS'), ' ', weapon.abilities.torrent ? 'N/A' : h('span', { class: 'chip-bonus' }, 'N/A'));
    skillChip.title = `Torrent${weapon.abilities.torrent ? '' : ` (gained from ${sourcesOf(applied, (e) => e.kind === 'grant' && e.abilities.torrent)})`}: every attack hits automatically, without a hit roll.`;
  } else if (toHit !== 0) {
    const text = `${toHit > 0 ? '+' : ''}${toHit}`;
    skillChip.append(h('span', { class: 'chip-bonus' }, ` (${text})`));
    skillChip.title = `${melee ? 'Weapon' : 'Ballistic'} Skill ${weapon.skill}+, ${text} to hit from ${sourcesOf(applied, (e) => e.kind === 'roll' && e.roll === 'hit')}`;
  }

  // S: "S 4+1".
  const extraStrength = statAmount(effects, 'strength');
  if (extraStrength > 0) {
    sChip.append(h('span', { class: 'chip-bonus' }, `+${extraStrength}`));
    sChip.title = `Strength: ${weapon.strength}, plus ${extraStrength} from ${sourcesOf(applied, (e) => e.kind === 'stat' && e.stat === 'strength')}`;
  }

  // AP: the improved value in blue, "AP -2".
  if (apAmount(effects) > 0 && resolved.ap !== weapon.ap) {
    apChip.replaceChildren(h('span', { class: 'chip-label' }, 'AP'), ' ', h('span', { class: 'chip-bonus' }, String(resolved.ap)));
    apChip.title = `Armour penetration: ${weapon.ap}, improved to ${resolved.ap} by ${sourcesOf(applied, (e) => e.kind === 'ap')}`;
  }

  // D: "D D6+1+D3": +X from abilities plus Melta, in blue.
  const extraDamage = statAmount(effects, 'damage');
  const melta = damageBonus({ ...weapon, abilities: resolved.abilities }, conditions);
  if (extraDamage > 0 || melta) {
    const value = formatDiceSum([...(extraDamage > 0 ? [constant(extraDamage)] : []), ...(melta?.terms ?? [])]);
    const sources = [extraDamage > 0 ? `${extraDamage} from ${sourcesOf(applied, (e) => e.kind === 'stat' && e.stat === 'damage')}` : '', melta ? `${melta.value} from ${melta.sources}` : ''].filter(Boolean);
    dChip.append(h('span', { class: 'chip-bonus' }, `+${value}`));
    dChip.title = `Damage: ${weapon.damage}, plus ${sources.join(' and ')}`;
  }

  const text = abilityText(weapon, listed, resolved, defender, conditions, applied);
  return text ? [...tag, ...chips, text] : [...tag, ...chips];
}

/**
 * The ability text of a row: the weapon's abilities (with any granted by unit abilities, dashed)
 * and the roll levers of unit abilities (dashed), or null when there are none. `listed` holds
 * every ability, `resolved` only those that apply against the defender: a limited ability
 * missing from it is struck through, and a granted one that took its place is added after.
 */
function abilityText(
  weapon: WeaponStats,
  listed: WeaponProfile,
  resolved: WeaponProfile,
  defender: ChipDefender | undefined,
  conditions: AttackConditions,
  applied: readonly SourcedAbility[],
): HTMLElement | null {
  const own = new Set(activeAbilities(weapon.abilities).map((a) => a.label));
  const shown = activeAbilities(listed.abilities);
  const shownLabels = new Set(shown.map((a) => a.label));
  const abilities = [...shown, ...activeAbilities(resolved.abilities).filter((a) => !shownLabels.has(a.label))];
  const blocked = defender ? defender.keywords.filter((k) => MONSTER_VEHICLE.includes(k)) : [];
  const levers = rollLevers(resolved, weapon, applied);
  if (abilities.length === 0 && levers.length === 0) return null;
  // Read-only; abilities are edited in the weapon profile modal and the unit's abilities (Units tab).
  const text = h('span', { class: 'row-abilities' }, h('span', { class: 'visually-hidden' }, 'Abilities: '));
  const items: HTMLElement[] = [];
  for (const { label, description, anti, condition, limited } of abilities) {
    const granted = !own.has(label);
    const from = granted ? ` Gained from ${sourcesOf(applied, (e) => e.kind === 'grant')}.` : '';
    // Limited to non-Monster / non-Vehicle targets and the defender is one: struck through.
    if (limited && blocked.length > 0) {
      const names = blocked.map((k) => KEYWORD_NAMES[k]).join(' and ');
      const classes = ['ability-inactive', granted ? 'ability-granted' : ''].filter(Boolean).join(' ');
      const title = `${description}${from} Inactive: the target has the ${names} keyword${blocked.length === 1 ? '' : 's'}.`;
      items.push(h('span', { class: classes, title }, label, h('span', { class: 'visually-hidden' }, ' (inactive)')));
      continue;
    }
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
    const classes = [granted ? 'ability-granted' : '', active !== null ? 'ability-active' : ''].filter(Boolean).join(' ');
    const title = `${description}${from}${active === null ? '' : ` ${active}`}`;
    items.push(h('span', { class: classes || undefined, title }, label, active !== null ? h('span', { class: 'visually-hidden' }, ' (active)') : null));
  }
  for (const lever of levers) items.push(h('span', { class: 'ability-granted', title: lever.title }, lever.label));
  items.forEach((item, i) => {
    if (i > 0) text.append(', ');
    text.append(item);
  });
  return text;
}

/** Roll levers of the applied abilities: "+1 to wound", "Critical hits on 5+", "Re-roll hits of 1". */
function rollLevers(resolved: WeaponProfile, weapon: WeaponStats, applied: readonly SourcedAbility[]): { label: string; title: string }[] {
  const m = resolved.modifiers;
  const out: { label: string; title: string }[] = [];
  const from = (pred: (e: AbilityEffect) => boolean) => `From ${sourcesOf(applied, pred)}.`;
  // The wound modifier as the engine sums it, with Lance; shown only when an ability adds to it.
  if (m.wound !== 0) {
    const total = woundModifier(resolved);
    out.push({ label: `${total >= 0 ? '+' : ''}${total} to wound`, title: `${from((e) => e.kind === 'roll' && e.roll === 'wound')} Wound roll modifiers add up to at most +1 / -1.` });
  }
  if (m.criticalHit < 6) out.push({ label: effectSummary({ kind: 'critical', roll: 'hit', on: m.criticalHit }), title: from((e) => e.kind === 'critical' && e.roll === 'hit') });
  if (m.criticalWound < 6) out.push({ label: effectSummary({ kind: 'critical', roll: 'wound', on: m.criticalWound }), title: from((e) => e.kind === 'critical' && e.roll === 'wound') });
  if (m.rerollHits !== 'none') out.push({ label: effectSummary({ kind: 'reroll', roll: 'hit', which: m.rerollHits }), title: from((e) => e.kind === 'reroll' && e.roll === 'hit') });
  // Twin-linked already re-rolls failed wounds; only show what abilities add on top.
  if (m.rerollWounds !== 'none' && !weapon.abilities.twinLinked) {
    out.push({ label: effectSummary({ kind: 'reroll', roll: 'wound', which: m.rerollWounds }), title: from((e) => e.kind === 'reroll' && e.roll === 'wound') });
  }
  // Re-roll damage: the threshold comes from the Settings, by the dice of D (none for fixed damage).
  const rerollsDamage = (e: AbilityEffect) => e.kind === 'rerollDamage';
  if (applied.some((a) => a.ability.effects.some(rerollsDamage))) {
    const title = m.rerollDamageBelow > 0
      ? `${from(rerollsDamage)} A D ${resolved.damage} damage roll whose dice show less than ${m.rerollDamageBelow} is re-rolled once (set under ☰ → Settings).`
      : `${from(rerollsDamage)} D ${resolved.damage} is fixed, so there is nothing to re-roll.`;
    out.push({ label: m.rerollDamageBelow > 0 ? `Re-roll damage below ${m.rerollDamageBelow}` : 'Re-roll damage (fixed D)', title });
  }
  return out;
}

/**
 * Blast / Cleave / Rapid Fire extra attacks per model against the current defender and
 * under the current conditions ("2D6+4"), with their sources for the tooltip, or null when
 * there are none or an X is invalid (the row shows that error instead).
 */
export function attacksBonus(weapon: WeaponStats, defenderModels: number | undefined, conditions: AttackConditions): { value: string; sources: string; terms: DiceExpr[] } | null {
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
  return { value: formatDiceSum(terms), sources: sources.join(' and '), terms };
}

/**
 * Melta extra damage per unsaved wound under the current conditions ("D3"), with its source
 * for the tooltip, or null when there is none or X is invalid (the row shows that error instead).
 */
export function damageBonus(weapon: WeaponStats, conditions: AttackConditions): { value: string; sources: string; terms: DiceExpr[] } | null {
  const { melta } = weapon.abilities;
  if (melta === null || !tryParseDice(melta)) return null;
  const terms = bonusDamage({ abilities: weapon.abilities, conditions });
  if (terms.length === 0) return null;
  return { value: formatDiceSum(terms), sources: `Melta ${normaliseDice(melta)} (within half range)`, terms };
}
