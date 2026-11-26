import { noModifiers, type Army, type AttackConditions, type AttackerSelection, type DefenderKeyword, type DefenderProfile, type DefenderSelection, type LoadoutRow, type StoredWeapon, type Unit, type UnitAbility, type WeaponProfile } from '../types';
import { byName, pickStats } from './presets';
import { applyAbilities, canLead, isActive, type AbilityContext } from './unitAbilities';

/** How many of a weapon a unit carries when it is first picked: units usually start at 5 models. */
export const DEFAULT_WEAPON_COUNT = 5;
/** The size of the defending unit until the user changes it. */
export const DEFAULT_UNIT_MODELS = 5;

/** A fresh loadout for `unit`: every weapon, in the unit's order, not carried, DEFAULT_WEAPON_COUNT each. */
export function newLoadout(unit: Unit): LoadoutRow[] {
  return unit.weapons.map((w) => ({ weaponId: w.id, carried: false, count: DEFAULT_WEAPON_COUNT }));
}

/**
 * `rows` matched to the unit's current weapons: rows keep their order, ticks and counts; rows of
 * weapons the unit no longer has (and duplicate rows) are dropped; weapons without a row are
 * appended as in newLoadout.
 */
export function syncLoadout(rows: readonly LoadoutRow[], unit: Unit): LoadoutRow[] {
  const ids = new Set(unit.weapons.map((w) => w.id));
  const kept: LoadoutRow[] = [];
  for (const row of rows) {
    if (!ids.has(row.weaponId)) continue;
    ids.delete(row.weaponId);
    kept.push({ ...row });
  }
  const added = unit.weapons.filter((w) => ids.has(w.id)).map((w) => ({ weaponId: w.id, carried: false, count: DEFAULT_WEAPON_COUNT }));
  return [...kept, ...added];
}

/** The army a unit is listed under: its army when that exists, else null ("No army"). */
export function armyOf(unit: Unit, armies: readonly Army[]): string | null {
  return unit.armyId !== null && armies.some((a) => a.id === unit.armyId) ? unit.armyId : null;
}

/** The units of the army dropdown's choice (`null` = the units without an army), by name. */
export function unitsOfArmy(units: readonly Unit[], armies: readonly Army[], armyId: string | null): Unit[] {
  return byName(units.filter((u) => armyOf(u, armies) === armyId));
}

/**
 * The choices of the army dropdown: every army by name, then "No army" (value null) when a unit
 * has no army or there are no armies at all.
 */
export function armyChoices(armies: readonly Army[], units: readonly Unit[]): { id: string | null; name: string }[] {
  const choices: { id: string | null; name: string }[] = byName(armies).map((a) => ({ id: a.id, name: a.name }));
  if (armies.length === 0 || units.some((u) => armyOf(u, armies) === null)) choices.push({ id: null, name: 'No army' });
  return choices;
}

/** Where the army dropdown starts: the first army (by name) with units, else the first choice. */
export function defaultArmyId(armies: readonly Army[], units: readonly Unit[]): string | null {
  const choices = armyChoices(armies, units);
  return (choices.find((c) => units.some((u) => armyOf(u, armies) === c.id)) ?? choices[0]).id;
}

/** Keep the army dropdown on a choice that exists, falling back to defaultArmyId. */
function validArmy(armyId: string | null, armies: readonly Army[], units: readonly Unit[]): string | null {
  return armyChoices(armies, units).some((c) => c.id === armyId) ? armyId : defaultArmyId(armies, units);
}

/**
 * The units that can lead `unit` on the main page: the other units of its army (or of "No army")
 * with at least one ability for the unit they lead, by name.
 */
export function leaderChoices(unit: Unit, armies: readonly Army[], units: readonly Unit[]): Unit[] {
  const army = armyOf(unit, armies);
  return byName(units.filter((u) => u.id !== unit.id && armyOf(u, armies) === army && canLead(u)));
}

