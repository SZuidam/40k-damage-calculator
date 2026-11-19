import { tryParseDice } from '../engine/dice';
import type { DefenderProfile, WeaponProfile } from '../types';

export type FieldErrors<T> = Partial<Record<keyof T, string>>;

export const LIMITS = {
  weaponModels: { min: 1, max: 50 },
  strength: { min: 1, max: 30 },
  ap: { min: -6, max: 0 },
  defenderModels: { min: 1, max: 40 },
  toughness: { min: 1, max: 20 },
  wounds: { min: 1, max: 40 },
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

export function validateWeapon(w: WeaponProfile): FieldErrors<WeaponProfile> {
  const errors: FieldErrors<WeaponProfile> = {
    models: intInRange(w.models, LIMITS.weaponModels, 'Models'),
    attacks: dice(w.attacks, 'Attacks'),
    skill: intInRange(w.skill, { min: 2, max: 6 }, 'BS/WS'),
    strength: intInRange(w.strength, LIMITS.strength, 'Strength'),
    ap: intInRange(w.ap, LIMITS.ap, 'AP'),
    damage: dice(w.damage, 'Damage'),
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
