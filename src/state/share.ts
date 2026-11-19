import type { AttackPreset, DefenderPreset, DefenderProfile, RowSnapshot, StoredWeapon, UnitPreset } from '../types';
import { MAX_WEAPON_NAME, validateDefender, validateRow, validateWeaponStats } from '../ui/validation';
import { uid } from './ids';
import { copyDefender, pickStats, sameCombatStats, sameDefender, sameSnapshot } from './presets';
import { isRecord, list, toDefender, toSnapshot, toWeaponStats } from './storage';

/** Marks a JSON document as a share file of this app. */
export const SHARE_FORMAT = 'damage-calculator-share';
export const SHARE_VERSION = 1;
/** Refuse pasted text or files above this many characters. */
export const MAX_SHARE_LENGTH = 1_000_000;

export type ShareKind = 'attacks' | 'units' | 'defenders' | 'weapons';
export const SHARE_KINDS: readonly ShareKind[] = ['attacks', 'units', 'defenders', 'weapons'];

export interface SharedRowsPreset {
  name: string;
  rows: RowSnapshot[];
}

export interface SharedDefenderPreset {
  name: string;
  defender: DefenderProfile;
}

/** The shareable content. Presets travel without their ids: the importer assigns new ones. */
export interface ShareData {
  attacks: SharedRowsPreset[];
  units: SharedRowsPreset[];
  defenders: SharedDefenderPreset[];
  /** Library weapon profiles. Their ids travel along so preset rows link back to them on import. */
  weapons: StoredWeapon[];
}

export interface ShareFile extends ShareData {
  format: typeof SHARE_FORMAT;
  version: typeof SHARE_VERSION;
  exportedAt: string;
}

/** The parts of the app state that can be exported and imported. Arrays are mutated in place on import. */
export interface ShareState {
  library: StoredWeapon[];
  attackPresets: AttackPreset[];
  unitPresets: UnitPreset[];
  defenderPresets: DefenderPreset[];
}

/** Ids to export, per kind. */
export type ShareSelection = Record<ShareKind, readonly string[]>;

// ---------- export ----------

const copyRows = (rows: RowSnapshot[]): RowSnapshot[] => rows.map((r) => ({ models: r.models, weaponId: r.weaponId, weapon: pickStats(r.weapon) }));

export function buildShareFile(state: ShareState, selection: ShareSelection, now = new Date()): ShareFile {
  const pick = <T extends { id: string }>(items: T[], ids: readonly string[]) => items.filter((item) => ids.includes(item.id));
  return {
    format: SHARE_FORMAT,
    version: SHARE_VERSION,
    exportedAt: now.toISOString(),
    attacks: pick(state.attackPresets, selection.attacks).map((p) => ({ name: p.name, rows: copyRows(p.rows) })),
    units: pick(state.unitPresets, selection.units).map((p) => ({ name: p.name, rows: copyRows(p.rows) })),
    defenders: pick(state.defenderPresets, selection.defenders).map((p) => ({ name: p.name, defender: copyDefender(p.defender) })),
    weapons: pick(state.library, selection.weapons).map((w) => ({ id: w.id, ...pickStats(w) })),
  };
}

export function serializeShareFile(file: ShareFile): string {
  return JSON.stringify(file, null, 2);
}

export function shareCount(data: ShareData): number {
  return SHARE_KINDS.reduce((sum, kind) => sum + data[kind].length, 0);
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

  const data: ShareData = {
    attacks: list(raw.attacks, toSharedRows),
    units: list(raw.units, toSharedRows),
    defenders: list(raw.defenders, toSharedDefender),
    weapons: list(raw.weapons, toSharedWeapon),
  };
  if (shareCount(data) === 0) return fail('This export contains nothing to import.');
  return { ok: true, data };
}

/** Trimmed and cut to the name limit; '' when there is no usable name. */
function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, MAX_WEAPON_NAME).trim() : '';
}

function toSharedWeapon(value: unknown): StoredWeapon | null {
  const stats = toWeaponStats(value);
  if (!stats || !isRecord(value)) return null;
  const name = cleanName(stats.name);
  if (name === '') return null;
  const id = typeof value.id === 'string' && value.id !== '' ? value.id : uid('weapon');
  return { ...stats, name, id };
}

function toSharedRows(value: unknown): SharedRowsPreset | null {
  if (!isRecord(value)) return null;
  const name = cleanName(value.name);
  if (name === '') return null;
  const rows = list(value.rows, toSnapshot).map((r) => ({ ...r, weapon: { ...r.weapon, name: cleanName(r.weapon.name) } }));
  return { name, rows };
}

function toSharedDefender(value: unknown): SharedDefenderPreset | null {
  if (!isRecord(value)) return null;
  const name = cleanName(value.name);
  const defender = toDefender(value.defender);
  return name !== '' && defender ? { name, defender } : null;
}

// ---------- plan ----------

/**
 * - new: no saved item has this name.
 * - duplicate: an item with this name and the same content is already saved.
 * - conflict: an item with this name but different content is saved.
 * - invalid: values out of range; `problem` says which.
 */
export type ImportStatus = 'new' | 'duplicate' | 'conflict' | 'invalid';