/**
 * Bring the attacker in line with the armies and units, in place (after loading, or after the
 * Units tab changed something): a deleted unit is unpicked, the army follows the picked unit,
 * the loadout follows the unit's weapons (syncLoadout), and a leader that is gone, in another
 * army or can no longer lead is dropped.
 */
export function reconcileAttacker(sel: AttackerSelection, armies: readonly Army[], units: readonly Unit[]): void {
  const unit = units.find((u) => u.id === sel.unitId);
  if (unit) {
    sel.armyId = armyOf(unit, armies);
    sel.rows = syncLoadout(sel.rows, unit);
    if (!leaderChoices(unit, armies, units).some((u) => u.id === sel.leaderId)) sel.leaderId = null;
  } else {
    sel.unitId = null;
    sel.leaderId = null;
    sel.rows = [];
    sel.armyId = validArmy(sel.armyId, armies, units);
  }
}

/** As reconcileAttacker, for the defender (which has no loadout). */
export function reconcileDefender(sel: DefenderSelection, armies: readonly Army[], units: readonly Unit[]): void {
  const unit = units.find((u) => u.id === sel.unitId);
  if (unit) {
    sel.armyId = armyOf(unit, armies);
  } else {
    sel.unitId = null;
    sel.armyId = validArmy(sel.armyId, armies, units);
  }
}

/** The carried rows with their weapons, in firing order. Rows whose weapon is missing are skipped. */
export function carriedWeapons(unit: Unit, rows: readonly LoadoutRow[]): { row: LoadoutRow; weapon: StoredWeapon }[] {
  return rows.flatMap((row) => {
    const weapon = row.carried ? unit.weapons.find((w) => w.id === row.weaponId) : undefined;
    return weapon ? [{ row, weapon }] : [];
  });
}

/** What resolveLoadout needs besides the conditions to apply unit, leader and army abilities. */
export interface LoadoutAbilities {
  /** Every ability that can apply (see abilitiesFor); each is checked per weapon with isActive. */
  abilities: readonly UnitAbility[];
  situations: readonly string[];
  /** The defender's keywords, or null without a defender. */
  keywords: readonly DefenderKeyword[] | null;
}

/**
 * Engine input for the attacker: one profile per carried weapon, in firing order, fired by
 * `count` models. The weapon id becomes the profile id (unique within the unit). Every profile
 * gets its own copy of the weapon and the attack conditions, and the abilities that are active
 * for it (by its type, the toggles and the target) folded in with applyAbilities.
 */
export function resolveLoadout(unit: Unit, rows: readonly LoadoutRow[], conditions: AttackConditions, extra?: LoadoutAbilities): WeaponProfile[] {
  const ctx: AbilityContext = { conditions, situations: extra?.situations ?? [], keywords: extra?.keywords ?? null };
  return carriedWeapons(unit, rows).map(({ row, weapon }) => {
    const profile: WeaponProfile = { ...pickStats(weapon), id: weapon.id, models: row.count, conditions: { ...conditions }, modifiers: noModifiers() };
    const active = (extra?.abilities ?? []).filter((a) => isActive(a, weapon.type, ctx));
    return active.length === 0 ? profile : applyAbilities(profile, active);
  });
}

/** The engine's defender: the unit's stat line with `models` models. Shares no arrays with the unit. */
export function defenderOf(unit: Unit, models: number): DefenderProfile {
  return { models, toughness: unit.toughness, save: unit.save, invuln: unit.invuln, wounds: unit.wounds, keywords: [...unit.keywords] };
}

/**
 * Apply a new firing order of the carried rows (`order` holds indices into the carried rows, as
 * the optimiser returns them). The carried rows move between the slots they already hold; rows
 * that aren't carried stay where they are.
 */
export function reorderCarried(rows: readonly LoadoutRow[], order: readonly number[]): LoadoutRow[] {
  const carried = rows.filter((r) => r.carried);
  const reordered = order.map((i) => carried[i]);
  let next = 0;
  return rows.map((r) => (r.carried ? reordered[next++] : r));
}
