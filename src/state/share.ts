import type { Army, StoredWeapon, Unit, UnitAbility, UnitStats, WeaponStats } from '../types';
import { MAX_WEAPON_NAME, validateAbilities, validateUnit } from '../ui/validation';
import { isBannerUrl, type Banners } from './banners';
import { uid } from './ids';
import { armyOf } from './loadout';
import { pickStats, sameCombatStats, sameDefender } from './presets';
import { isRecord, list, toUnit, toUnitAbility } from './storage';
import { abilityContent, sameAbilityContent, type AbilityContent } from './unitAbilities';
import { isNameTaken } from './units';

/** Marks a JSON document as a share file of this app. */
export const SHARE_FORMAT = 'damage-calculator-share';
/**
 * 3 (session 16): armies and units. 1–2 held profiles, defender presets and weapon profiles,
 * which units replaced; those files are refused with an explanation. Weapon types, unit
 * abilities and army rules (`armies`) and banner links (`banner`) were added to version 3 later;
 * files without them load with ranged weapons, no abilities and no banner.
 */
export const SHARE_VERSION = 3;
/** Refuse pasted text or files above this many characters. */
export const MAX_SHARE_LENGTH = 1_000_000;

/**
 * A unit in a file: its army by name (null for "No army"), its stat line and its weapons, all
 * without ids. The importer matches the army by name and gives everything new ids.
 */
export interface SharedUnit extends UnitStats {
  name: string;
  army: string | null;
  weapons: WeaponStats[];
  /** The unit's abilities, without ids. */
  abilities: AbilityContent[];
  /** The unit's banner when it is an online image (an https link); pictures from the PC stay home. */
  banner?: string;
}

/** The rules of an army whose units are in the file, matched by name on import. */
export interface SharedArmy {
  name: string;
  abilities: AbilityContent[];
}

export interface ShareData {
  units: SharedUnit[];
  /** Army rules of the armies in the file (only armies that have rules); [] for none. */
  armies: SharedArmy[];
}

export interface ShareFile extends ShareData {
  format: typeof SHARE_FORMAT;
  version: typeof SHARE_VERSION;
  exportedAt: string;
}

/** The parts of the app state that can be exported and imported. Arrays are mutated in place on import. */
export interface ShareState {
  armies: Army[];
  units: Unit[];
  /** Banner images by unit id; links are exported and imported, pictures from the PC are not. */
  banners?: Banners;
}

// ---------- export ----------

/** The army name `unit` is listed under, or null for "No army". */
function armyName(unit: Unit, armies: readonly Army[]): string | null {
  const id = armyOf(unit, armies);
  return armies.find((a) => a.id === id)?.name ?? null;
}

/**
 * A file with the units whose ids are in `unitIds`, in the order of `state.units`, plus the rules
 * of their armies (armies without rules are left out).
 */
export function buildShareFile(state: ShareState, unitIds: readonly string[], now = new Date()): ShareFile {
  const units = state.units.filter((u) => unitIds.includes(u.id));
  const armyIds = new Set(units.map((u) => armyOf(u, state.armies)));
  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    exportedAt: now.toISOString(),
    units: units.map((u) => toShared(u, armyName(u, state.armies), state.banners?.[u.id])),
    armies: state.armies.filter((a) => armyIds.has(a.id) && a.abilities.length > 0).map((a) => ({ name: a.name, abilities: a.abilities.map(abilityContent) })),
  };
}

function toShared(u: Unit, army: string | null, banner: string | undefined): SharedUnit {
  const shared: SharedUnit = { name: u.name, army, ...stats(u), keywords: [...u.keywords], weapons: u.weapons.map(pickStats), abilities: u.abilities.map(abilityContent) };
  if (isBannerUrl(banner)) shared.banner = banner;
  return shared;
}

export function serializeShareFile(file: ShareFile): string {
  return JSON.stringify(file, null, 2);
}

// ---------- parse ----------

export type ParseResult = { ok: true; data: ShareData } | { ok: false; error: string };

/** Read pasted text or a file's contents. Malformed entries are dropped, like stored state. Never throws. */
export function parseShareText(text: string): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });
  if (text.trim() === '') return fail('Paste an export or choose a file first.');
  if (text.length > MAX_SHARE_LENGTH) return fail('This is too large to be an export of this app.');

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return fail('This is not valid JSON. Paste the whole export, from the first { to the last }.');
  }
  if (!isRecord(raw) || raw.format !== SHARE_FORMAT) return fail('This is not an export of the Damage Calculator.');
  if (typeof raw.version !== 'number' || raw.version > SHARE_VERSION) return fail('This export was made by a newer version of the app.');
  if (raw.version < 3) return fail('This export holds profiles and weapon profiles from an older version of the app, which now uses armies and units instead.');

  const data: ShareData = { units: list(raw.units, toSharedUnit), armies: list(raw.armies, toSharedArmy) };
  if (data.units.length === 0) return fail('This export contains nothing to import.');
  return { ok: true, data };
}

