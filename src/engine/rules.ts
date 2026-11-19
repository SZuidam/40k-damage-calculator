import type { DefenderProfile, WeaponProfile } from '../types';
import { parseDice, type DiceExpr } from './dice';

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
 * later abilities (modifiers, rerolls, lethal hits, …) can hook in here
 * without restructuring the simulation or the exact calculation.
 */
export interface AttackContext {
  weapon: WeaponProfile;
  defender: DefenderProfile;
  attacks: DiceExpr;
  damage: DiceExpr;
  hitTarget: number;
  woundTarget: number;
  saveTarget: number;
}

export function createAttackContext(weapon: WeaponProfile, defender: DefenderProfile): AttackContext {
  return {
    weapon,
    defender,
    attacks: parseDice(weapon.attacks),
    damage: parseDice(weapon.damage),
    hitTarget: weapon.skill,
    woundTarget: woundTarget(weapon.strength, defender.toughness),
    saveTarget: saveTarget(defender.save, weapon.ap, defender.invuln),
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

/** Probability that `step` succeeds on a single d6, evaluated over all six faces. */
function chance(ctx: AttackContext, step: (ctx: AttackContext, roll: number) => boolean): number {
  let successes = 0;
  for (let roll = 1; roll <= 6; roll++) if (step(ctx, roll)) successes++;
  return successes / 6;
}

export const hitChance = (ctx: AttackContext) => chance(ctx, hitSucceeds);
export const woundChance = (ctx: AttackContext) => chance(ctx, woundSucceeds);
export const saveChance = (ctx: AttackContext) => chance(ctx, saveSucceeds);

/** P(a single attack becomes an unsaved wound). */
export function unsavedChance(ctx: AttackContext): number {
  return hitChance(ctx) * woundChance(ctx) * (1 - saveChance(ctx));
}
