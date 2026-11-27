import { MONSTER_VEHICLE, copyAbilities, type DamageRerollThresholds, type DefenderKeyword, type DefenderProfile, type RerollKind, type RollModifiers, type WeaponAbilities, type WeaponProfile } from '../types';
import { convolve, diceDistribution, parseDice, repeatDice, rollDice, rollDiceSum, tryParseDice, type DiceExpr } from './dice';
import type { Rng } from './rng';

/** A roll target above 6 can never be met. */
export const IMPOSSIBLE = 7;

export function woundTarget(strength: number, toughness: number): number {
  if (strength >= 2 * toughness) return 2;
  if (strength > toughness) return 3;
  if (strength === toughness) return 4;
  if (2 * strength <= toughness) return 6;
  return 5;
}

/**
 * Armour target = Sv + |AP|; invulnerable save ignores AP.
 * Returns the best available target, or IMPOSSIBLE (7) when no save can succeed.
 */
export function saveTarget(save: number, ap: number, invuln: number | null): number {
  const armour = save + Math.abs(ap);
  const best = invuln === null ? armour : Math.min(armour, invuln);
  return Math.min(best, IMPOSSIBLE);
}

/** A d6 roll succeeds on `target`+; an unmodified 1 always fails. */
export function rollSucceeds(roll: number, target: number): boolean {
  return roll !== 1 && roll >= target;
}

/**
 * Everything needed to resolve one weapon's attacks against one defender.
 * Each step of the sequence is a small function of (context, roll) so that
 * later abilities (modifiers, rerolls, …) can hook in here without
 * restructuring the simulation or the exact calculation.
 */
export interface AttackContext {
  weapon: WeaponProfile;
  defender: DefenderProfile;
  /** The weapon's own attacks per model (A), without Blast / Cleave / Rapid Fire. */
  attacks: DiceExpr;
  /** The weapon's own Damage characteristic (D), without Melta. */
  damage: DiceExpr;
  /** Extra damage per unsaved wound from Melta, rolled on top of `damage`. */
  bonusDamage: DiceExpr[];
  hitTarget: number;
  woundTarget: number;
  saveTarget: number;
  /** An unmodified hit roll of this or higher is a critical hit: 6, or lower from an ability. */
  criticalHit: number;
  /**
   * An unmodified wound roll of this or higher is a critical wound: 6, or the lowest of Y of a
   * matching Anti-X Y+ and an ability's threshold.
   */
  criticalWound: number;
  /** Lethal Hits: a critical hit wounds automatically, without a wound roll. */
  lethalHits: boolean;
  /** Sustained Hits X: extra hits scored by a critical hit, or null. */
  sustainedHits: DiceExpr | null;
  /** Devastating Wounds: a critical wound skips the saving throw. */
  devastatingWounds: boolean;
  /** Extra attacks per model from Blast / Cleave / Rapid Fire, rolled on top of `attacks`. */
  bonusAttacks: DiceExpr[];
  /**
   * Added to the hit roll (abilities), already capped at -1 / +1. It moves the roll against
   * BS / WS only: critical hits use the unmodified roll.
   */
  hitModifier: number;
  /**
   * Added to the wound roll (Lance while charging, abilities), already capped at -1 / +1. It
   * moves the roll against the S vs T target only: critical wounds use the unmodified roll.
   */
  woundModifier: number;
  /** Which hit rolls are re-rolled once (abilities); the re-roll stands, pass or fail. */
  rerollHits: RerollKind;
  /** Which wound rolls are re-rolled once: Twin-linked re-rolls failed ones, abilities 1s or failed ones. */
  rerollWounds: RerollKind;
  /** Torrent: every attack hits automatically, without a hit roll (so never a critical hit). */
  torrent: boolean;
  /** A roll of `damage` whose dice (without its +X) show less than this is re-rolled once and the re-roll stands; 0 for none. */
  rerollDamageBelow: number;
}

/** A hit or wound roll can be modified by at most -1 / +1 in total. */
export const MAX_ROLL_MODIFIER = 1;

