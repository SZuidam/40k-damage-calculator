import type { DefenderProfile, RerollKind, WeaponProfile } from '../types';
import { formatDiceSum, meanValue, type DiceExpr } from './dice';
import { applyWeapon, evaluateState, initialState, weaponKernel } from './exact';
import {
  attacksPerModel,
  createAttackContext,
  damagePerWound,
  hitRollFaces,
  hitSucceeds,
  isCriticalHit,
  isCriticalWound,
  isRerolled,
  saveChance,
  woundRollFaces,
  woundSucceeds,
  type AttackContext,
} from './rules';

/**
 * One hit or wound roll worked out: which faces pass, how a re-roll adds to that and how often
 * the result is critical. Re-rolled faces never pass on the first roll (a 1, or a failed roll),
 * so P(pass) = first + rerolled × first.
 */
export interface RollBreakdown {
  /** The lowest face that passes (passing faces always run up to 6), or null when none does. */
  passOn: number | null;
  /** P(pass) of a single roll, before any re-roll. */
  first: number;
  reroll: RerollKind;
  /** P(the first roll is re-rolled). */
  rerolled: number;
  /** P(pass), re-roll included. */
  chance: number;
  /** An unmodified roll of this or higher that passes is critical. */
  criticalOn: number;
  /** P(critical pass) of a single roll, before any re-roll. */
  criticalFirst: number;
  /** P(critical pass), re-roll included. */
  critical: number;
}

/** A term of the attacks or damage per model / per wound, labelled with where it comes from. */
export interface DiceTerm {
  label: string;
  expr: string;
  mean: number;
}

/**
 * The expected value of every step of one weapon's attack sequence, worked out the way you
 * would by hand: average attacks × chance to hit, and so on. These are exact expectations, so
 * they match the simulated averages up to sampling noise. `applied` and `destroyed` also follow
 * the exact Markov chain (excess damage lost, partly wounded models carried over between weapons).
 */
export interface WeaponBreakdown {
  weapon: WeaponProfile;
  /** A plus Blast / Cleave / Rapid Fire, per attacking model. */
  attackTerms: DiceTerm[];
  attacksPerModelExpr: string;
  attacksPerModel: number;
  attacks: number;
  hit: RollBreakdown;
  /** Sustained Hits X: extra hits per critical hit, or null. */
  sustained: DiceTerm | null;
  criticalHits: number;
  /** Extra hits from Sustained Hits. */
  extraHits: number;
  hits: number;
  /** Critical hits that wound automatically (Lethal Hits). */
  lethal: number;
  /** Hits that roll to wound: hits − lethal. */
  woundRolls: number;
  /** The S vs T target, before modifiers. */
  strengthVsToughness: number;
  hitModifier: number;
  woundModifier: number;
  wound: RollBreakdown;
  wounds: number;
  /** Critical wounds that skip the save (Devastating Wounds). */
  devastating: number;
  /** The save that is taken: the armour target after AP or the invulnerable save, or null when none can pass. */
  save: { on: number; invulnerable: boolean } | null;
  /** The armour target after AP (may be above 6). */
  armourOn: number;
  failSave: number;
  unsaved: number;
  damageTerms: DiceTerm[];
  damagePerWoundExpr: string;
  damagePerWound: number;
  /** unsaved × damage per wound, before excess damage is lost. */
  damage: number;
  /** Exact expected damage applied by this weapon, given the weapons before it. */
  applied: number;
  /** Exact expected models destroyed by this weapon, given the weapons before it. */
  destroyed: number;
}

export interface Breakdown {
  weapons: WeaponBreakdown[];
  appliedTotal: number;
  destroyedTotal: number;
}

function rollBreakdown(ctx: AttackContext, kind: RerollKind, faces: number[], passes: (ctx: AttackContext, roll: number) => boolean, critical: (ctx: AttackContext, roll: number) => boolean, criticalOn: number): RollBreakdown {
  let passOn: number | null = null;
  let first = 0;
  let rerolled = 0;
  let criticalFirst = 0;
  let chance = 0;
  let criticalChance = 0;
  for (let roll = 6; roll >= 1; roll--) {
    const pass = passes(ctx, roll);
    if (pass) {
      passOn = roll;
      first += 1 / 6;
      chance += faces[roll - 1];
    }
    if (critical(ctx, roll)) {
      criticalFirst += 1 / 6;
      criticalChance += faces[roll - 1];
    }
    if (isRerolled(kind, roll, pass)) rerolled += 1 / 6;
  }
  return { passOn, first, reroll: kind, rerolled, chance, criticalOn, criticalFirst, critical: criticalChance };
}