/** Trimmed and cut to the name limit; '' when there is no usable name. */
function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_WEAPON_NAME).trim() : '';
}

/** The storage shape checks for a unit, plus a clean name; ids are dropped. */
function toSharedUnit(value: unknown): SharedUnit | null {
  if (!isRecord(value)) return null;
  const name = cleanName(value.name);
  const unit = toUnit({ ...value, id: 'x', armyId: null });
  if (name === '' || !unit) return null;
  const army = cleanName(value.army);
  return {
    name,
    army: army === '' ? null : army,
    ...stats(unit),
    weapons: unit.weapons.map((w) => ({ ...pickStats(w), name: cleanName(w.name) })),
    abilities: unit.abilities.map(toSharedAbility),
    ...(isBannerUrl(value.banner) ? { banner: value.banner } : {}),
  };
}

/** An ability as read by storage, without its id and with a clean name. */
function toSharedAbility(a: UnitAbility): AbilityContent {
  return { ...abilityContent(a), name: cleanName(a.name) };
}

/** An army's rules: a clean name and the abilities that could be read. */
function toSharedArmy(value: unknown): SharedArmy | null {
  if (!isRecord(value)) return null;
  const name = cleanName(value.name);
  if (name === '') return null;
  return { name, abilities: list(value.abilities, toUnitAbility).map(toSharedAbility) };
}

// ---------- plan ----------

/**
 * - new: the army has no unit with this name.
 * - duplicate: a unit with this name and the same content is already in that army.
 * - conflict: a unit with this name but different content (or, when the file has a banner link,
 *   a different banner) is in that army.
 * - invalid: values out of range; `problem` says which.
 */
export type ImportStatus = 'new' | 'duplicate' | 'conflict' | 'invalid';

