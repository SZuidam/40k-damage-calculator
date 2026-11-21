import { DEFENDER_KEYWORDS, noAbilities, noConditions, type AttackConditions, type DefenderKeyword, type DefenderPreset, type DefenderProfile, type Profile, type ProfileRow, type RowSnapshot, type StoredWeapon, type WeaponAbilities, type WeaponStats } from '../types';
import { uid } from './ids';
import { findWeapon, materialiseRows, snapshotRows, type LinkedAttack, type LinkedRow } from './legacy';
import { copyRows, pickStats, sameCombatStats, sameRows, uniqueName } from './presets';

export const STORAGE_KEY = 'damage-calculator:v4';
export const V3_STORAGE_KEY = 'damage-calculator:v3';
export const V2_STORAGE_KEY = 'damage-calculator:v2';
export const LEGACY_STORAGE_KEY = 'damage-calculator:v1';

/** Everything the app keeps in localStorage (v4). */
export interface StoredState {
  library: StoredWeapon[];
  /** The working area: the weapon rows on the main page, which the simulation fires. */
  rows: ProfileRow[];
  /** Saved profiles, each with its own weapon copies. May be empty. */
  profiles: Profile[];
  /** The profile the working area was loaded from or saved to, or null when it is unsaved. */
  activeProfileId: string | null;
  defender: DefenderProfile;
  defenderPresets: DefenderPreset[];
  activeDefenderPresetId: string | null;
  /** Situational attack conditions (half range, charged): page state only, never in profiles or exports. */
  conditions: AttackConditions;
  iterations: number;
}

/** The v3 state (sessions 11–12): attacks whose rows link to the library. Only read for migration. */
export interface V3State {
  library: StoredWeapon[];
  /** There is always at least one. */
  attacks: LinkedAttack[];
  /** Always the id of one of `attacks`. */
  activeAttackId: string;
  defender: DefenderProfile;
  defenderPresets: DefenderPreset[];
  activeDefenderPresetId: string | null;
  conditions: AttackConditions;
  iterations: number;
}

/** The subset of the Web Storage API the app uses, so tests can pass an in-memory stub. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DEFAULT_ITERATIONS = 10_000;
/** Names of attacks and profiles: same limit as `MAX_PRESET_NAME` in ui/modal.ts. */
const MAX_NAME = 40;

export function defaultDefender(): DefenderProfile {
  return { models: 10, toughness: 4, save: 3, invuln: null, wounds: 2, keywords: [] };
}

function boltRifle(): StoredWeapon {
  return { id: uid('weapon'), name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() };
}

/**
 * A brand-new state: one "Bolt rifle" weapon profile, a "Bolt rifles" profile of 10 models
 * firing a copy of it, loaded into the working area, into 10 MEQ (the same loadout as v1).
 */
export function defaultState(): StoredState {
  const weapon = boltRifle();
  const profile: Profile = { id: uid('profile'), name: 'Bolt rifles', rows: [{ id: uid('row'), models: 10, weapon: pickStats(weapon) }] };
  return {
    library: [weapon],
    rows: copyRows(profile.rows),
    profiles: [profile],
    activeProfileId: profile.id,
    defender: defaultDefender(),
    defenderPresets: [],
    activeDefenderPresetId: null,
    conditions: noConditions(),
    iterations: DEFAULT_ITERATIONS,
  };
}

/** The v3 defaults, for repairing v3 and v2 data before it is converted. */
function defaultV3(): V3State {
  const weapon = boltRifle();
  const attack: LinkedAttack = { id: uid('attack'), name: 'Bolt rifles', rows: [{ id: uid('row'), models: 10, weaponId: weapon.id }] };
  return {
    library: [weapon],
    attacks: [attack],
    activeAttackId: attack.id,
    defender: defaultDefender(),
    defenderPresets: [],
    activeDefenderPresetId: null,
    conditions: noConditions(),
    iterations: DEFAULT_ITERATIONS,
  };
}