/**
 * Extra attacks per model on top of A:
 * - Blast X / Cleave X: X for every 5 models in the target unit (rounded down). X may be a
 *   dice expression; it is rolled separately for every block of 5 models and for every
 *   attacking model, so Blast D6+2 into 10 models adds 2D6+4 attacks per model. The unit size
 *   is the one at the start of the attack, as when targets are picked, so models destroyed by
 *   earlier weapons in the list don't lower it.
 * - Rapid Fire X: X while the target is within half range, rolled once per attacking model.
 * Returns one term per ability that applies (Blast, Cleave, Rapid Fire), or none.
 */
export function bonusAttacks(weapon: Pick<WeaponProfile, 'abilities' | 'conditions'>, defender: Pick<DefenderProfile, 'models'>): DiceExpr[] {
  const { blast, cleave, rapidFire } = weapon.abilities;
  const terms: DiceExpr[] = [];
  const blocks = Math.floor(defender.models / 5);
  if (blocks >= 1) for (const x of [blast, cleave]) if (x !== null) terms.push(repeatDice(parseDice(x), blocks));
  if (rapidFire !== null && weapon.conditions.halfRange) terms.push(parseDice(rapidFire));
  return terms;
}

/**
 * Extra damage per unsaved wound on top of D: Melta X while the target is within half range,
 * rolled for every damage roll. Returns one term when it applies, or none.
 */
export function bonusDamage(weapon: Pick<WeaponProfile, 'abilities' | 'conditions'>): DiceExpr[] {
  const { melta } = weapon.abilities;
  return melta !== null && weapon.conditions.halfRange ? [parseDice(melta)] : [];
}

const capModifier = (total: number) => Math.max(-MAX_ROLL_MODIFIER, Math.min(MAX_ROLL_MODIFIER, total));

/** The hit roll modifier from abilities, capped at -1 / +1. */
export function hitModifier(weapon: Pick<WeaponProfile, 'modifiers'>): number {
  return capModifier(weapon.modifiers.hit);
}

/** The wound roll modifier: +1 for Lance while charging plus abilities, capped at -1 / +1. */
export function woundModifier(weapon: Pick<WeaponProfile, 'abilities' | 'conditions' | 'modifiers'>): number {
  const lance = weapon.abilities.lance && weapon.conditions.charged ? 1 : 0;
  return capModifier(lance + weapon.modifiers.wound);
}

const REROLL_STRENGTH: Record<RerollKind, number> = { none: 0, ones: 1, failed: 2 };

/** The stronger of two re-rolls: re-rolling failed rolls includes re-rolling 1s. */
export function strongerReroll(a: RerollKind, b: RerollKind): RerollKind {
  return REROLL_STRENGTH[a] >= REROLL_STRENGTH[b] ? a : b;
}

/** Whether a die that rolled `roll` (and passed or not) is re-rolled under `kind`. */
export function isRerolled(kind: RerollKind, roll: number, succeeded: boolean): boolean {
  if (kind === 'failed') return !succeeded;
  if (kind === 'ones') return roll === 1;
  return false;
}

/**
 * The "re-roll damage below" threshold for a Damage characteristic: the D3 or D6 threshold of
 * the Settings by the dice it rolls, or 0 when it rolls none (fixed damage has nothing to re-roll)
 * or isn't a valid expression.
 */
export function damageRerollBelow(damage: string, thresholds: DamageRerollThresholds): number {
  const parsed = tryParseDice(damage);
  if (!parsed || parsed.count === 0) return 0;
  const below = parsed.sides === 3 ? thresholds.d3 : thresholds.d6;
  return Number.isInteger(below) && below > 0 ? below : 0;
}

/** A critical threshold as a whole number 2–6 (6 when it isn't usable). */
function threshold(value: number): number {
  return Number.isInteger(value) && value >= 2 && value <= 6 ? value : 6;
}

/** The critical hit / wound thresholds of the weapon's roll modifiers, made usable. */
function criticalThresholds(modifiers: RollModifiers): { hit: number; wound: number } {
  return { hit: threshold(modifiers.criticalHit), wound: threshold(modifiers.criticalWound) };
}

/**
 * Anti-X Y+: the critical wound threshold against a defender with these keywords: the lowest
 * Y among the weapon's Anti abilities whose keyword the defender has, or null when none apply.
 */