export interface ImportItem {
  kind: ShareKind;
  /** Index into `data[kind]`. */
  index: number;
  name: string;
  status: ImportStatus;
  problem?: string;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const byName = <T extends { name: string }>(items: T[], name: string) => items.find((item) => sameName(item.name, name));
const firstError = (errors: object): string | undefined => Object.values(errors)[0] as string | undefined;

function rowsProblem(rows: RowSnapshot[]): string | undefined {
  if (rows.length === 0) return 'Has no attack rows';
  for (const row of rows) {
    const weaponError = firstError(validateWeaponStats(row.weapon));
    if (weaponError) return `${row.weapon.name || 'Weapon'}: ${weaponError}`;
    const modelsError = validateRow({ id: '', models: row.models, weaponId: row.weaponId }, [{ ...row.weapon, id: row.weaponId }]).models;
    if (modelsError) return `${row.weapon.name}: ${modelsError}`;
  }
  return undefined;
}

/** Compare every imported item with what is saved. */
export function planImport(data: ShareData, state: ShareState): ImportItem[] {
  const items: ImportItem[] = [];
  const classify = <T extends { name: string }>(kind: ShareKind, index: number, name: string, problem: string | undefined, existing: T[], same: (e: T) => boolean) => {
    const match = byName(existing, name);
    const status: ImportStatus = problem ? 'invalid' : !match ? 'new' : same(match) ? 'duplicate' : 'conflict';
    items.push(problem ? { kind, index, name, status, problem } : { kind, index, name, status });
  };

  data.attacks.forEach((p, i) => classify('attacks', i, p.name, rowsProblem(p.rows), state.attackPresets, (e) => sameSnapshot(e.rows, p.rows)));
  data.units.forEach((p, i) => classify('units', i, p.name, rowsProblem(p.rows), state.unitPresets, (e) => sameSnapshot(e.rows, p.rows)));
  data.defenders.forEach((p, i) => classify('defenders', i, p.name, firstError(validateDefender(p.defender)), state.defenderPresets, (e) => sameDefender(e.defender, p.defender)));
  data.weapons.forEach((w, i) => classify('weapons', i, w.name, firstError(validateWeaponStats(w)), state.library, (e) => sameCombatStats(e, w)));
  return items;
}

// ---------- apply ----------

/** What to do with an imported item whose name is already in use. */
export type ConflictPolicy = 'rename' | 'replace';

export interface ImportSummary {
  added: number;
  /** Added under a new name because the name was in use. */
  renamed: number;
  /** Overwrote the saved item with the same name. */
  replaced: number;
}

/** `Name (2)`, `Name (3)`, … cut so the result stays within the name limit. */
export function uniqueName(taken: string[], name: string): string {
  const used = new Set(taken.map((t) => t.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let n = 2; ; n += 1) {
    const suffix = ` (${n})`;
    const candidate = `${name.slice(0, MAX_WEAPON_NAME - suffix.length).trimEnd()}${suffix}`;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * Add the chosen items to the state, mutating its arrays in place. Invalid and duplicate
 * items are skipped. A conflict is replaced or added under a new name per `policy`; a
 * replaced weapon keeps its library id, so rows using it now fire the imported stats.
 */
export function applyImport(data: ShareData, items: ImportItem[], state: ShareState, policy: ConflictPolicy): ImportSummary {
  const summary: ImportSummary = { added: 0, renamed: 0, replaced: 0 };

  /** Shared bookkeeping: replace the clashing entry, or return the name to add under. */
  const place = <T extends { name: string }>(item: ImportItem, existing: T[], replace: (target: T) => void): string | null => {
    const match = byName(existing, item.name);
    if (match && item.status === 'conflict' && policy === 'replace') {
      replace(match);
      match.name = item.name;
      summary.replaced += 1;
      return null;
    }
    const name = uniqueName(
      existing.map((e) => e.name),
      item.name,
    );
    if (name === item.name) summary.added += 1;
    else summary.renamed += 1;
    return name;
  };

  // Weapons first, so preset rows imported in the same go link to them when loaded.
  const ordered = [...items].sort((a, b) => Number(b.kind === 'weapons') - Number(a.kind === 'weapons'));
  for (const item of ordered) {
    if (item.status === 'invalid' || item.status === 'duplicate') continue;
    if (item.kind === 'weapons') {
      const weapon = data.weapons[item.index];
      const name = place(item, state.library, (target) => Object.assign(target, pickStats(weapon)));
      if (name === null) continue;
      const id = state.library.some((w) => w.id === weapon.id) ? uid('weapon') : weapon.id;
      state.library.push({ ...pickStats(weapon), id, name });
    } else if (item.kind === 'defenders') {
      const preset = data.defenders[item.index];
      const name = place(item, state.defenderPresets, (target) => (target.defender = copyDefender(preset.defender)));
      if (name !== null) state.defenderPresets.push({ id: uid('defender'), name, defender: copyDefender(preset.defender) });
    } else {
      const preset = data[item.kind][item.index];
      const target = item.kind === 'attacks' ? state.attackPresets : state.unitPresets;
      const name = place(item, target, (t) => (t.rows = copyRows(preset.rows)));
      if (name !== null) target.push({ id: uid(item.kind === 'attacks' ? 'attack' : 'unit'), name, rows: copyRows(preset.rows) });
    }
  }
  return summary;
}