function browserStorage(): KeyValueStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Load v4 state, migrate v3, v2 or v1 state, or fall back to the defaults. Never throws. Older
 * keys are left in place: saving writes the v4 key only.
 */
export function loadState(storage: KeyValueStorage | undefined = browserStorage()): StoredState {
  if (!storage) return defaultState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) return normalise(JSON.parse(raw));
    const v3 = storage.getItem(V3_STORAGE_KEY);
    if (v3) return fromV3(normaliseV3(JSON.parse(v3)));
    const v2 = storage.getItem(V2_STORAGE_KEY);
    if (v2) return fromV3(migrateV2(JSON.parse(v2)));
    const legacy = storage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) return fromV3(migrateV1(JSON.parse(legacy)));
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

// ---------- v4 ----------

/**
 * Check the shape of parsed v4 data and repair what can be repaired. Rows whose weapon copy
 * is malformed are dropped; out-of-range values are kept for validation to flag. An empty
 * library or no profiles is fine: nothing depends on them.
 */
function normalise(raw: unknown): StoredState {
  if (!isRecord(raw)) return defaultState();
  const profiles = list(raw.profiles, toProfile);
  const defenderPresets = list(raw.defenderPresets, toDefenderPreset);
  return {
    library: list(raw.library, toStoredWeapon),
    rows: list(raw.rows, toProfileRow),
    profiles,
    activeProfileId: activeId(raw.activeProfileId, profiles),
    defender: toDefender(raw.defender) ?? defaultDefender(),
    defenderPresets,
    activeDefenderPresetId: activeId(raw.activeDefenderPresetId, defenderPresets),
    conditions: toConditions(raw.conditions),
    iterations: num(raw.iterations, DEFAULT_ITERATIONS),
  };
}

// ---------- v3 → v4 ----------

/**
 * v3 → v4. Every attack becomes a profile with the same id and name whose rows copy the
 * library weapon they linked to; rows whose weapon is missing are dropped. The working area
 * gets a copy of the active attack's rows, and that profile stays active.
 */
export function fromV3(v3: V3State): StoredState {
  const copy = (row: LinkedRow): ProfileRow[] => {
    const weapon = findWeapon(v3.library, row.weaponId);
    return weapon ? [{ id: row.id, models: row.models, weapon: pickStats(weapon) }] : [];
  };
  const profiles: Profile[] = v3.attacks.map((a) => ({ id: a.id, name: a.name, rows: a.rows.flatMap(copy) }));
  const active = profiles.find((p) => p.id === v3.activeAttackId) ?? null;
  return {
    library: v3.library,
    rows: active ? copyRows(active.rows) : [],
    profiles,
    activeProfileId: active?.id ?? null,
    defender: v3.defender,
    defenderPresets: v3.defenderPresets,
    activeDefenderPresetId: v3.activeDefenderPresetId,
    conditions: v3.conditions,
    iterations: v3.iterations,
  };
}

/** Check the shape of parsed v3 data and repair what can be repaired. */
function normaliseV3(raw: unknown): V3State {
  const fallback = defaultV3();
  if (!isRecord(raw)) return fallback;

  let library = list(raw.library, toStoredWeapon);
  const emptyLibrary = library.length === 0;
  if (emptyLibrary) library = fallback.library;
  // Rows pointing at a missing weapon are unlinked (and dropped by fromV3).
  const link = (attack: LinkedAttack): LinkedAttack => ({
    ...attack,
    rows: attack.rows.map((r) => (findWeapon(library, r.weaponId) ? r : { ...r, weaponId: null })),
  });

  let attacks = list(raw.attacks, toLinkedAttack).map(link);
  if (attacks.length === 0) {
    attacks = emptyLibrary ? fallback.attacks : [{ id: uid('attack'), name: 'Attack', rows: [{ id: uid('row'), models: 1, weaponId: library[0].id }] }];
  }
  const activeAttackId = typeof raw.activeAttackId === 'string' && attacks.some((a) => a.id === raw.activeAttackId) ? raw.activeAttackId : attacks[0].id;
  const defenderPresets = list(raw.defenderPresets, toDefenderPreset);

  return {
    library,
    attacks,
    activeAttackId,
    defender: toDefender(raw.defender) ?? fallback.defender,
    defenderPresets,
    activeDefenderPresetId: activeId(raw.activeDefenderPresetId, defenderPresets),
    conditions: toConditions(raw.conditions),
    iterations: num(raw.iterations, DEFAULT_ITERATIONS),
  };
}

