import { MAX_CONSTANT, formatDiceSum, tryParseDice } from '../engine/dice';
import { strongerReroll } from '../engine/rules';
import {
  DEFENDER_KEYWORDS,
  KEYWORD_NAMES,
  WEAPON_TYPE_NAMES,
  copyAbilities,
  noAbilities,
  type AbilityCondition,
  type AbilityEffect,
  type AbilityEffectKind,
  type Army,
  type AttackConditions,
  type DefenderKeyword,
  type SituationRef,
  type Unit,
  type UnitAbility,
  type WeaponAbilities,
  type WeaponProfile,
  type WeaponType,
} from '../types';
import { abilitiesSummary, normaliseDice, sameAbilities } from './abilities';
import { uid } from './ids';

/** Where an ability that applies to the attack comes from. */
export type AbilityOrigin = 'unit' | 'leader' | 'army';

/** An ability that can apply to the attack, with the unit or army it comes from (for the UI). */
export interface SourcedAbility {
  ability: UnitAbility;
  origin: AbilityOrigin;
  /** The name of the unit, leader or army that has it. */
  from: string;
}

/** What decides whether an ability is active, besides the weapon: the page's toggles and the target. */
export interface AbilityContext {
  conditions: AttackConditions;
  /** The custom situations that are on, as `situationKey`s. */
  situations: readonly string[];
  /** The defending unit's keywords; null while no defender is picked (keyword conditions fail). */
  keywords: readonly DefenderKeyword[] | null;
}

/** The built-in conditions an ability can need, with their short names. */
export const BUILTIN_SITUATIONS: { key: keyof AttackConditions; name: string; toggle: string }[] = [
  { key: 'halfRange', name: 'Half range', toggle: 'Within half range' },
  { key: 'charged', name: 'Charged', toggle: 'Charged this turn' },
];

/** A custom situation's identity: its name trimmed and lower-cased ("Oath target" = " oath TARGET "). */
export function situationKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * What the user typed as a condition: a built-in one when `text` names it ("Charged", "Charged
 * this turn", ignoring case), else a custom situation with the trimmed text as its name.
 */
export function situationFromText(text: string): SituationRef {
  const key = situationKey(text);
  const builtin = BUILTIN_SITUATIONS.find((b) => situationKey(b.name) === key || situationKey(b.toggle) === key);
  return builtin ? { builtin: builtin.key } : { name: text.trim() };
}

/** "Charged" / "Ingress move": how a condition reads in summaries and on the main page. */
export function situationName(ref: SituationRef): string {
  return 'builtin' in ref ? (BUILTIN_SITUATIONS.find((b) => b.key === ref.builtin)?.name ?? ref.builtin) : ref.name.trim();
}

/** Whether `ref` is switched on by the page's toggles. */
export function situationOn(ref: SituationRef, conditions: AttackConditions, situations: readonly string[]): boolean {
  return 'builtin' in ref ? conditions[ref.builtin] === true : situations.includes(situationKey(ref.name));
}

export function sameSituation(a: SituationRef, b: SituationRef): boolean {
  if ('builtin' in a || 'builtin' in b) return 'builtin' in a && 'builtin' in b && a.builtin === b.builtin;
  return situationKey(a.name) === situationKey(b.name);
}

export function newAbility(): UnitAbility {
  return { id: uid('ability'), name: '', description: '', appliesTo: 'unit', when: { situations: [], weaponType: 'any', targetKeyword: null }, effects: [] };
}

/** A copy that shares no arrays or objects with `a`. */
export function copyAbility(a: UnitAbility): UnitAbility {
  return { id: a.id, ...abilityContent(a) };
}

/** The ability without its id, sharing no arrays or objects with `a`. */
export function abilityContent(a: AbilityContent): AbilityContent {
  return {
    name: a.name,
    description: a.description,
    appliesTo: a.appliesTo,
    when: { situations: a.when.situations.map((s) => ({ ...s })), weaponType: a.when.weaponType, targetKeyword: a.when.targetKeyword },
    effects: a.effects.map(copyEffect),
  };
}

export function copyEffect(e: AbilityEffect): AbilityEffect {
  return e.kind === 'grant' ? { kind: 'grant', abilities: copyAbilities(e.abilities) } : { ...e };
}

function sameEffect(a: AbilityEffect, b: AbilityEffect): boolean {
  if (a.kind === 'grant' || b.kind === 'grant') return a.kind === 'grant' && b.kind === 'grant' && sameAbilities(a.abilities, b.abilities);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...keys].every((k) => (a as Record<string, unknown>)[k] === (b as Record<string, unknown>)[k]);
}

/** An ability without its id, as in an export file. */
export type AbilityContent = Omit<UnitAbility, 'id'>;

/** Same name, description, target, condition and effects (in order); ids don't count. */
export function sameAbilityContent(a: AbilityContent, b: AbilityContent): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.appliesTo === b.appliesTo &&
    a.when.weaponType === b.when.weaponType &&
    a.when.targetKeyword === b.when.targetKeyword &&
    a.when.situations.length === b.when.situations.length &&
    a.when.situations.every((s, i) => sameSituation(s, b.when.situations[i])) &&
    a.effects.length === b.effects.length &&
    a.effects.every((e, i) => sameEffect(e, b.effects[i]))
  );
}

