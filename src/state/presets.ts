import { KEYWORD_NAMES, copyAbilities, type DefenderProfile, type UnitStats, type WeaponStats } from '../types';
import { abilitiesSummary, sameAbilities } from './abilities';

/** Copy only the WeaponStats fields (drops `id` and anything else). The abilities are copied too. */
export function pickStats(w: WeaponStats): WeaponStats {
  return { name: w.name, type: w.type, attacks: w.attacks, skill: w.skill, strength: w.strength, ap: w.ap, damage: w.damage, abilities: copyAbilities(w.abilities) };
}

/**
 * Whether two weapons fire the same: every stat and ability except the name. Dice are compared
 * ignoring case and spaces.
 */
export function sameCombatStats(a: WeaponStats, b: WeaponStats): boolean {
  return (
    a.type === b.type &&
    a.attacks.trim().toUpperCase() === b.attacks.trim().toUpperCase() &&
    a.skill === b.skill &&
    a.strength === b.strength &&
    a.ap === b.ap &&
    a.damage.trim().toUpperCase() === b.damage.trim().toUpperCase() &&
    sameAbilities(a.abilities, b.abilities)
  );
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

/** Sort by name for selects and lists (case-insensitive, numbers in numeric order). */
export function byName<T extends { name: string }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
}

/** The value of the BS / WS characteristic: "3+", or "N/A" for a Torrent weapon (it never rolls to hit). */
export function skillValue(w: Pick<WeaponStats, 'skill' | 'abilities'>): string {
  return w.abilities.torrent ? 'N/A' : `${w.skill}+`;
}

/**
 * Short stats line: "A 2 · BS 3+ · S 4 · AP -1 · D 1", plus " · Lethal Hits, …" when it has
 * abilities. A melee weapon reads "Melee · A 3 · WS 3+ · …", a Torrent weapon "BS N/A".
 */
export function statsSummary(w: WeaponStats): string {
  const abilities = abilitiesSummary(w.abilities);
  const melee = w.type === 'melee';
  return `${melee ? 'Melee · ' : ''}A ${w.attacks} · ${melee ? 'WS' : 'BS'} ${skillValue(w)} · S ${w.strength} · AP ${w.ap} · D ${w.damage}${abilities ? ` · ${abilities}` : ''}`;
}

/** "T4 · Sv 3+ · Inv 4+ · W2", plus " · Vehicle, Monster" when it has keywords. */
export function statLine(d: UnitStats): string {
  const save = d.save >= 7 ? 'Sv –' : `Sv ${d.save}+`;
  const invuln = d.invuln === null ? '' : ` · Inv ${d.invuln}+`;
  const keywords = d.keywords.length === 0 ? '' : ` · ${d.keywords.map((k) => KEYWORD_NAMES[k]).join(', ')}`;
  return `T${d.toughness} · ${save}${invuln} · W${d.wounds}${keywords}`;
}
