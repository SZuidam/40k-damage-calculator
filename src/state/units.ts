import type { Army, StoredWeapon, Unit } from '../types';
import { copyAbility, sameAbilityList } from './unitAbilities';
import { uid } from './ids';
import { byName, pickStats, sameCombatStats, sameDefender, statLine } from './presets';

/** Which units the Units tab lists: every unit, the units without an army, or one army's units. */
export type ArmyFilter = 'all' | 'none' | string;

/** A group of units under one army heading; `army` is null for "No army". */
export interface UnitGroup {
  army: Army | null;
  units: Unit[];
}

/** A new, empty unit (the editor's starting draft). */
export function newUnit(armyId: string | null = null): Unit {
  return { id: uid('unit'), name: '', armyId, toughness: 4, save: 3, invuln: null, wounds: 1, keywords: [], weapons: [], abilities: [] };
}

/** A weapon of a unit copied with its id; shares no objects with `w`. */
function copyWeapon(w: StoredWeapon): StoredWeapon {
  return { ...pickStats(w), id: w.id };
}

/** A copy that shares no arrays or objects with `u` (keywords, weapons, abilities). */
export function copyUnit(u: Unit): Unit {
  return {
    id: u.id,
    name: u.name,
    armyId: u.armyId,
    toughness: u.toughness,
    save: u.save,
    invuln: u.invuln,
    wounds: u.wounds,
    keywords: [...u.keywords],
    weapons: u.weapons.map(copyWeapon),
    abilities: u.abilities.map(copyAbility),
  };
}

/** Whether two units are identical: name, army, stats, keywords, every weapon and every ability (in order). */
export function sameUnit(a: Unit, b: Unit): boolean {
  return (
    a.name === b.name &&
    a.armyId === b.armyId &&
    sameDefender({ ...a, models: 0 }, { ...b, models: 0 }) &&
    a.weapons.length === b.weapons.length &&
    a.weapons.every((w, i) => w.id === b.weapons[i].id && w.name === b.weapons[i].name && sameCombatStats(w, b.weapons[i])) &&
    sameAbilityList(a.abilities, b.abilities)
  );
}

/** Whether `name` is in `names`, ignoring case and surrounding spaces. */
export function isNameTaken(names: readonly string[], name: string): boolean {
  const key = name.trim().toLowerCase();
  return names.some((n) => n.trim().toLowerCase() === key);
}

/** "T4 · Sv 3+ · W2 · Infantry · 2 weapons", plus " · 1 ability" when it has abilities. */
export function unitSummary(u: Unit): string {
  const count = u.weapons.length;
  const abilities = u.abilities.length === 0 ? '' : ` · ${u.abilities.length} abilit${u.abilities.length === 1 ? 'y' : 'ies'}`;
  return `${statLine(u)} · ${count === 0 ? 'no weapons' : `${count} weapon${count === 1 ? '' : 's'}`}${abilities}`;
}

/**
 * The units to list for `filter`, sorted by name and grouped by army (armies by name, "No army"
 * last). Groups without units are left out.
 */
export function groupUnits(units: readonly Unit[], armies: readonly Army[], filter: ArmyFilter): UnitGroup[] {
  const groups: UnitGroup[] = [...byName(armies).map((army) => ({ army, units: [] as Unit[] })), { army: null, units: [] }];
  const known = new Set(armies.map((a) => a.id));
  for (const unit of byName(units)) {
    const armyId = unit.armyId !== null && known.has(unit.armyId) ? unit.armyId : null;
    groups.find((g) => (g.army?.id ?? null) === armyId)!.units.push(unit);
  }
  return groups.filter((g) => {
    if (g.units.length === 0) return false;
    if (filter === 'all') return true;
    if (filter === 'none') return g.army === null;
    return g.army?.id === filter;
  });
}

/** The number of units that belong to army `armyId`. */
export function unitsInArmy(units: readonly Unit[], armyId: string): number {
  return units.filter((u) => u.armyId === armyId).length;
}

/** Remove army `id` (in place) and move its units to "No army". Returns how many units moved. */
export function deleteArmy(armies: Army[], units: Unit[], id: string): number {
  const index = armies.findIndex((a) => a.id === id);
  if (index >= 0) armies.splice(index, 1);
  let moved = 0;
  for (const unit of units) {
    if (unit.armyId === id) {
      unit.armyId = null;
      moved += 1;
    }
  }
  return moved;
}