export function antiCriticalWound(abilities: Pick<WeaponAbilities, 'anti'>, keywords: readonly DefenderKeyword[]): number | null {
  let best: number | null = null;
  for (const keyword of keywords) {
    const y = abilities.anti[keyword];
    if (y !== undefined && (best === null || y < best)) best = y;
  }
  return best;
}

/** Whether a target with these keywords is a Monster or a Vehicle (null: no target, so neither). */
export function isMonsterOrVehicle(keywords: readonly DefenderKeyword[] | null): boolean {
  return keywords !== null && keywords.some((k) => MONSTER_VEHICLE.includes(k));
}

/**
 * The weapon abilities that apply against a target with these keywords: against a Monster or a
 * Vehicle the abilities in `notVsMonsterVehicle` (Sustained Hits, Devastating Wounds) are
 * switched off, and so dropped from that list. Without a target (null) or against any other
 * target, a copy of `abilities`. Never changes `abilities`.
 */
export function abilitiesAgainst(abilities: WeaponAbilities, keywords: readonly DefenderKeyword[] | null): WeaponAbilities {
  const out = copyAbilities(abilities);
  if (!isMonsterOrVehicle(keywords) || out.notVsMonsterVehicle.length === 0) return out;
  for (const key of out.notVsMonsterVehicle) {
    if (key === 'sustainedHits') out.sustainedHits = null;
    else out.devastatingWounds = false;
  }
  out.notVsMonsterVehicle = [];
  return out;
}

/** Everything one attacking model rolls for its number of attacks: A plus Blast / Cleave / Rapid Fire. */
export function attacksPerModel(ctx: AttackContext): DiceExpr[] {
  return [ctx.attacks, ...ctx.bonusAttacks];
}

/** Everything rolled for the damage of one unsaved wound: D plus Melta. */
export function damagePerWound(ctx: AttackContext): DiceExpr[] {
  return [ctx.damage, ...ctx.bonusDamage];
}

/** Whether a damage roll of `total` is re-rolled: its dice (the total without D's +X) show less than the threshold. */
function isDamageRerolled(ctx: AttackContext, total: number): boolean {
  return total - ctx.damage.bonus < ctx.rerollDamageBelow;
}

/**
 * PMF of the Damage characteristic's roll after a re-roll: a roll whose dice show less than
 * `rerollDamageBelow` (D6+2 rolling a 3 counts as 3, not 5) is rolled again and the new roll
 * stands, whatever it is:
 *   P(v) = [v is kept] · p(v) + P(first roll is re-rolled) · p(v).
 * Without a re-roll this is the plain PMF of D.
 */
export function damageRollDistribution(ctx: AttackContext): number[] {
  const first = diceDistribution(ctx.damage);
  if (ctx.rerollDamageBelow <= 0) return first;
  const again = first.reduce((sum, p, v) => sum + (isDamageRerolled(ctx, v) ? p : 0), 0);
  return first.map((p, v) => (isDamageRerolled(ctx, v) ? 0 : p) + again * p);
}

/** P(a damage roll is re-rolled): P(the dice of D show less than `rerollDamageBelow`). */
export function damageRerollChance(ctx: AttackContext): number {
  if (ctx.rerollDamageBelow <= 0) return 0;
  return diceDistribution(ctx.damage).reduce((sum, p, v) => sum + (isDamageRerolled(ctx, v) ? p : 0), 0);
}

/** PMF of the damage of one unsaved wound: D (after any re-roll) plus Melta. */
export function damageDistribution(ctx: AttackContext): number[] {
  let pmf = damageRollDistribution(ctx);
  for (const term of ctx.bonusDamage) pmf = convolve(pmf, diceDistribution(term));
  return pmf;
}

/** Roll the damage of one unsaved wound: D (re-rolled once when its dice show less than `rerollDamageBelow`) plus Melta. */
export function rollDamage(ctx: AttackContext, rng: Rng): number {
  let damage = rollDice(ctx.damage, rng);
  if (isDamageRerolled(ctx, damage)) damage = rollDice(ctx.damage, rng);
  return damage + rollDiceSum(ctx.bonusDamage, rng);
}

