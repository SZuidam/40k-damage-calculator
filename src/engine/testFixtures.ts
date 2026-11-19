import { noAbilities, type DefenderKeyword, type DefenderProfile, type WeaponAbilities, type WeaponProfile } from '../types';

export function weapon(
  name: string,
  models: number,
  attacks: string,
  skill: number,
  strength: number,
  ap: number,
  damage: string,
  abilities: Partial<WeaponAbilities> = {},
): WeaponProfile {
  return { id: name, name, models, attacks, skill, strength, ap, damage, abilities: { ...noAbilities(), ...abilities } };
}

export function defender(models: number, toughness: number, save: number, wounds: number, invuln: number | null = null, keywords: DefenderKeyword[] = []): DefenderProfile {
  return { models, toughness, save, invuln, wounds, keywords };
}

export const boltRifles = weapon('Bolt rifles', 5, '2', 3, 4, -1, '1');
export const lascannon = weapon('Lascannon', 1, '1', 3, 12, -3, 'D6+1');
export const heavyBolter = weapon('Heavy bolter', 1, '3', 3, 5, -1, '2');
export const multiMelta = weapon('Multi-melta', 1, '2', 3, 9, -4, 'D6');
export const plasma = weapon('Plasma guns', 2, '1', 3, 7, -2, '2');

/** 5 Space Marine-like models with 3 wounds each. */
export const gravis = defender(5, 4, 3, 3);
