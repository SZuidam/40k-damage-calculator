import type { Army, StoredWeapon, Unit, UnitStats, WeaponStats } from '../types';
import { MAX_WEAPON_NAME, validateUnit } from '../ui/validation';
import { uid } from './ids';
import { armyOf } from './loadout';
import { pickStats, sameCombatStats, sameDefender } from './presets';
import { isRecord, list, toUnit } from './storage';
import { isNameTaken } from './units';

/** Marks a JSON document as a share file of this app. */
export const SHARE_FORMAT = 'damage-calculator-share';
/**
 * 3 (session 16): armies and units. 1–2 held profiles, defender presets and weapon profiles,
 * which units replaced; those files are refused with an explanation.
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
}

export interface ShareData {
  units: SharedUnit[];
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
}

// ---------- export ----------

/** The army name `unit` is listed under, or null for "No army". */
function armyName(unit: Unit, armies: readonly Army[]): string | null {
  const id = armyOf(unit, armies);
  return armies.find((a) => a.id === id)?.name ?? null;
}

/** A file with the units whose ids are in `unitIds`, in the order of `state.units`. */
export function buildShareFile(state: ShareState, unitIds: readonly string[], now = new Date()): ShareFile {
  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    exportedAt: now.toISOString(),
    units: state.units.filter((u) => unitIds.includes(u.id)).map((u) => toShared(u, armyName(u, state.armies))),
  };
}

function toShared(u: Unit, army: string | null): SharedUnit {
  return { name: u.name, army, ...stats(u), keywords: [...u.keywords], weapons: u.weapons.map(pickStats) };
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

  const data: ShareData = { units: list(raw.units, toSharedUnit) };
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
  };
}

// ---------- plan ----------

/**
 * - new: the army has no unit with this name.
 * - duplicate: a unit with this name and the same content is already in that army.
 * - conflict: a unit with this name but different content is in that army.
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

/** Same stat line, keywords and weapons (names and combat stats, in order); names, ids and army don't count. */
export function sameUnitContent(a: UnitStats & { weapons: WeaponStats[] }, b: UnitStats & { weapons: WeaponStats[] }): boolean {
  return (
    sameDefender({ ...stats(a), models: 0 }, { ...stats(b), models: 0 }) &&
    a.weapons.length === b.weapons.length &&
    a.weapons.every((w, i) => w.name === b.weapons[i].name && sameCombatStats(w, b.weapons[i]))
  );
}

/** As a Unit, for validation: no id or army needed. */
const asUnit = (u: SharedUnit): Unit => ({ ...u, id: '', armyId: null, weapons: u.weapons.map((w) => ({ ...w, id: '' })) });

/** Compare every unit in the file with the units saved under the same army. */
export function planImport(data: ShareData, state: ShareState): ImportItem[] {
  return data.units.map((unit, index) => {
    const problem = Object.values(validateUnit(asUnit(unit)))[0];
    const match = unitsUnder(state, unit.army).find((u) => sameName(u.name, unit.name));
    const status: ImportStatus = problem ? 'invalid' : !match ? 'new' : sameUnitContent(match, unit) ? 'duplicate' : 'conflict';
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
 * so a loadout on the main page that uses them stays linked. Everything else gets new ids.
 */
export function applyImport(data: ShareData, items: readonly ImportItem[], state: ShareState, policy: ConflictPolicy): ImportSummary {
  const summary: ImportSummary = { added: 0, renamed: 0, replaced: 0, armies: 0 };

  const armyIdFor = (name: string | null): string | null => {
    if (name === null) return null;
    const existing = findArmy(state.armies, name);
    if (existing) return existing.id;
    const army: Army = { id: uid('army'), name };
    state.armies.push(army);
    summary.armies += 1;
    return army.id;
  };

  for (const item of items) {
    if (item.status === 'invalid' || item.status === 'duplicate') continue;
    const unit = data.units[item.index];
    const armyId = armyIdFor(unit.army);
    const siblings = state.units.filter((u) => armyOf(u, state.armies) === armyId);
    const match = siblings.find((u) => sameName(u.name, unit.name));

    if (match && item.status === 'conflict' && policy === 'replace') {
      const weapons: StoredWeapon[] = unit.weapons.map((w) => ({ ...pickStats(w), id: match.weapons.find((m) => sameName(m.name, w.name))?.id ?? uid('weapon') }));
      Object.assign(match, { ...stats(unit), keywords: [...unit.keywords], weapons });
      summary.replaced += 1;
      continue;
    }
    const name = uniqueName(
      siblings.map((u) => u.name),
      unit.name,
    );
    if (name === unit.name) summary.added += 1;
    else summary.renamed += 1;
    state.units.push({
      id: uid('unit'),
      name,
      armyId,
      ...stats(unit),
      keywords: [...unit.keywords],
      weapons: unit.weapons.map((w) => ({ ...pickStats(w), id: uid('weapon') })),
    });
  }
  return summary;
}
