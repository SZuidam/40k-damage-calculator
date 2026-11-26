import { maxValue, tryParseDice } from '../engine/dice';
import { activeAbilities, parseAntiValue } from '../state/abilities';
import { DEFENDER_KEYWORDS, KEYWORD_NAMES, type AbilityEffect, type DefenderProfile, type Unit, type UnitAbility, type WeaponAbilities, type WeaponStats } from '../types';

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

export const LIMITS = {
  weaponModels: { min: 1, max: 50 },
  strength: { min: 1, max: 30 },
  ap: { min: -6, max: 0 },
  defenderModels: { min: 1, max: 40 },
  toughness: { min: 1, max: 20 },
  wounds: { min: 1, max: 40 },
  /** Highest possible roll of X for Sustained Hits X / Blast X / Cleave X / Rapid Fire X / Melta X (2D6, D6+6). */
  abilityValue: { min: 1, max: 12 },
  iterations: { min: 100, max: 1_000_000 },
} as const;

/** The exact engine tracks models × wounds states; keep it responsive. */
export const MAX_DEFENDER_WOUND_POOL = 400;

function intInRange(value: number, { min, max }: { min: number; max: number }, label: string): string | undefined {
  if (!Number.isFinite(value) || !Number.isInteger(value)) return `${label} must be a whole number`;
  if (value < min || value > max) return `${label} must be between ${min} and ${max}`;
  return undefined;
}

function dice(expr: string, label: string): string | undefined {
  if (expr.trim() === '') return `${label} is required`;
  return tryParseDice(expr) ? undefined : `${label}: use 3, D3, D6, 2D6, D6+1, …`;
}

export const MAX_WEAPON_NAME = 40;

export function validateWeaponStats(w: WeaponStats): FieldErrors<WeaponStats> {
  const name = w.name.trim();
  const errors: FieldErrors<WeaponStats> = {
    name: name === '' ? 'Name is required' : name.length > MAX_WEAPON_NAME ? `Name must be at most ${MAX_WEAPON_NAME} characters` : undefined,
    attacks: dice(w.attacks, 'Attacks'),
    skill: intInRange(w.skill, { min: 2, max: 6 }, 'BS/WS'),
    strength: intInRange(w.strength, LIMITS.strength, 'Strength'),
    ap: intInRange(w.ap, LIMITS.ap, 'AP'),
    damage: dice(w.damage, 'Damage'),
    abilities: abilityError(w.abilities),
  };
  return prune(errors);
}

function abilityError(a: WeaponAbilities): string | undefined {
  return (
    (a.sustainedHits === null ? undefined : abilityValueError(a.sustainedHits, 'Sustained Hits')) ??
    (a.blast === null ? undefined : abilityValueError(a.blast, 'Blast')) ??
    (a.cleave === null ? undefined : abilityValueError(a.cleave, 'Cleave')) ??
    (a.rapidFire === null ? undefined : abilityValueError(a.rapidFire, 'Rapid Fire')) ??
    (a.melta === null ? undefined : abilityValueError(a.melta, 'Melta')) ??
    antiError(a)
  );
}

/** Y of every Anti-X Y+ must be a whole number 2–6 (it can come out of range from storage or an import). */
function antiError(a: WeaponAbilities): string | undefined {
  for (const keyword of DEFENDER_KEYWORDS) {
    const y = a.anti[keyword];
    if (y !== undefined && !(Number.isInteger(y) && y >= 2 && y <= 6)) return `Anti-${KEYWORD_NAMES[keyword]}: Y must be between 2+ and 6+`;
  }
  return undefined;
}

/** Y of Anti-X Y+ as typed in the pop-up: 2 to 6, with or without "+". */
export function antiValueError(text: string, label: string): string | undefined {
  if (text.trim() === '') return `${label}: Y is required`;
  return parseAntiValue(text) === null ? `${label}: Y must be between 2+ and 6+` : undefined;
}

/**
 * X of Sustained Hits / Blast / Cleave / Rapid Fire / Melta: a dice expression like A and D, whose highest roll
 * is at most LIMITS.abilityValue.max (keeps the exact engine's attack and damage distributions small).
 */
export function abilityValueError(expr: string, label: string): string | undefined {
  const syntax = dice(expr, label);
  if (syntax) return syntax;
  const max = LIMITS.abilityValue.max;
  const parsed = tryParseDice(expr);
  return parsed && maxValue(parsed) > max ? `${label}: X can roll at most ${max}` : undefined;
}

/** The errors of a loadout row: `count` (how many carried) and `weapon` (every weapon error on one line). */
export interface LoadoutRowErrors {
  count?: string;
  weapon?: string;
}

/**
 * A carried weapon of the attacking unit: a count in range and a valid weapon. Every weapon
 * error is joined into `weapon`, so the row shows them on one line (a weapon can only be wrong
 * when it was stored invalid; the weapon modal never saves one).
 */
export function validateLoadoutRow(count: number, weapon: WeaponStats): LoadoutRowErrors {
  const weaponErrors = Object.values(validateWeaponStats(weapon));
  const errors: LoadoutRowErrors = {
    count: intInRange(count, LIMITS.weaponModels, 'Count'),
    weapon: weaponErrors.length > 0 ? weaponErrors.join(' · ') : undefined,
  };
  return prune(errors);
}

