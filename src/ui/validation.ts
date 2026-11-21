import { maxValue, tryParseDice } from '../engine/dice';
import { parseAntiValue } from '../state/abilities';
import { DEFENDER_KEYWORDS, KEYWORD_NAMES, type DefenderProfile, type ProfileRow, type WeaponAbilities, type WeaponStats } from '../types';

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

/**
 * A profile row: models in range and a valid weapon copy. Every weapon error is joined into
 * `weapon`, so the row shows them on one line (a copy can only be wrong when it was imported
 * or stored invalid; the weapon modal never saves one).
 */
export function validateRow(row: Pick<ProfileRow, 'models' | 'weapon'>): FieldErrors<ProfileRow> {
  const weaponErrors = Object.values(validateWeaponStats(row.weapon));
  const errors: FieldErrors<ProfileRow> = {
    models: intInRange(row.models, LIMITS.weaponModels, 'Models'),
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
  if (!errors.models && !errors.wounds && d.models * d.wounds > MAX_DEFENDER_WOUND_POOL) {
    errors.wounds = `Models × wounds must be at most ${MAX_DEFENDER_WOUND_POOL}`;
  }
  return prune(errors);
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