export function createAttackContext(weapon: WeaponProfile, defender: DefenderProfile): AttackContext {
  // Abilities limited to non-Monster / non-Vehicle targets drop out against one (state/loadout
  // already resolves them before granted abilities are merged; this keeps the engine right on its own).
  const abilities = abilitiesAgainst(weapon.abilities, defender.keywords);
  const critical = criticalThresholds(weapon.modifiers);
  const damage = parseDice(weapon.damage);
  const torrent = abilities.torrent;
  const rerollDamage = weapon.modifiers.rerollDamageBelow;
  return {
    weapon,
    defender,
    attacks: parseDice(weapon.attacks),
    damage,
    bonusDamage: bonusDamage(weapon),
    hitTarget: weapon.skill,
    woundTarget: woundTarget(weapon.strength, defender.toughness),
    saveTarget: saveTarget(defender.save, weapon.ap, defender.invuln),
    criticalHit: critical.hit,
    criticalWound: Math.min(antiCriticalWound(abilities, defender.keywords) ?? 6, critical.wound),
    lethalHits: abilities.lethalHits,
    sustainedHits: abilities.sustainedHits === null ? null : parseDice(abilities.sustainedHits),
    devastatingWounds: abilities.devastatingWounds,
    bonusAttacks: bonusAttacks(weapon, defender),
    // Torrent makes no hit roll: nothing to modify or re-roll.
    hitModifier: torrent ? 0 : hitModifier(weapon),
    woundModifier: woundModifier(weapon),
    rerollHits: torrent ? 'none' : weapon.modifiers.rerollHits,
    rerollWounds: strongerReroll(abilities.twinLinked ? 'failed' : 'none', weapon.modifiers.rerollWounds),
    torrent,
    // Fixed damage has nothing to re-roll.
    rerollDamageBelow: damage.count > 0 && Number.isInteger(rerollDamage) && rerollDamage > 0 ? rerollDamage : 0,
  };
}

/**
 * A hit roll succeeds when the modified roll meets BS / WS, and a critical hit (an unmodified
 * roll of `criticalHit`+) always hits. An unmodified 1 always fails. A Torrent weapon hits
 * whatever the face (it makes no hit roll).
 */
export function hitSucceeds(ctx: AttackContext, roll: number): boolean {
  return ctx.torrent || (roll !== 1 && (roll + ctx.hitModifier >= ctx.hitTarget || roll >= ctx.criticalHit));
}

/**
 * A wound roll succeeds when the modified roll meets the S vs T target, and a critical wound
 * (an unmodified roll of `criticalWound`+, see Anti-X Y+) always wounds. An unmodified 1 always fails.
 */
export function woundSucceeds(ctx: AttackContext, roll: number): boolean {
  return roll !== 1 && (roll + ctx.woundModifier >= ctx.woundTarget || roll >= ctx.criticalWound);
}

export function saveSucceeds(ctx: AttackContext, roll: number): boolean {
  return rollSucceeds(roll, ctx.saveTarget);
}

/** A successful hit whose unmodified roll is a critical hit. Torrent makes no hit roll, so never. */
export function isCriticalHit(ctx: AttackContext, roll: number): boolean {
  return !ctx.torrent && roll >= ctx.criticalHit && hitSucceeds(ctx, roll);
}

/** A successful wound whose unmodified roll is a critical wound. */
export function isCriticalWound(ctx: AttackContext, roll: number): boolean {
  return roll >= ctx.criticalWound && woundSucceeds(ctx, roll);
}

/** Probability that `step` succeeds on a single d6, evaluated over all six faces. */
function chance(ctx: AttackContext, step: (ctx: AttackContext, roll: number) => boolean): number {
  let successes = 0;
  for (let roll = 1; roll <= 6; roll++) if (step(ctx, roll)) successes++;
  return successes / 6;
}

export const saveChance = (ctx: AttackContext) => chance(ctx, saveSucceeds);

/**
 * Probability that a roll ends on each face after a re-roll: faces[roll - 1]. Without a re-roll
 * every face is 1/6. A re-rolled die (a 1, or any failed roll) is rolled once more and the new
 * roll is the one that counts, as an unmodified roll (so it can be critical):
 *   P(face f) = [f is kept] · 1/6 + P(first roll is re-rolled) · 1/6.
 * The faces sum to 1 either way.
 */
