import type { DefenderKeyword, DefenderProfile, WeaponAbilities, WeaponProfile } from '../types';
import { convolve, diceDistribution, parseDice, repeatDice, type DiceExpr } from './dice';

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
  /** An unmodified hit roll of this or higher is a critical hit (6 for now). */
  criticalHit: number;
  /** An unmodified wound roll of this or higher is a critical wound: 6, or Y with a matching Anti-X Y+. */
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
   * Added to the wound roll (Lance while charging), already capped at -1 / +1. It moves the
   * roll against the S vs T target only: critical wounds use the unmodified roll.
   */
  woundModifier: number;
  /** Twin-linked: a failed wound roll is re-rolled once; the re-roll stands, pass or fail. */
  rerollFailedWounds: boolean;
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

/** The wound roll modifier: +1 for Lance while charging, capped at -1 / +1. */
export function woundModifier(weapon: Pick<WeaponProfile, 'abilities' | 'conditions'>): number {
  const total = weapon.abilities.lance && weapon.conditions.charged ? 1 : 0;
  return Math.max(-MAX_ROLL_MODIFIER, Math.min(MAX_ROLL_MODIFIER, total));
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

/** Everything one attacking model rolls for its number of attacks: A plus Blast / Cleave / Rapid Fire. */
export function attacksPerModel(ctx: AttackContext): DiceExpr[] {
  return [ctx.attacks, ...ctx.bonusAttacks];
}

/** Everything rolled for the damage of one unsaved wound: D plus Melta. */
export function damagePerWound(ctx: AttackContext): DiceExpr[] {
  return [ctx.damage, ...ctx.bonusDamage];
}

export function createAttackContext(weapon: WeaponProfile, defender: DefenderProfile): AttackContext {
  const { abilities } = weapon;
  return {
    weapon,
    defender,
    attacks: parseDice(weapon.attacks),
    damage: parseDice(weapon.damage),
    bonusDamage: bonusDamage(weapon),
    hitTarget: weapon.skill,
    woundTarget: woundTarget(weapon.strength, defender.toughness),
    saveTarget: saveTarget(defender.save, weapon.ap, defender.invuln),
    criticalHit: 6,
    criticalWound: antiCriticalWound(abilities, defender.keywords) ?? 6,
    lethalHits: abilities.lethalHits,
    sustainedHits: abilities.sustainedHits === null ? null : parseDice(abilities.sustainedHits),
    devastatingWounds: abilities.devastatingWounds,
    bonusAttacks: bonusAttacks(weapon, defender),
    woundModifier: woundModifier(weapon),
    rerollFailedWounds: abilities.twinLinked,
  };
}

export function hitSucceeds(ctx: AttackContext, roll: number): boolean {
  return rollSucceeds(roll, ctx.hitTarget);
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

/** A successful hit whose unmodified roll is a critical hit. */
export function isCriticalHit(ctx: AttackContext, roll: number): boolean {
  return roll >= ctx.criticalHit && hitSucceeds(ctx, roll);
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

export const hitChance = (ctx: AttackContext) => chance(ctx, hitSucceeds);
export const saveChance = (ctx: AttackContext) => chance(ctx, saveSucceeds);

/**
 * Probability that a hit's wound roll ends on each face after re-rolls: faces[roll - 1].
 * Without a re-roll every face is 1/6. Twin-linked re-rolls a failed roll once, and the
 * re-rolled die is the one that counts (as an unmodified roll, so it can be a critical wound):
 *   P(face f) = [f wounds] · 1/6 + P(first roll fails) · 1/6.
 * The faces sum to 1 either way.
 */
export function woundRollFaces(ctx: AttackContext): number[] {
  const first = new Array<number>(6).fill(1 / 6);
  if (!ctx.rerollFailedWounds) return first;
  const failed = 1 - chance(ctx, woundSucceeds);
  return first.map((p, i) => (woundSucceeds(ctx, i + 1) ? p : 0) + failed / 6);
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

  let pmf = [0];
  for (let roll = 1; roll <= 6; roll++) {
    let outcome: number[];
    if (!hitSucceeds(ctx, roll)) outcome = [1];
    else if (!isCriticalHit(ctx, roll)) outcome = [1 - q, q];
    else {
      const main = ctx.lethalHits ? failSave : q;
      outcome = convolve([1 - main, main], fromExtra);
    }
    pmf = addInto(pmf, outcome, 1 / 6);
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