/** Whether two lists hold the same abilities in the same order (ids included when `withIds`). */
export function sameAbilityList(a: readonly UnitAbility[], b: readonly UnitAbility[], withIds = true): boolean {
  return a.length === b.length && a.every((x, i) => (!withIds || x.id === b[i].id) && sameAbilityContent(x, b[i]));
}

// ---------- which abilities apply ----------

/**
 * Every ability that can apply to `attacker`'s attacks: its own abilities for itself, the
 * leader's abilities for the unit it leads, and the rules of the attacker's army.
 */
export function abilitiesFor(attacker: Unit, leader: Unit | null | undefined, army: Army | null | undefined): SourcedAbility[] {
  return [
    ...attacker.abilities.filter((a) => a.appliesTo === 'unit').map((ability) => ({ ability, origin: 'unit' as const, from: attacker.name })),
    ...(leader ? leader.abilities.filter((a) => a.appliesTo === 'ledUnit').map((ability) => ({ ability, origin: 'leader' as const, from: leader.name })) : []),
    ...(army ? army.abilities.map((ability) => ({ ability, origin: 'army' as const, from: army.name })) : []),
  ];
}

/** Whether `unit` can lead: it has at least one ability for the unit it leads. */
export function canLead(unit: Unit): boolean {
  return unit.abilities.some((a) => a.appliesTo === 'ledUnit');
}

/** What an ability still needs to apply to a weapon (empty when it applies). */
export interface AbilityNeeds {
  /** Situations that are off. */
  situations: SituationRef[];
  /** The weapon is of the other type. */
  weaponType: boolean;
  /** The target lacks the keyword (or no target is picked). */
  targetKeyword: boolean;
}

/** What `condition` still needs for a weapon of `type` (any type when `type` is null). */
export function conditionNeeds(condition: AbilityCondition, type: WeaponType | null, ctx: AbilityContext): AbilityNeeds {
  return {
    situations: condition.situations.filter((s) => !situationOn(s, ctx.conditions, ctx.situations)),
    weaponType: type !== null && condition.weaponType !== 'any' && condition.weaponType !== type,
    targetKeyword: condition.targetKeyword !== null && !(ctx.keywords ?? []).includes(condition.targetKeyword),
  };
}

/** Whether `ability` applies to the attacks of a weapon of `type`. */
export function isActive(ability: UnitAbility, type: WeaponType, ctx: AbilityContext): boolean {
  const needs = conditionNeeds(ability.when, type, ctx);
  return needs.situations.length === 0 && !needs.weaponType && !needs.targetKeyword;
}

/** The abilities of `abilities` that apply to a weapon of `type`, in order. */
export function activeFor<T extends { ability: UnitAbility }>(abilities: readonly T[], type: WeaponType, ctx: AbilityContext): T[] {
  return abilities.filter((a) => isActive(a.ability, type, ctx));
}

/** The custom situation names `abilities` need, without duplicates (ignoring case), first spelling kept, in order. */
export function situationsInUse(abilities: readonly UnitAbility[]): string[] {
  const names = new Map<string, string>();
  for (const ability of abilities) {
    for (const ref of ability.when.situations) {
      if ('builtin' in ref) continue;
      const key = situationKey(ref.name);
      if (key !== '' && !names.has(key)) names.set(key, ref.name.trim());
    }
  }
  return [...names.values()];
}

// ---------- applying effects ----------

/** `expr` + `amount`, folded into its constant: "2" + 1 → "3", "D6" + 1 → "D6+1". Invalid dice stay as they are. */
export function addToDice(expr: string, amount: number): string {
  const parsed = tryParseDice(expr);
  if (!parsed || amount === 0) return expr;
  return formatDiceSum([{ ...parsed, bonus: Math.min(MAX_CONSTANT, Math.max(0, parsed.bonus + amount)) }]);
}

/** The total +X of one stat over `effects`. */
export function statAmount(effects: readonly AbilityEffect[], stat: 'attacks' | 'strength' | 'damage'): number {
  return effects.reduce((sum, e) => sum + (e.kind === 'stat' && e.stat === stat ? amountOf(e.amount) : 0), 0);
}

/** The total AP improvement over `effects`. */
export function apAmount(effects: readonly AbilityEffect[]): number {
  return effects.reduce((sum, e) => sum + (e.kind === 'ap' ? amountOf(e.amount) : 0), 0);
}

/** A usable +X: a whole number from 0 up (out-of-range values are flagged by validation, not applied). */
const amountOf = (x: number) => (Number.isInteger(x) && x > 0 && x <= 6 ? x : 0);

/**
 * The weapon abilities `granted` adds to `base`: on / off abilities are switched on, an X
 * ability (Sustained Hits, Blast, …) is taken only when the weapon has none, and Anti-X Y+
 * keeps the lower Y per keyword.
 */
