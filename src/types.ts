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
 * in the attack and are part of the page state only (not of units).
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

/** Whether a weapon shoots or fights in melee: unit abilities can target one kind only. */
export const WEAPON_TYPES = ['ranged', 'melee'] as const;
export type WeaponType = (typeof WEAPON_TYPES)[number];

export const WEAPON_TYPE_NAMES: Record<WeaponType, string> = { ranged: 'Ranged', melee: 'Melee' };

/** The stats of a weapon profile, without the number of models firing it. */
export interface WeaponStats {
  name: string;
  /** Ranged or melee (weapons saved before this existed are ranged). */
  type: WeaponType;
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

/** A weapon profile of a unit: its stats plus an id that is unique within the unit. */
export interface StoredWeapon extends WeaponStats {
  id: string;
}

/**
 * One weapon of the attacking unit on the main page: whether the unit carries it and how many
 * of it. Only carried rows fire; `count` models fire the weapon. The weapon itself is looked up
 * in the unit by `weaponId`, so editing the unit's weapon changes the attack straight away.
 */
export interface LoadoutRow {
  weaponId: string;
  carried: boolean;
  count: number;
}

/** The attacker on the main page: an army and unit picked from the user's units, and its loadout. */
export interface AttackerSelection {
  /** The army dropdown: an army id, or null for "No army". */
  armyId: string | null;
  unitId: string | null;
  /**
   * The character leading the unit: a unit of the same army with abilities for the unit it
   * leads, or null. Only its abilities count; its weapons don't fire.
   */
  leaderId: string | null;
  /** One row per weapon of the unit, in firing order (empty without a unit). */
  rows: LoadoutRow[];
}

/** The defender on the main page: an army and unit picked from the user's units, and its size. */
export interface DefenderSelection {
  /** The army dropdown: an army id, or null for "No army". */
  armyId: string | null;
  unitId: string | null;
  models: number;
}

/** How a roll is re-rolled: not at all, only an unmodified 1, or any failed roll. */
export type RerollKind = 'none' | 'ones' | 'failed';

/**
 * The roll levers unit abilities can pull on a weapon, resolved for one attack. The engine
 * caps the summed modifiers at -1 / +1; critical thresholds count on the unmodified roll.
 */
export interface RollModifiers {
  /** Added to the hit roll (summed; the engine caps it at -1 / +1). */
  hit: number;
  /** Added to the wound roll on top of Lance (summed; capped at -1 / +1 with it). */
  wound: number;
  /** An unmodified hit roll of this or higher is a critical hit (6 without abilities). */
  criticalHit: number;
  /** An unmodified wound roll of this or higher is a critical wound (6; Anti-X Y+ can go lower). */
  criticalWound: number;
  rerollHits: RerollKind;
  /** Twin-linked counts as 'failed' on top of this. */
  rerollWounds: RerollKind;
}

export function noModifiers(): RollModifiers {
  return { hit: 0, wound: 0, criticalHit: 6, criticalWound: 6, rerollHits: 'none', rerollWounds: 'none' };
}

/** Engine input: one attacking weapon profile, fired by `models` models. */
export interface WeaponProfile {
  id: string;
  name: string;
  type: WeaponType;
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
  /** Roll modifiers, critical thresholds and re-rolls from unit, leader and army abilities. */
  modifiers: RollModifiers;
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

/**
 * A condition an ability needs: a built-in attack condition (half range, charged) or a
 * situation the user named ("Ingress move", "Oath target"). Named situations get their own
 * toggle on the main page; they are matched by name, ignoring case and surrounding spaces.
 */
export type SituationRef = { builtin: keyof AttackConditions } | { name: string };

/** When an ability applies to a weapon's attacks. */
export interface AbilityCondition {
  /** Every situation must be on (AND); an empty list means always. */
  situations: SituationRef[];
  /** Only weapons of this type, or any weapon. */
  weaponType: WeaponType | 'any';
  /** Only against a target with this keyword ("+1 to wound against Monsters"), or any target. */
  targetKeyword: DefenderKeyword | null;
}

/** The characteristics an ability can raise with +X. */
export type StatEffectKey = 'attacks' | 'strength' | 'damage';

/** What an active ability does to a weapon. The engine only knows these levers. */
export type AbilityEffect =
  /** +X to A, S or D (X 1–6); A and D add X to their dice expression. */
  | { kind: 'stat'; stat: StatEffectKey; amount: number }
  /** Improve AP by X (1–6): AP -1 improved by 1 is AP -2. */
  | { kind: 'ap'; amount: number }
  /** +1 / -1 to the hit or wound roll (the engine caps the sum at -1 / +1). */
  | { kind: 'roll'; roll: 'hit' | 'wound'; amount: number }
  /** Critical hits / wounds on an unmodified Y+ (2–6). */
  | { kind: 'critical'; roll: 'hit' | 'wound'; on: number }
  /** Re-roll hit / wound rolls of 1, or every failed one. */
  | { kind: 'reroll'; roll: 'hit' | 'wound'; which: 'ones' | 'failed' }
  /** The weapon gains these weapon abilities (only the ones set count). */
  | { kind: 'grant'; abilities: WeaponAbilities };

export type AbilityEffectKind = AbilityEffect['kind'];

/** Whom a unit's ability helps: the unit itself, or the unit it leads (a leader's aura). */
export type AbilityTarget = 'unit' | 'ledUnit';

/**
 * An ability the user defined on a unit or an army: a name, the condition under which it applies
 * and what it does. Army abilities ("army rules") apply to every unit of the army; `appliesTo`
 * only matters on units.
 */
export interface UnitAbility {
  id: string;
  name: string;
  /** Free text for the user's own reference; '' for none. */
  description: string;
  appliesTo: AbilityTarget;
  when: AbilityCondition;
  /** At least one (validation flags none). */
  effects: AbilityEffect[];
}

/** An army the user defined (any 40k army, the name is free text). Units can belong to one. */
export interface Army {
  id: string;
  name: string;
  /** Army rules: abilities every unit of the army has when it attacks. */
  abilities: UnitAbility[];
}

/** The defensive stat line of a unit: a DefenderProfile without the model count. */
export type UnitStats = Omit<DefenderProfile, 'models'>;

/**
 * A unit the user defined: its stat line, keywords and its own weapon profiles. Weapons are
 * never shared: two units with a "Bolt rifle" each hold their own profile. Weapon names are
 * unique within a unit.
 */
export interface Unit extends UnitStats {
  id: string;
  name: string;
  /** The army the unit belongs to, or null for "No army". */
  armyId: string | null;
  weapons: StoredWeapon[];
  /** The unit's own abilities, and (appliesTo 'ledUnit') those it gives the unit it leads. */
  abilities: UnitAbility[];
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
