/**
 * Weapon abilities that change the attack sequence. A critical hit / wound is an
 * unmodified roll of 6.
 */
export interface WeaponAbilities {
  /** Lethal Hits: a critical hit wounds automatically (no wound roll). */
  lethalHits: boolean;
  /** Sustained Hits X: a critical hit scores X extra hits, as a dice expression; null for none. */
  sustainedHits: string | null;
  /** Devastating Wounds: a critical wound can't be saved (armour or invulnerable). */
  devastatingWounds: boolean;
}

export function noAbilities(): WeaponAbilities {
  return { lethalHits: false, sustainedHits: null, devastatingWounds: false };
}

/** The stats of a weapon profile, without the number of models firing it. */
export interface WeaponStats {
  name: string;
  /** Attacks per model, as a dice expression ("2", "D6", "2D3+1"). */
  attacks: string;
  /** Ballistic / Weapon Skill target (2–6). */
  skill: number;
  strength: number;
  /** Armour penetration, entered as 0 or a negative number. */
  ap: number;
  /** Damage per unsaved wound, as a dice expression. */
  damage: string;
  abilities: WeaponAbilities;
}

/** A weapon profile in the user's library. */
export interface StoredWeapon extends WeaponStats {
  id: string;
}

/** A live attack row: `models` models firing the library weapon `weaponId`. */
export interface AttackRow {
  id: string;
  models: number;
  weaponId: string | null;
}

/** A row inside a saved preset: a copy of the weapon, so later library edits don't change it. */
export interface RowSnapshot {
  models: number;
  weaponId: string;
  weapon: WeaponStats;
}

/** A saved attack: the whole attack order. */
export interface AttackPreset {
  id: string;
  name: string;
  rows: RowSnapshot[];
}

/** A saved attacking unit: a block of rows that can be appended to the attack. */
export interface UnitPreset {
  id: string;
  name: string;
  rows: RowSnapshot[];
}

export interface DefenderPreset {
  id: string;
  name: string;
  defender: DefenderProfile;
}

/** Engine input: one attacking weapon profile, fired by `models` models. */
export interface WeaponProfile {
  id: string;
  name: string;
  /** Number of models firing this weapon. */
  models: number;
  /** Attacks per model, as a dice expression ("2", "D6", "2D3+1"). */
  attacks: string;
  /** Ballistic / Weapon Skill target (2–6). */
  skill: number;
  strength: number;
  /** Armour penetration, entered as 0 or a negative number. */
  ap: number;
  /** Damage per unsaved wound, as a dice expression. */
  damage: string;
  abilities: WeaponAbilities;
}

export interface DefenderProfile {
  models: number;
  toughness: number;
  /** Armour save (2–6), 7 means no armour save. */
  save: number;
  /** Invulnerable save (2–6) or null for none. */
  invuln: number | null;
  /** Wounds per model. */
  wounds: number;
}

/** Average values per step of the attack sequence. */
export interface StepStats {
  attacks: number;
  hits: number;
  wounds: number;
  unsaved: number;
  damage: number;
  modelsDestroyed: number;
}

export interface SimulationResult {
  iterations: number;
  total: StepStats;
  perWeapon: { id: string; name: string; stats: StepStats }[];
  /** killDistribution[k] = P(exactly k models destroyed), k = 0..defender.models. */
  killDistribution: number[];
  /** killAtLeast[k] = P(at least k models destroyed), k = 0..defender.models. */
  killAtLeast: number[];
}

export function emptyStats(): StepStats {
  return { attacks: 0, hits: 0, wounds: 0, unsaved: 0, damage: 0, modelsDestroyed: 0 };
}