const activeId = (id: unknown, items: { id: string }[]): string | null => (typeof id === 'string' && items.some((p) => p.id === id) ? id : null);

// ---------- v2 → v3 (then v3 → v4) ----------

/** A v2 attack preset: a name plus snapshot copies of its rows. */
interface SnapshotPreset {
  id: string;
  name: string;
  rows: RowSnapshot[];
}

/**
 * The v2 state: one live attack (`rows`) plus attack presets holding snapshot copies. v2 also
 * had unit presets; those are dropped on migration (units no longer exist).
 */
interface V2State {
  library: StoredWeapon[];
  rows: LinkedRow[];
  defender: DefenderProfile;
  iterations: number;
  attackPresets: SnapshotPreset[];
  defenderPresets: DefenderPreset[];
  activeAttackPresetId: string | null;
  activeDefenderPresetId: string | null;
  conditions: AttackConditions;
}

/** The v2 defaults: one "Bolt rifle" profile and a row of 10 models. */
function defaultV2(): V2State {
  const { library, attacks } = defaultV3();
  return {
    library,
    rows: attacks[0].rows,
    defender: defaultDefender(),
    iterations: DEFAULT_ITERATIONS,
    attackPresets: [],
    defenderPresets: [],
    activeAttackPresetId: null,
    activeDefenderPresetId: null,
    conditions: noConditions(),
  };
}

/** Parse v2 data and convert it to v3. */
export function migrateV2(raw: unknown): V3State {
  return fromV2(normaliseV2(raw));
}

/**
 * v2 → v3. Attack presets become linked attacks through `materialiseRows`, which
 * reuses library entries with the same stats instead of duplicating them. The live rows
 * become the active attack: the active preset itself when they still match it (no unlinked
 * row and the same snapshot, the v2 "not modified" check), otherwise a new attack named
 * `Preset (modified)`, or `Current attack` when no preset was active, so no work is lost.
 */
function fromV2(v2: V2State): V3State {
  let library = [...v2.library];
  const active = v2.attackPresets.find((p) => p.id === v2.activeAttackPresetId);
  const clean = active !== undefined && v2.rows.every((r) => findWeapon(library, r.weaponId)) && sameRows(snapshotRows(v2.rows, library), active.rows);

  const link = (preset: SnapshotPreset): LinkedAttack => {
    // The clean active preset is the live attack: keep its rows, linked as they were.
    if (clean && preset === active) return { id: preset.id, name: preset.name, rows: v2.rows };
    const linked = materialiseRows(preset.rows, library, preset.name);
    library = linked.library;
    return { id: preset.id, name: preset.name, rows: linked.rows };
  };
  const attacks = v2.attackPresets.map(link);

  let activeAttackId: string;
  if (clean) {
    activeAttackId = active.id;
  } else {
    const suffix = ' (modified)';
    const base = active ? `${active.name.slice(0, MAX_NAME - suffix.length).trimEnd()}${suffix}` : 'Current attack';
    const current: LinkedAttack = { id: uid('attack'), name: uniqueName(attacks.map((a) => a.name), base), rows: v2.rows };
    attacks.push(current);
    activeAttackId = current.id;
  }

  return {
    library,
    attacks,
    activeAttackId,
    defender: v2.defender,
    defenderPresets: v2.defenderPresets,
    activeDefenderPresetId: v2.activeDefenderPresetId,
    conditions: v2.conditions,
    iterations: v2.iterations,
  };
}

