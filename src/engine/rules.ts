import type { DefenderProfile, WeaponProfile } from '../types';
import { convolve, diceDistribution, parseDice, type DiceExpr } from './dice';

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
  attacks: DiceExpr;
  damage: DiceExpr;
  hitTarget: number;
  woundTarget: number;
  saveTarget: number;
  /** An unmodified hit roll of this or higher is a critical hit (6 for now). */
  criticalHit: number;
  /** An unmodified wound roll of this or higher is a critical wound (6 for now). */
  criticalWound: number;
  /** Lethal Hits: a critical hit wounds automatically, without a wound roll. */
  lethalHits: boolean;
  /** Sustained Hits X: extra hits scored by a critical hit, or null. */
  sustainedHits: DiceExpr | null;
  /** Devastating Wounds: a critical wound skips the saving throw. */
  devastatingWounds: boolean;
  /** Extra attacks per model from Blast / Cleave, already added to `attacks`. */
  bonusAttacks: number;
}

/**
 * Blast X / Cleave X: X extra attacks per model for every 5 models in the target unit
 * (rounded down). The unit size is the one at the start of the attack, as when targets are
 * picked, so models destroyed by earlier weapons in the list don't lower it.
 */
export function bonusAttacks(weapon: WeaponProfile, defender: DefenderProfile): number {
  const perFive = (weapon.abilities.blast ?? 0) + (weapon.abilities.cleave ?? 0);
  return perFive * Math.floor(defender.models / 5);
}

export function createAttackContext(weapon: WeaponProfile, defender: DefenderProfile): AttackContext {
  const { abilities } = weapon;
  const attacks = parseDice(weapon.attacks);
  const bonus = bonusAttacks(weapon, defender);
  return {
    weapon,
    defender,
    attacks: { ...attacks, bonus: attacks.bonus + bonus },
    damage: parseDice(weapon.damage),
    hitTarget: weapon.skill,
    woundTarget: woundTarget(weapon.strength, defender.toughness),
    saveTarget: saveTarget(defender.save, weapon.ap, defender.invuln),
    criticalHit: 6,
    criticalWound: 6,
    lethalHits: abilities.lethalHits,
    sustainedHits: abilities.sustainedHits === null ? null : parseDice(abilities.sustainedHits),
    devastatingWounds: abilities.devastatingWounds,
    bonusAttacks: bonus,
  };
}

export function hitSucceeds(ctx: AttackContext, roll: number): boolean {
  return rollSucceeds(roll, ctx.hitTarget);
}

export function woundSucceeds(ctx: AttackContext, roll: number): boolean {
  return rollSucceeds(roll, ctx.woundTarget);
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
export const woundChance = (ctx: AttackContext) => chance(ctx, woundSucceeds);
export const saveChance = (ctx: AttackContext) => chance(ctx, saveSucceeds);

/**
 * P(a hit that rolls to wound becomes an unsaved wound). With Devastating Wounds a
 * critical wound skips the save.
 */
export function unsavedPerWoundRoll(ctx: AttackContext): number {
  const failSave = 1 - saveChance(ctx);
  let p = 0;
  for (let roll = 1; roll <= 6; roll++) {
    if (!woundSucceeds(ctx, roll)) continue;
    p += (ctx.devastatingWounds && isCriticalWound(ctx, roll) ? 1 : failSave) / 6;
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