export function validateDefender(d: DefenderProfile): FieldErrors<DefenderProfile> {
  const errors: FieldErrors<DefenderProfile> = {
    models: intInRange(d.models, LIMITS.defenderModels, 'Models'),
    toughness: intInRange(d.toughness, LIMITS.toughness, 'Toughness'),
    save: intInRange(d.save, { min: 2, max: 7 }, 'Save'),
    invuln: d.invuln === null ? undefined : intInRange(d.invuln, { min: 2, max: 6 }, 'Invulnerable save'),
    wounds: intInRange(d.wounds, LIMITS.wounds, 'Wounds'),
  };
  // On models: the unit's stats come from the Units tab, its size is what the main page sets.
  if (!errors.models && !errors.wounds && d.models * d.wounds > MAX_DEFENDER_WOUND_POOL) {
    errors.models = `Models × wounds must be at most ${MAX_DEFENDER_WOUND_POOL}`;
  }
  return prune(errors);
}

/**
 * A unit: name (required, at most 40 characters, not in `takenNames`: the names of the other
 * units in the same army), the stat line (same limits as the defender, without models) and its
 * weapons (each valid, no two with the same name). Weapon errors are joined into `weapons`.
 */
export function validateUnit(u: Unit, takenNames: readonly string[] = []): FieldErrors<Unit> {
  const name = u.name.trim();
  const key = name.toLowerCase();
  const errors: FieldErrors<Unit> = {
    name:
      name === ''
        ? 'Name is required'
        : name.length > MAX_WEAPON_NAME
          ? `Name must be at most ${MAX_WEAPON_NAME} characters`
          : takenNames.some((n) => n.trim().toLowerCase() === key)
            ? 'Another unit in this army already has this name'
            : undefined,
    toughness: intInRange(u.toughness, LIMITS.toughness, 'Toughness'),
    save: intInRange(u.save, { min: 2, max: 7 }, 'Save'),
    invuln: u.invuln === null ? undefined : intInRange(u.invuln, { min: 2, max: 6 }, 'Invulnerable save'),
    wounds: intInRange(u.wounds, LIMITS.wounds, 'Wounds'),
    weapons: unitWeaponsError(u.weapons),
    abilities: validateAbilities(u.abilities),
  };
  return prune(errors);
}

/** Highest +X of a characteristic, improvement of AP, or number of effects of one ability. */
export const MAX_EFFECT_AMOUNT = 6;
export const MAX_EFFECTS = 10;
/** Longest ability description (the rule text, with markup). */
export const MAX_DESCRIPTION = 2000;

/** The errors of a unit or army ability: its name, its description and its effects (first problem). */
export function validateAbility(a: UnitAbility, takenNames: readonly string[] = []): FieldErrors<UnitAbility> {
  const name = a.name.trim();
  const key = name.toLowerCase();
  const errors: FieldErrors<UnitAbility> = {
    name:
      name === ''
        ? 'Name is required'
        : name.length > MAX_WEAPON_NAME
          ? `Name must be at most ${MAX_WEAPON_NAME} characters`
          : takenNames.some((n) => n.trim().toLowerCase() === key)
            ? 'Another ability here already has this name'
            : undefined,
    description: a.description.length > MAX_DESCRIPTION ? `Description must be at most ${MAX_DESCRIPTION} characters` : undefined,
    effects:
      a.effects.length === 0
        ? 'Add at least one effect'
        : a.effects.length > MAX_EFFECTS
          ? `At most ${MAX_EFFECTS} effects`
          : a.effects.map(effectError).find((e) => e !== undefined),
  };
  return prune(errors);
}

/** The problem with one effect, or undefined. */
export function effectError(e: AbilityEffect): string | undefined {
  switch (e.kind) {
    case 'stat':
      return intInRange(e.amount, { min: 1, max: MAX_EFFECT_AMOUNT }, `+X to ${e.stat === 'attacks' ? 'A' : e.stat === 'strength' ? 'S' : 'D'}`);
    case 'ap':
      return intInRange(e.amount, { min: 1, max: MAX_EFFECT_AMOUNT }, 'AP improvement');
    case 'roll':
      return e.amount === 1 || e.amount === -1 ? undefined : `The ${e.roll} roll modifier must be +1 or -1`;
    case 'critical':
      return Number.isInteger(e.on) && e.on >= 2 && e.on <= 6 ? undefined : `Critical ${e.roll}s must be on 2+ to 6+`;
    case 'reroll':
      return undefined;
    case 'grant':
      return activeAbilities(e.abilities).length === 0 ? 'Pick at least one weapon ability to gain' : abilityError(e.abilities);
  }
}

/** The first problem with a list of abilities (a unit's or an army's): an invalid ability, or two with the same name. */
export function validateAbilities(abilities: readonly UnitAbility[]): string | undefined {
  const seen = new Set<string>();
  for (const a of abilities) {
    const problems = Object.values(validateAbility(a));
    if (problems.length > 0) return `${a.name.trim() || 'Unnamed ability'}: ${problems.join(' · ')}`;
    const key = a.name.trim().toLowerCase();
    if (seen.has(key)) return `Two abilities are named "${a.name.trim()}"`;
    seen.add(key);
  }
  return undefined;
}

/** The first problem with a unit's weapons: an invalid profile, or two weapons with the same name. */
function unitWeaponsError(weapons: readonly WeaponStats[]): string | undefined {
  const seen = new Set<string>();
  for (const w of weapons) {
    const problems = Object.values(validateWeaponStats(w));
    if (problems.length > 0) return `${w.name.trim() || 'Unnamed weapon'}: ${problems.join(' · ')}`;
    const key = w.name.trim().toLowerCase();
    if (seen.has(key)) return `Two weapons are named "${w.name.trim()}"`;
    seen.add(key);
  }
  return undefined;
}

export function validateIterations(n: number): string | undefined {
  return intInRange(n, LIMITS.iterations, 'Iterations');
}

export function hasErrors(errors: object): boolean {
  return Object.keys(errors).length > 0;
}

function prune<T>(errors: FieldErrors<T>): FieldErrors<T> {
  for (const key of Object.keys(errors) as (keyof T)[]) if (errors[key] === undefined) delete errors[key];
  return errors;
}