export function grantAbilities(base: WeaponAbilities, granted: WeaponAbilities): WeaponAbilities {
  const out = copyAbilities(base);
  out.lethalHits ||= granted.lethalHits;
  out.devastatingWounds ||= granted.devastatingWounds;
  out.lance ||= granted.lance;
  out.twinLinked ||= granted.twinLinked;
  for (const key of ['sustainedHits', 'blast', 'cleave', 'rapidFire', 'melta'] as const) {
    if (out[key] === null && granted[key] !== null && tryParseDice(granted[key])) out[key] = normaliseDice(granted[key]);
  }
  for (const keyword of DEFENDER_KEYWORDS) {
    const y = granted.anti[keyword];
    if (y === undefined || !Number.isInteger(y) || y < 2 || y > 6) continue;
    const own = out.anti[keyword];
    if (own === undefined || y < own) out.anti[keyword] = y;
  }
  return out;
}

/**
 * `profile` with the effects of `abilities` folded in (they are assumed active; see activeFor).
 * A / D get +X added to their dice, S +X, AP is improved by X (to -6 at most). Roll modifiers are
 * summed (the engine caps them), the lowest critical threshold and the strongest re-roll win,
 * and granted weapon abilities are merged (grantAbilities). Returns a new profile.
 */
export function applyAbilities(profile: WeaponProfile, abilities: readonly UnitAbility[]): WeaponProfile {
  const effects = abilities.flatMap((a) => a.effects);
  const out: WeaponProfile = {
    ...profile,
    attacks: addToDice(profile.attacks, statAmount(effects, 'attacks')),
    strength: profile.strength + statAmount(effects, 'strength'),
    ap: Math.max(-6, profile.ap - apAmount(effects)),
    damage: addToDice(profile.damage, statAmount(effects, 'damage')),
    abilities: copyAbilities(profile.abilities),
    conditions: { ...profile.conditions },
    modifiers: { ...profile.modifiers },
  };
  const m = out.modifiers;
  for (const e of effects) {
    if (e.kind === 'roll' && (e.amount === 1 || e.amount === -1)) {
      if (e.roll === 'hit') m.hit += e.amount;
      else m.wound += e.amount;
    } else if (e.kind === 'critical' && Number.isInteger(e.on) && e.on >= 2 && e.on <= 6) {
      if (e.roll === 'hit') m.criticalHit = Math.min(m.criticalHit, e.on);
      else m.criticalWound = Math.min(m.criticalWound, e.on);
    } else if (e.kind === 'reroll') {
      if (e.roll === 'hit') m.rerollHits = strongerReroll(m.rerollHits, e.which);
      else m.rerollWounds = strongerReroll(m.rerollWounds, e.which);
    } else if (e.kind === 'grant') {
      out.abilities = grantAbilities(out.abilities, e.abilities);
    }
  }
  return out;
}

// ---------- text ----------

export const EFFECT_KIND_NAMES: Record<AbilityEffectKind, string> = {
  stat: 'Characteristic +X',
  ap: 'Improve AP',
  roll: 'Roll modifier',
  critical: 'Critical on',
  reroll: 'Re-roll',
  grant: 'Gain weapon abilities',
};

const STAT_SHORT = { attacks: 'A', strength: 'S', damage: 'D' } as const;

/** "+1 A", "Improve AP by 1", "+1 to hit", "Critical wounds on 5+", "Re-roll hits of 1", "Gain Lethal Hits". */
export function effectSummary(e: AbilityEffect): string {
  switch (e.kind) {
    case 'stat':
      return `+${e.amount} ${STAT_SHORT[e.stat]}`;
    case 'ap':
      return `Improve AP by ${e.amount}`;
    case 'roll':
      return `${e.amount >= 0 ? '+' : ''}${e.amount} to ${e.roll}`;
    case 'critical':
      return `Critical ${e.roll}s on ${e.on}+`;
    case 'reroll':
      return e.which === 'ones' ? `Re-roll ${e.roll}s of 1` : `Re-roll failed ${e.roll}s`;
    case 'grant': {
      const text = abilitiesSummary(e.abilities);
      return text === '' ? 'Gain nothing' : `Gain ${text}`;
    }
  }
}

/** "Charged · Melee · vs Monster", or '' when the ability always applies. */
export function conditionSummary(c: AbilityCondition): string {
  return [
    ...c.situations.map(situationName),
    c.weaponType === 'any' ? '' : WEAPON_TYPE_NAMES[c.weaponType],
    c.targetKeyword === null ? '' : `vs ${KEYWORD_NAMES[c.targetKeyword]}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** "Charged · Melee: +1 A", "Re-roll hits of 1" (no condition), with every effect joined by ", ". */
export function abilitySummary(a: UnitAbility): string {
  const effects = a.effects.length === 0 ? 'No effects' : a.effects.map(effectSummary).join(', ');
  const when = conditionSummary(a.when);
  return when === '' ? effects : `${when}: ${effects}`;
}

/** A grant effect with nothing granted yet. */
export function emptyGrant(): AbilityEffect {
  return { kind: 'grant', abilities: noAbilities() };
}
