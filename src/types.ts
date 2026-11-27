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
  /**
   * Torrent: every attack hits automatically. No hit roll is made, so the weapon has no BS / WS
   * that counts, hit modifiers and re-rolls don't matter, and there are no critical hits (Lethal
   * Hits and Sustained Hits can't trigger).
   */
  torrent: boolean;
  /**
   * The abilities of this weapon that only work against non-MONSTER / non-VEHICLE targets
   * ("Sustained Hits 1 (non-Monster/Vehicle)"): against a target with either keyword they don't
   * apply. In RESTRICTABLE_ABILITIES order without duplicates; [] for none. Only the abilities
   * the weapon has are listed (removing an ability drops it here too).
   */
  notVsMonsterVehicle: RestrictableAbility[];
}

/** The weapon abilities that can be limited to non-MONSTER / non-VEHICLE targets. */
export const RESTRICTABLE_ABILITIES = ['sustainedHits', 'devastatingWounds'] as const;
export type RestrictableAbility = (typeof RESTRICTABLE_ABILITIES)[number];

/** A target with any of these keywords stops the abilities in `WeaponAbilities.notVsMonsterVehicle`. */
export const MONSTER_VEHICLE: readonly DefenderKeyword[] = ['monster', 'vehicle'];

export function noAbilities(): WeaponAbilities {
  return { lethalHits: false, sustainedHits: null, devastatingWounds: false, blast: null, cleave: null, anti: {}, rapidFire: null, melta: null, lance: false, twinLinked: false, torrent: false, notVsMonsterVehicle: [] };
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
  return { ...a, anti: { ...a.anti }, notVsMonsterVehicle: [...a.notVsMonsterVehicle] };
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
  /** Ballistic / Weapon Skill target (2–6). Kept but unused while the weapon has Torrent. */
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
  /**
   * The number of models in the unit (an attached leader not counted). Weapons keep their own
   * per-row counts; this is what "per model" abilities roll for (an attached leader adds one).
   */
  models: number;
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
  /**
   * A damage roll whose dice (the dice of the Damage characteristic, without its +X or Melta)
   * show less than this is re-rolled once, and the re-roll stands; 0 for no re-roll. It is the Settings threshold for
   * the weapon's dice (D3 or D6), set while an ability with "Re-roll damage" applies.
   */
  rerollDamageBelow: number;
}

export function noModifiers(): RollModifiers {
  return { hit: 0, wound: 0, criticalHit: 6, criticalWound: 6, rerollHits: 'none', rerollWounds: 'none', rerollDamageBelow: 0 };
}

/**
 * Settings: "Re-roll damage" re-rolls a damage roll below these, by the dice of the weapon's
 * Damage characteristic (D3 or D6). Compared with the dice only, before any +X: D6+2 rolling
 * a 3 counts as 3, so "below 4" re-rolls 1–3 on D6, D6+1 and D6+2 alike.
 */
export interface DamageRerollThresholds {
  d3: number;
  d6: number;
}

/** The highest "re-roll below" a threshold can be set to (the dice of 2D3 show up to 6, of 2D6 up to 12). */
export const MAX_DAMAGE_REROLL_BELOW = { d3: 6, d6: 12 } as const;

export function defaultDamageRerolls(): DamageRerollThresholds {
  return { d3: 2, d6: 4 };
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
  /** Ballistic / Weapon Skill target (2–6); unused with Torrent. */
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

/**
 * Engine input: mortal wounds inflicted before the attacks: `dice` D6, each `on`+ inflicts
 * `perSuccess` mortal wounds. A mortal wound skips hit, wound and save rolls and removes 1 wound.
 */
export interface MortalWoundSource {
  id: string;
  name: string;
  dice: number;
  /** 2–6. */
  on: number;
  /** Mortal wounds per success, as a dice expression ("1", "D3"). */
  perSuccess: string;
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

/** When an ability applies to a weapon's attacks. */
export interface AbilityCondition {
  /**
   * Switched on by hand: the ability's name is a toggle on the main page and it only applies
   * while that is on ("Oath of Moment" against the Oath target, "Ingress move"). The other
   * requirements still have to hold.
   */
  toggle: boolean;
  /** Built-in attack conditions that must all be on (AND), in BUILTIN_CONDITIONS order; [] for none. */
  conditions: (keyof AttackConditions)[];
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
  /** Re-roll a damage roll below the Settings threshold for the weapon's dice (DamageRerollThresholds). */
  | { kind: 'rerollDamage' }
  /** The weapon gains these weapon abilities (only the ones set count). */
  | { kind: 'grant'; abilities: WeaponAbilities }
  /**
   * Inflict mortal wounds outside the attack sequence: roll one D6 per model of the attacking
   * unit, each `on`+ (2–6) inflicts `perSuccess` (a dice expression) mortal wounds. Unit-level:
   * it ignores the ability's weapon type, and the engine resolves it before every weapon.
   */
  | { kind: 'mortalWounds'; on: number; perSuccess: string };

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
  /** The rule text for the user's own reference, in light markup (see ui/markup.ts); '' for none. */
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
  /**
   * Mortal wound sources first (kind 'mortal': attacks and hits are 0, wounds and unsaved are
   * the mortal wounds inflicted), then the weapons in firing order.
   */
  perWeapon: { id: string; name: string; kind: 'weapon' | 'mortal'; stats: StepStats }[];
  /** killDistribution[k] = P(exactly k models destroyed), k = 0..defender.models. */
  killDistribution: number[];
  /** killAtLeast[k] = P(at least k models destroyed), k = 0..defender.models. */
  killAtLeast: number[];
}

export function emptyStats(): StepStats {
  return { attacks: 0, hits: 0, wounds: 0, unsaved: 0, damage: 0, modelsDestroyed: 0 };
}
