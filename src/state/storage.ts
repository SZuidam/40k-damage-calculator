import { DEFENDER_KEYWORDS, noAbilities, noConditions, type AttackConditions, type AttackPreset, type DefenderKeyword, type AttackRow, type DefenderPreset, type DefenderProfile, type RowSnapshot, type StoredWeapon, type UnitPreset, type WeaponAbilities, type WeaponStats } from '../types';
import { uid } from './ids';
import { pickStats, sameCombatStats } from './presets';

export const STORAGE_KEY = 'damage-calculator:v2';
export const LEGACY_STORAGE_KEY = 'damage-calculator:v1';

/** Everything the app keeps in localStorage. */
export interface StoredState {
  library: StoredWeapon[];
  rows: AttackRow[];
  defender: DefenderProfile;
  iterations: number;
  attackPresets: AttackPreset[];
  unitPresets: UnitPreset[];
  defenderPresets: DefenderPreset[];
  activeAttackPresetId: string | null;
  activeDefenderPresetId: string | null;
  /** Situational attack conditions (half range, charged): live state only, never in presets or exports. */
  conditions: AttackConditions;
}

/** The subset of the Web Storage API the app uses, so tests can pass an in-memory stub. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DEFAULT_ITERATIONS = 10_000;

export function defaultDefender(): DefenderProfile {
  return { models: 10, toughness: 4, save: 3, invuln: null, wounds: 2, keywords: [] };
}

/** One "Bolt rifle" profile fired by 10 models into 10 MEQ, the same loadout as v1. */
export function defaultState(): StoredState {
  const boltRifle: StoredWeapon = { id: uid('weapon'), name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() };
  return {
    library: [boltRifle],
    rows: [{ id: uid('row'), models: 10, weaponId: boltRifle.id }],
    defender: defaultDefender(),
    iterations: DEFAULT_ITERATIONS,
    attackPresets: [],
    unitPresets: [],
    defenderPresets: [],
    activeAttackPresetId: null,
    activeDefenderPresetId: null,
    conditions: noConditions(),
  };
}

function browserStorage(): KeyValueStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/** Load v2 state, migrate v1 state, or fall back to the defaults. Never throws. */
export function loadState(storage: KeyValueStorage | undefined = browserStorage()): StoredState {
  if (!storage) return defaultState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) return normalise(JSON.parse(raw));
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return migrateV1(JSON.parse(legacy));
  } catch {
    // Corrupt JSON or storage blocked: start fresh.
  }
  return defaultState();
}

export function saveState(state: StoredState, storage: KeyValueStorage | undefined = browserStorage()): void {
  try {
    storage?.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, blocked, full): the app works without it.
  }
}

/**
 * v1 stored `{ weapons: WeaponProfile[], defender, iterations }`. Each weapon becomes a
 * library entry (deduplicated by name + stats) plus a row linked to it.
 */
export function migrateV1(raw: unknown): StoredState {
  const fallback = defaultState();
  if (!isRecord(raw) || !Array.isArray(raw.weapons)) return fallback;

  const library: StoredWeapon[] = [];
  const rows: AttackRow[] = [];
  for (const item of raw.weapons) {
    const stats = toWeaponStats(item);
    if (!stats || !isRecord(item)) continue;
    let entry = library.find((w) => w.name === stats.name && sameCombatStats(w, stats));
    if (!entry) {
      entry = { ...stats, id: uid('weapon') };
      library.push(entry);
    }
    rows.push({ id: uid('row'), models: num(item.models, 1), weaponId: entry.id });
  }
  if (library.length === 0) return { ...fallback, defender: toDefender(raw.defender) ?? fallback.defender };

  return {
    ...fallback,
    library,
    rows,
    defender: toDefender(raw.defender) ?? fallback.defender,
    iterations: num(raw.iterations, DEFAULT_ITERATIONS),
  };
}

/** Check the shape of parsed v2 data and repair what can be repaired. */
function normalise(raw: unknown): StoredState {
  const fallback = defaultState();
  if (!isRecord(raw)) return fallback;

  let library = list(raw.library, toStoredWeapon);
  let rows = list(raw.rows, toRow).map((r) => (library.some((w) => w.id === r.weaponId) ? r : { ...r, weaponId: null }));
  if (library.length === 0) {
    library = fallback.library;
    rows = fallback.rows;
  } else if (rows.length === 0) {
    rows = [{ id: uid('row'), models: 1, weaponId: library[0].id }];
  }

  const attackPresets = list(raw.attackPresets, toRowsPreset);
  const unitPresets = list(raw.unitPresets, toRowsPreset);
  const defenderPresets = list(raw.defenderPresets, toDefenderPreset);
  const activeId = (id: unknown, presets: { id: string }[]) =>
    typeof id === 'string' && presets.some((p) => p.id === id) ? id : null;

  return {
    library,
    rows,
    defender: toDefender(raw.defender) ?? fallback.defender,
    iterations: num(raw.iterations, DEFAULT_ITERATIONS),
    attackPresets,
    unitPresets,
    defenderPresets,
    activeAttackPresetId: activeId(raw.activeAttackPresetId, attackPresets),
    activeDefenderPresetId: activeId(raw.activeDefenderPresetId, defenderPresets),
    conditions: toConditions(raw.conditions),
  };
}