function term(label: string, expr: DiceExpr): DiceTerm {
  return { label, expr: formatDiceSum([expr]), mean: meanValue(expr) };
}

const sum = (terms: DiceTerm[]) => terms.reduce((total, t) => total + t.mean, 0);

/** Labels for rules.bonusAttacks' terms, in the same order. */
function bonusAttackLabels(weapon: WeaponProfile, defender: DefenderProfile): string[] {
  const { blast, cleave, rapidFire } = weapon.abilities;
  const blocks = Math.floor(defender.models / 5);
  const perBlocks = blocks > 1 ? ` × ${blocks} (per 5 models)` : '';
  const labels: string[] = [];
  if (blocks >= 1) {
    if (blast !== null) labels.push(`Blast ${blast}${perBlocks}`);
    if (cleave !== null) labels.push(`Cleave ${cleave}${perBlocks}`);
  }
  if (rapidFire !== null && weapon.conditions.halfRange) labels.push(`Rapid Fire ${rapidFire}`);
  return labels;
}

export function weaponBreakdown(weapon: WeaponProfile, defender: DefenderProfile): Omit<WeaponBreakdown, 'applied' | 'destroyed'> {
  const ctx = createAttackContext(weapon, defender);

  const attackLabels = ['A', ...bonusAttackLabels(weapon, defender)];
  const attackTerms = attacksPerModel(ctx).map((expr, i) => term(attackLabels[i] ?? 'Bonus', expr));
  const attacksPerModelMean = sum(attackTerms);
  const attacks = weapon.models * attacksPerModelMean;

  const hit = rollBreakdown(ctx, ctx.rerollHits, hitRollFaces(ctx), hitSucceeds, isCriticalHit, ctx.criticalHit);
  const sustained = ctx.sustainedHits === null ? null : term(`Sustained Hits ${weapon.abilities.sustainedHits}`, ctx.sustainedHits);
  const criticalHits = attacks * hit.critical;
  const extraHits = sustained === null ? 0 : criticalHits * sustained.mean;
  const hits = attacks * hit.chance + extraHits;

  const lethal = ctx.lethalHits ? criticalHits : 0;
  const woundRolls = hits - lethal;
  const wound = rollBreakdown(ctx, ctx.rerollWounds, woundRollFaces(ctx), woundSucceeds, isCriticalWound, ctx.criticalWound);
  const wounds = woundRolls * wound.chance + lethal;

  const devastating = ctx.devastatingWounds ? woundRolls * wound.critical : 0;
  const armourOn = defender.save + Math.abs(weapon.ap);
  const save = ctx.saveTarget > 6 ? null : { on: ctx.saveTarget, invulnerable: defender.invuln !== null && defender.invuln < armourOn };
  const failSave = 1 - saveChance(ctx);
  const unsaved = (wounds - devastating) * failSave + devastating;

  const damageLabels = ['D', ...(ctx.bonusDamage.length > 0 ? [`Melta ${weapon.abilities.melta}`] : [])];
  const damageTerms = damagePerWound(ctx).map((expr, i) => term(damageLabels[i] ?? 'Bonus', expr));
  const damagePerWoundMean = sum(damageTerms);

  return {
    weapon,
    attackTerms,
    attacksPerModelExpr: formatDiceSum(attacksPerModel(ctx)),
    attacksPerModel: attacksPerModelMean,
    attacks,
    hit,
    sustained,
    criticalHits,
    extraHits,
    hits,
    lethal,
    woundRolls,
    strengthVsToughness: ctx.woundTarget,
    hitModifier: ctx.hitModifier,
    woundModifier: ctx.woundModifier,
    wound,
    wounds,
    devastating,
    save,
    armourOn,
    failSave,
    unsaved,
    damageTerms,
    damagePerWoundExpr: formatDiceSum(damagePerWound(ctx)),
    damagePerWound: damagePerWoundMean,
    damage: unsaved * damagePerWoundMean,
  };
}

/** The worked-out expectation of every weapon in firing order, with the exact damage each one applies. */
export function breakdown(weapons: WeaponProfile[], defender: DefenderProfile): Breakdown {
  let state = initialState(defender);
  let before = evaluateState(state, defender);
  const out: WeaponBreakdown[] = [];
  for (const weapon of weapons) {
    state = applyWeapon(state, weaponKernel(weapon, defender), defender);
    const after = evaluateState(state, defender);
    out.push({
      ...weaponBreakdown(weapon, defender),
      applied: after.expectedDamage - before.expectedDamage,
      destroyed: after.expectedModelsDestroyed - before.expectedModelsDestroyed,
    });
    before = after;
  }
  return { weapons: out, appliedTotal: before.expectedDamage, destroyedTotal: before.expectedModelsDestroyed };
}