export interface ImportItem {
  /** Index into `data.units`. */
  index: number;
  name: string;
  /** The army name as in the file, or null for "No army". */
  army: string | null;
  /** Whether that army must be created (no army with this name exists). */
  newArmy: boolean;
  status: ImportStatus;
  problem?: string;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The army with `name` (case-insensitive), or undefined. */
function findArmy(armies: readonly Army[], name: string): Army | undefined {
  return armies.find((a) => sameName(a.name, name));
}

/** The units listed under the army named `army` (null: "No army"). */
function unitsUnder(state: ShareState, army: string | null): Unit[] {
  const id = army === null ? null : (findArmy(state.armies, army)?.id ?? undefined);
  if (id === undefined) return [];
  return state.units.filter((u) => armyOf(u, state.armies) === id);
}

const stats = (u: UnitStats): UnitStats => ({ toughness: u.toughness, save: u.save, invuln: u.invuln, wounds: u.wounds, keywords: u.keywords });

type UnitContent = UnitStats & { weapons: WeaponStats[]; abilities: readonly AbilityContent[] };

/**
 * Same stat line, keywords, weapons (names and combat stats, in order) and abilities (in order);
 * names, ids and army don't count.
 */
export function sameUnitContent(a: UnitContent, b: UnitContent): boolean {
  return (
    sameDefender({ ...stats(a), models: 0 }, { ...stats(b), models: 0 }) &&
    a.weapons.length === b.weapons.length &&
    a.weapons.every((w, i) => w.name === b.weapons[i].name && sameCombatStats(w, b.weapons[i])) &&
    a.abilities.length === b.abilities.length &&
    a.abilities.every((x, i) => sameAbilityContent(x, b.abilities[i]))
  );
}

/** Abilities with new ids. */
const withIds = (abilities: readonly AbilityContent[]): UnitAbility[] => abilities.map((a) => ({ id: uid('ability'), ...abilityContent(a) }));

/** As a Unit, for validation: no id or army needed. */
const asUnit = (u: SharedUnit): Unit => ({ ...u, id: '', armyId: null, weapons: u.weapons.map((w) => ({ ...w, id: '' })), abilities: u.abilities.map((a) => ({ ...a, id: '' })) });

/** Compare every unit in the file with the units saved under the same army. */
export function planImport(data: ShareData, state: ShareState): ImportItem[] {
  return data.units.map((unit, index) => {
    const problem = Object.values(validateUnit(asUnit(unit)))[0];
    const match = unitsUnder(state, unit.army).find((u) => sameName(u.name, unit.name));
    const sameBanner = unit.banner === undefined || (match !== undefined && state.banners?.[match.id] === unit.banner);
    const status: ImportStatus = problem ? 'invalid' : !match ? 'new' : sameUnitContent(match, unit) && sameBanner ? 'duplicate' : 'conflict';
    const newArmy = unit.army !== null && !findArmy(state.armies, unit.army);
    return { index, name: unit.name, army: unit.army, newArmy, status, ...(problem ? { problem } : {}) };
  });
}

// ---------- apply ----------

/** What to do with an imported unit whose name is already in use in its army. */
export type ConflictPolicy = 'rename' | 'replace';

export interface ImportSummary {
  added: number;
  /** Added under a new name because the name was in use. */
  renamed: number;
  /** Overwrote the saved unit with the same name. */
  replaced: number;
  /** Armies created because no army had the file's army name. */
  armies: number;
  /** Army rules added to or replaced in the armies of the imported units. */
  armyRules: number;
}

/**
 * `name`, or `Name (2)`, `Name (3)`, … when it is taken (case-insensitive), cut so the
 * result stays within the 40-character name limit.
 */
export function uniqueName(taken: readonly string[], name: string): string {
  const base = name.slice(0, MAX_WEAPON_NAME).trimEnd();
  if (!isNameTaken(taken, base)) return base;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${base.slice(0, MAX_WEAPON_NAME - suffix.length).trimEnd()}${suffix}`;
    if (!isNameTaken(taken, candidate)) return candidate;
  }
}

/**
 * Add the chosen units to the state, mutating its arrays in place. Invalid and duplicate items
 * are skipped. A missing army is created. A conflict is replaced or added under a new name per
 * `policy`. A replaced unit keeps its id, and its weapons keep their ids where the name stays,
 * so a loadout on the main page that uses them stays linked. Everything else gets new ids. A
 * banner link in the file is put in `state.banners`; a replaced unit without one keeps its banner.
 */
export function applyImport(data: ShareData, items: readonly ImportItem[], state: ShareState, policy: ConflictPolicy): ImportSummary {
  const summary: ImportSummary = { added: 0, renamed: 0, replaced: 0, armies: 0, armyRules: 0 };
  const touched = new Set<Army>();

  const armyIdFor = (name: string | null): string | null => {
    if (name === null) return null;
    const existing = findArmy(state.armies, name);
    if (existing) return existing.id;
    const army: Army = { id: uid('army'), name, abilities: [] };
    state.armies.push(army);
    summary.armies += 1;
    return army.id;
  };

  for (const item of items) {
    if (item.status === 'invalid' || item.status === 'duplicate') continue;
    const unit = data.units[item.index];
    const armyId = armyIdFor(unit.army);
    const army = state.armies.find((a) => a.id === armyId);
    if (army) touched.add(army);
    const siblings = state.units.filter((u) => armyOf(u, state.armies) === armyId);
    const match = siblings.find((u) => sameName(u.name, unit.name));

    if (match && item.status === 'conflict' && policy === 'replace') {
      const weapons: StoredWeapon[] = unit.weapons.map((w) => ({ ...pickStats(w), id: match.weapons.find((m) => sameName(m.name, w.name))?.id ?? uid('weapon') }));
      Object.assign(match, { ...stats(unit), keywords: [...unit.keywords], weapons, abilities: withIds(unit.abilities) });
      if (unit.banner !== undefined && state.banners) state.banners[match.id] = unit.banner;
      summary.replaced += 1;
      continue;
    }
    const name = uniqueName(
      siblings.map((u) => u.name),
      unit.name,
    );
    if (name === unit.name) summary.added += 1;
    else summary.renamed += 1;
    const id = uid('unit');
    if (unit.banner !== undefined && state.banners) state.banners[id] = unit.banner;
    state.units.push({
      id,
      name,
      armyId,
      ...stats(unit),
      keywords: [...unit.keywords],
      weapons: unit.weapons.map((w) => ({ ...pickStats(w), id: uid('weapon') })),
      abilities: withIds(unit.abilities),
    });
  }
  for (const army of touched) summary.armyRules += mergeArmyRules(army, data.armies);
  return summary;
}

/**
 * Merge the file's rules for `army` (matched by name) into it, by ability name: a rule with a
 * new name is added, one with a name in use replaces that rule (keeping its id) unless it is the
 * same already. Invalid rules are skipped. Returns how many rules were added or replaced.
 */
export function mergeArmyRules(army: Army, armies: readonly SharedArmy[]): number {
  const shared = armies.find((a) => sameName(a.name, army.name));
  if (!shared || validateAbilities(shared.abilities.map((a) => ({ ...a, id: '' }))) !== undefined) return 0;
  let changed = 0;
  for (const rule of shared.abilities) {
    const existing = army.abilities.find((a) => sameName(a.name, rule.name));
    if (existing && sameAbilityContent(existing, rule)) continue;
    if (existing) Object.assign(existing, abilityContent(rule));
    else army.abilities.push({ id: uid('ability'), ...abilityContent(rule) });
    changed += 1;
  }
  return changed;
}