/** States saved before conditions existed have none switched on. */
function toConditions(value: unknown): AttackConditions {
  if (!isRecord(value)) return noConditions();
  return { halfRange: value.halfRange === true, charged: value.charged === true };
}

// ---------- shape checks ----------

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A finite number, or the fallback. Out-of-range numbers are kept: validation flags them in the UI. */
function num(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

export function list<T>(value: unknown, convert: (item: unknown) => T | null): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(convert).filter((x): x is T => x !== null);
}

export function toWeaponStats(value: unknown): WeaponStats | null {
  if (!isRecord(value)) return null;
  const { name, attacks, damage } = value;
  if (typeof name !== 'string' || typeof attacks !== 'string' || typeof damage !== 'string') return null;
  return pickStats({
    name,
    attacks,
    damage,
    skill: num(value.skill, 3),
    strength: num(value.strength, 4),
    ap: num(value.ap, 0),
    abilities: toAbilities(value.abilities),
  });
}

/** Weapons saved before abilities existed (and v1 weapons) have none. */
function toAbilities(value: unknown): WeaponAbilities {
  const a = noAbilities();
  if (!isRecord(value)) return a;
  return {
    lethalHits: value.lethalHits === true,
    sustainedHits: toAbilityDice(value.sustainedHits),
    devastatingWounds: value.devastatingWounds === true,
    blast: toAbilityDice(value.blast),
    cleave: toAbilityDice(value.cleave),
    anti: toAnti(value.anti),
    rapidFire: toAbilityDice(value.rapidFire),
    lance: value.lance === true,
  };
}

/**
 * Anti-X Y+ per keyword: known keywords with a finite Y. Weapons saved before Anti existed
 * have none. Y out of range is kept, like other stats: ui/validation flags it.
 */
function toAnti(value: unknown): WeaponAbilities['anti'] {
  const anti: WeaponAbilities['anti'] = {};
  if (!isRecord(value)) return anti;
  for (const keyword of DEFENDER_KEYWORDS) {
    const y = value[keyword];
    if (typeof y === 'number' && Number.isFinite(y)) anti[keyword] = y;
  }
  return anti;
}

/** Known keywords only, without duplicates, in display order. Defenders saved before keywords existed have none. */
function toKeywords(value: unknown): DefenderKeyword[] {
  if (!Array.isArray(value)) return [];
  return DEFENDER_KEYWORDS.filter((k) => value.includes(k));
}

/**
 * X of Sustained Hits / Blast / Cleave / Rapid Fire: a non-empty dice expression, or null. Blast and
 * Cleave were saved as whole numbers before they took dice; those become "2". The
 * expression itself is checked by ui/validation.
 */
function toAbilityDice(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 ? String(value) : null;
}

function toStoredWeapon(value: unknown): StoredWeapon | null {
  const stats = toWeaponStats(value);
  return stats && isRecord(value) && typeof value.id === 'string' ? { ...stats, id: value.id } : null;
}

function toRow(value: unknown): AttackRow | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  return { id: value.id, models: num(value.models, 1), weaponId: typeof value.weaponId === 'string' ? value.weaponId : null };
}

export function toSnapshot(value: unknown): RowSnapshot | null {
  if (!isRecord(value) || typeof value.weaponId !== 'string') return null;
  const weapon = toWeaponStats(value.weapon);
  return weapon ? { models: num(value.models, 1), weaponId: value.weaponId, weapon } : null;
}

function toRowsPreset(value: unknown): AttackPreset | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  return { id: value.id, name: value.name, rows: list(value.rows, toSnapshot) };
}

export function toDefender(value: unknown): DefenderProfile | null {
  if (!isRecord(value)) return null;
  const d = defaultDefender();
  return {
    models: num(value.models, d.models),
    toughness: num(value.toughness, d.toughness),
    save: num(value.save, d.save),
    invuln: typeof value.invuln === 'number' && Number.isFinite(value.invuln) ? value.invuln : null,
    wounds: num(value.wounds, d.wounds),
    keywords: toKeywords(value.keywords),
  };
}

function toDefenderPreset(value: unknown): DefenderPreset | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  const defender = toDefender(value.defender);
  return defender ? { id: value.id, name: value.name, defender } : null;
}
