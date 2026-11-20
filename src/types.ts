/** Defender keywords that weapon abilities can target. The array order is the display order. */
export const DEFENDER_KEYWORDS = ['vehicle', 'monster', 'psyker', 'infantry', 'fly'] as const;
export type DefenderKeyword = (typeof DEFENDER_KEYWORDS)[number];

export const KEYWORD_NAMES: Record<DefenderKeyword, string> = {
  vehicle: 'Vehicle',
  monster: 'Monster',
  psyker: 'Psyker',
  infantry: 'Infantry',
  fly: 'Fly',
};

/**
 * Weapon abilities that change the attack sequence. A critical hit / wound is an
 * unmodified roll of 6 (Anti-X Y+ lowers the critical wound to Y+ against keyword X).
 */
export interface WeaponAbilities {
  /** Lethal Hits: a critical hit wounds automatically (no wound roll). */
  lethalHits: boolean;
  /** Sustained Hits X: a critical hit scores X extra hits, as a dice expression; null for none. */
  sustainedHits: string | null;
  /** Devastating Wounds: a critical wound can't be saved (armour or invulnerable). */
  devastatingWounds: boolean;
  /**
   * Blast X: X extra attacks per model for every 5 models in the target unit, as a dice
   * expression rolled per block of 5 and per attacking model; null for none.
   */
  blast: string | null;
  /** Cleave X: Blast X for melee weapons. Ranged and melee aren't told apart, so it works the same as Blast. */
  cleave: string | null;
  /**
   * Anti-X Y+: Y (2–6) per keyword X. Against a target with keyword X, an unmodified wound
   * roll of Y+ is a critical wound (it always wounds). E.g. `{ vehicle: 4, monster: 4 }`.
   */
  anti: Partial<Record<DefenderKeyword, number>>;
  /**
   * Rapid Fire X: X extra attacks per model while the target is within half range
   * (`AttackConditions.halfRange`), as a dice expression rolled per attacking model; null for none.
   */
  rapidFire: string | null;
  /**
   * Melta X: the Damage characteristic is increased by X while the target is within half range
   * (`AttackConditions.halfRange`), as a dice expression rolled per damage roll; null for none.
   */
  melta: string | null;
  /** Lance: +1 to the wound roll while the bearer charged this turn (`AttackConditions.charged`). */
  lance: boolean;
  /**
   * Twin-linked: a failed wound roll is re-rolled once. The re-roll counts as the unmodified
   * roll, so it can be a critical wound. Lethal Hits auto-wounds make no wound roll to re-roll.
   */
  twinLinked: boolean;
}

export function noAbilities(): WeaponAbilities {
  return { lethalHits: false, sustainedHits: null, devastatingWounds: false, blast: null, cleave: null, anti: {}, rapidFire: null, melta: null, lance: false, twinLinked: false };
}

/**
 * Situational conditions of the attack that switch abilities on. They apply to every weapon
 * in the attack and are part of the page state only (not of attacks or exports).
 */
export interface AttackConditions {
  /** The target is within half range: Rapid Fire X adds its attacks, Melta X its damage. */
  halfRange: boolean;
  /** The attacking unit made a Charge move this turn: Lance adds 1 to the wound roll. */
  charged: boolean;
}

export function noConditions(): AttackConditions {
  return { halfRange: false, charged: false };
}

/** A copy that shares no objects with `a`. */
export function copyAbilities(a: WeaponAbilities): WeaponAbilities {
  return { ...a, anti: { ...a.anti } };
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

/** An attack row: `models` models firing the library weapon `weaponId`. */
export interface AttackRow {
  id: string;
  models: number;
  weaponId: string | null;
}

/**
 * A row in an export file: a copy of the weapon, so the file is self-contained. Imported
 * rows are linked to the library again with `materialiseRows`.
 */
export interface RowSnapshot {
  models: number;
  weaponId: string;
  weapon: WeaponStats;
}

/**
 * An attack: the complete attack of a unit. Its rows link to the library, so editing a weapon
 * profile changes every attack that uses it. The main page shows the active attack.
 */
export interface AttackProfile {
  id: string;
  name: string;
  rows: AttackRow[];
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
  /** The situational conditions of the attack (half range, charged). */
  conditions: AttackConditions;
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
  /** Keywords of the unit (Vehicle, Monster, …), in DEFENDER_KEYWORDS order without duplicates. */
  keywords: DefenderKeyword[];
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