/** Check the shape of parsed v2 data and repair what can be repaired. */
function normaliseV2(raw: unknown): V2State {
  const fallback = defaultV2();
  if (!isRecord(raw)) return fallback;

  let library = list(raw.library, toStoredWeapon);
  let rows = list(raw.rows, toLinkedRow).map((r) => (library.some((w) => w.id === r.weaponId) ? r : { ...r, weaponId: null }));
  if (library.length === 0) {
    library = fallback.library;
    rows = fallback.rows;
  } else if (rows.length === 0) {
    rows = [{ id: uid('row'), models: 1, weaponId: library[0].id }];
  }

  const attackPresets = list(raw.attackPresets, toSnapshotPreset);
  const defenderPresets = list(raw.defenderPresets, toDefenderPreset);

  return {
    library,
    rows,
    defender: toDefender(raw.defender) ?? fallback.defender,
    iterations: num(raw.iterations, DEFAULT_ITERATIONS),
    attackPresets,
    defenderPresets,
    activeAttackPresetId: activeId(raw.activeAttackPresetId, attackPresets),
    activeDefenderPresetId: activeId(raw.activeDefenderPresetId, defenderPresets),
    conditions: toConditions(raw.conditions),
  };
}

// ---------- v1 → v3 (then v3 → v4) ----------

/**
 * v1 stored `{ weapons: WeaponProfile[], defender, iterations }`. Each weapon becomes a
 * library entry (deduplicated by name + stats) plus a row linked to it. Those rows are a
 * v2 live attack without a preset, so they become the attack "Current attack".
 */
export function migrateV1(raw: unknown): V3State {
  return fromV2(v1ToV2(raw));
}

function v1ToV2(raw: unknown): V2State {
  const fallback = defaultV2();
  if (!isRecord(raw) || !Array.isArray(raw.weapons)) return fallback;

  const library: StoredWeapon[] = [];
  const rows: LinkedRow[] = [];
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
  const defender = toDefender(raw.defender) ?? fallback.defender;
  if (library.length === 0) return { ...fallback, defender };
  return { ...fallback, library, rows, defender, iterations: num(raw.iterations, DEFAULT_ITERATIONS) };
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
    melta: toAbilityDice(value.melta),
    lance: value.lance === true,
    twinLinked: value.twinLinked === true,
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
 * X of Sustained Hits / Blast / Cleave / Rapid Fire / Melta: a non-empty dice expression, or null. Blast and
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

function toLinkedRow(value: unknown): LinkedRow | null {
  if (!isRecord(value) || typeof value.id !== 'string') return null;
  return { id: value.id, models: num(value.models, 1), weaponId: typeof value.weaponId === 'string' ? value.weaponId : null };
}

function toSnapshot(value: unknown): RowSnapshot | null {
  if (!isRecord(value) || typeof value.weaponId !== 'string') return null;
  const weapon = toWeaponStats(value.weapon);
  return weapon ? { models: num(value.models, 1), weaponId: value.weaponId, weapon } : null;
}

function toSnapshotPreset(value: unknown): SnapshotPreset | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  return { id: value.id, name: value.name, rows: list(value.rows, toSnapshot) };
}

/** A v3 attack: rows linked to the library by `weaponId`. */
function toLinkedAttack(value: unknown): LinkedAttack | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  return { id: value.id, name: value.name, rows: list(value.rows, toLinkedRow) };
}

/** A v4 row: models plus a weapon copy. A row without a usable weapon copy is dropped. */
function toProfileRow(value: unknown): ProfileRow | null {
  if (!isRecord(value)) return null;
  const weapon = toWeaponStats(value.weapon);
  if (!weapon) return null;
  return { id: typeof value.id === 'string' && value.id !== '' ? value.id : uid('row'), models: num(value.models, 1), weapon };
}

function toProfile(value: unknown): Profile | null {
  if (!isRecord(value) || typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  return { id: value.id, name: value.name, rows: list(value.rows, toProfileRow) };
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