function rollFaces(ctx: AttackContext, kind: RerollKind, step: (ctx: AttackContext, roll: number) => boolean): number[] {
  const first = new Array<number>(6).fill(1 / 6);
  if (kind === 'none') return first;
  const rerolled = first.map((_, i) => isRerolled(kind, i + 1, step(ctx, i + 1)));
  const again = rerolled.filter(Boolean).length / 6;
  return first.map((p, i) => (rerolled[i] ? 0 : p) + again / 6);
}

/** Probability that a hit roll ends on each face after re-rolls (see rollFaces). */
export function hitRollFaces(ctx: AttackContext): number[] {
  return rollFaces(ctx, ctx.rerollHits, hitSucceeds);
}

/** Probability that a hit's wound roll ends on each face after re-rolls (Twin-linked, abilities). */
export function woundRollFaces(ctx: AttackContext): number[] {
  return rollFaces(ctx, ctx.rerollWounds, woundSucceeds);
}

/** P(an attack hits), re-rolls included. */
export function hitChance(ctx: AttackContext): number {
  return hitRollFaces(ctx).reduce((sum, p, i) => sum + (hitSucceeds(ctx, i + 1) ? p : 0), 0);
}

/** P(a hit that rolls to wound wounds), re-rolls included. */
export function woundChance(ctx: AttackContext): number {
  return woundRollFaces(ctx).reduce((sum, p, i) => sum + (woundSucceeds(ctx, i + 1) ? p : 0), 0);
}

/**
 * P(a hit that rolls to wound becomes an unsaved wound), re-rolls included. With
 * Devastating Wounds a critical wound skips the save.
 */
export function unsavedPerWoundRoll(ctx: AttackContext): number {
  const failSave = 1 - saveChance(ctx);
  const faces = woundRollFaces(ctx);
  let p = 0;
  for (let roll = 1; roll <= 6; roll++) {
    if (!woundSucceeds(ctx, roll)) continue;
    p += faces[roll - 1] * (ctx.devastatingWounds && isCriticalWound(ctx, roll) ? 1 : failSave);
  }
  return p;
}

/**
 * Distribution of the number of unsaved wounds one attack produces: pmf[k] = P(k).
 * Without Sustained Hits this is a Bernoulli [1 - p, p]. A critical hit adds the
 * Sustained Hits extra hits (each rolls to wound normally); with Lethal Hits the
 * critical hit itself skips the wound roll. A Lethal Hits auto-wound is not a
 * critical wound, so Devastating Wounds can't trigger on it.
 */
export function unsavedDistribution(ctx: AttackContext): number[] {
  const q = unsavedPerWoundRoll(ctx);
  const failSave = 1 - saveChance(ctx);
  const extraHits = ctx.sustainedHits === null ? [1] : diceDistribution(ctx.sustainedHits);

  // Unsaved wounds from the extra hits of one critical hit: Σ_x P(X = x) · Binomial(x, q).
  let fromExtra = [0];
  for (let x = 0; x < extraHits.length; x++) {
    if (extraHits[x] === 0) continue;
    fromExtra = addInto(fromExtra, binomial(x, q), extraHits[x]);
  }

  const hitFaces = hitRollFaces(ctx);
  let pmf = [0];
  for (let roll = 1; roll <= 6; roll++) {
    let outcome: number[];
    if (!hitSucceeds(ctx, roll)) outcome = [1];
    else if (!isCriticalHit(ctx, roll)) outcome = [1 - q, q];
    else {
      const main = ctx.lethalHits ? failSave : q;
      outcome = convolve([1 - main, main], fromExtra);
    }
    pmf = addInto(pmf, outcome, hitFaces[roll - 1]);
  }
  return pmf;
}

/** Expected unsaved wounds per attack. */
export function unsavedPerAttack(ctx: AttackContext): number {
  return unsavedDistribution(ctx).reduce((sum, p, k) => sum + p * k, 0);
}

function binomial(n: number, p: number): number[] {
  let row = [1];
  for (let i = 0; i < n; i++) row = convolve(row, [1 - p, p]);
  return row;
}

/** target + factor · source, as a new array long enough for both. */
function addInto(target: number[], source: number[], factor: number): number[] {
  const out = new Array<number>(Math.max(target.length, source.length)).fill(0);
  for (let i = 0; i < target.length; i++) out[i] += target[i];
  for (let i = 0; i < source.length; i++) out[i] += source[i] * factor;
  return out;
}
