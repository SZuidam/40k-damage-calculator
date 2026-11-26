import { KEYWORD_NAMES, copyAbilities, type AttackConditions, type DefenderProfile, type ProfileRow, type StoredWeapon, type UnitStats, type WeaponProfile, type WeaponStats } from '../types';
import { MAX_WEAPON_NAME } from '../ui/validation';
import { abilitiesSummary, sameAbilities } from './abilities';
import { uid } from './ids';

/** Copy only the WeaponStats fields (drops `id` and anything else). The abilities are copied too. */
export function pickStats(w: WeaponStats): WeaponStats {
  return { name: w.name, attacks: w.attacks, skill: w.skill, strength: w.strength, ap: w.ap, damage: w.damage, abilities: copyAbilities(w.abilities) };
}

/** A copy of the defender that shares no arrays with `d`. */
export function copyDefender(d: DefenderProfile): DefenderProfile {
  return { ...d, keywords: [...d.keywords] };
}

/**
 * Whether two weapons fire the same: every stat and ability except the name. A renamed weapon
 * is still the same weapon (row comparisons, import review, storage migration).
 */
export function sameCombatStats(a: WeaponStats, b: WeaponStats): boolean {
  return (
    a.attacks.trim().toUpperCase() === b.attacks.trim().toUpperCase() &&
    a.skill === b.skill &&
    a.strength === b.strength &&
    a.ap === b.ap &&
    a.damage.trim().toUpperCase() === b.damage.trim().toUpperCase() &&
    sameAbilities(a.abilities, b.abilities)
  );
}

/** The parts of a row that matter for comparing and summarising: no id needed (export files have none). */
type RowLike = Pick<ProfileRow, 'models' | 'weapon'>;

/**
 * Engine input for profile rows, straight from their weapon copies. The row id becomes the
 * weapon id (two rows may fire the same weapon). Every weapon gets its own copy of the attack
 * conditions.
 */
export function resolveRows(rows: ProfileRow[], conditions: AttackConditions): WeaponProfile[] {
  return rows.map((row) => ({ ...pickStats(row.weapon), id: row.id, models: row.models, conditions: { ...conditions } }));
}

/** Copies of `rows` with new row ids and their own weapon copies (load, save, import). */
export function copyRows(rows: readonly RowLike[]): ProfileRow[] {
  return rows.map((r) => ({ id: uid('row'), models: r.models, weapon: pickStats(r.weapon) }));
}

/**
 * Whether two row lists describe the same attack: same models and weapon stats, in the same
 * order. Weapon names and row ids don't count.
 */
export function sameRows(a: readonly RowLike[], b: readonly RowLike[]): boolean {
  return a.length === b.length && a.every((row, i) => row.models === b[i].models && sameCombatStats(row.weapon, b[i].weapon));
}

export function sameDefender(a: DefenderProfile, b: DefenderProfile): boolean {
  return (
    a.models === b.models &&
    a.toughness === b.toughness &&
    a.save === b.save &&
    (a.invuln ?? null) === (b.invuln ?? null) &&
    a.wounds === b.wounds &&
    a.keywords.length === b.keywords.length &&
    a.keywords.every((k) => b.keywords.includes(k))
  );
}

/**
 * `name`, or `Name (2)`, `Name (3)`, … when it is taken (case-insensitive), cut so the
 * result stays within the 40-character name limit.
 */
export function uniqueName(taken: string[], name: string): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  const base = name.slice(0, MAX_WEAPON_NAME).trimEnd();
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${base.slice(0, MAX_WEAPON_NAME - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/** Sort by name for selects and lists (case-insensitive, numbers in numeric order). */
export function byName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

/** Library sorted by name, for selects and lists. */
export function sortedLibrary(library: StoredWeapon[]): StoredWeapon[] {
  return byName(library);
}

/** Short stats line: "A 2 · BS 3+ · S 4 · AP -1 · D 1", plus " · Lethal Hits, …" when it has abilities. */
export function statsSummary(w: WeaponStats): string {
  const abilities = abilitiesSummary(w.abilities);
  return `A ${w.attacks} · BS ${w.skill}+ · S ${w.strength} · AP ${w.ap} · D ${w.damage}${abilities ? ` · ${abilities}` : ''}`;
}

/** "10× Bolt rifle, 1× Plasma gun", from the rows' weapon copies. */
export function rowsSummary(rows: readonly RowLike[]): string {
  return rows.map((r) => `${r.models}× ${r.weapon.name}`).join(', ');
}

/** "T4 · Sv 3+ · Inv 4+ · W2", plus " · Vehicle, Monster" when it has keywords. */
export function statLine(d: UnitStats): string {
  const save = d.save >= 7 ? 'Sv –' : `Sv ${d.save}+`;
  const invuln = d.invuln === null ? '' : ` · Inv ${d.invuln}+`;
  const keywords = d.keywords.length === 0 ? '' : ` · ${d.keywords.map((k) => KEYWORD_NAMES[k]).join(', ')}`;
  return `T${d.toughness} · ${save}${invuln} · W${d.wounds}${keywords}`;
}

/** "10 models · T4 · Sv 3+ · Inv 4+ · W2", plus " · Vehicle, Monster" when it has keywords. */
export function defenderSummary(d: DefenderProfile): string {
  return `${d.models} model${d.models === 1 ? '' : 's'} · ${statLine(d)}`;
}
