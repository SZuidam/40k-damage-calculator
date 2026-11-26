import { DEFENDER_KEYWORDS, noAbilities, noConditions, type Army, type AttackConditions, type AttackerSelection, type DefenderKeyword, type DefenderSelection, type LoadoutRow, type StoredWeapon, type Unit, type UnitStats, type WeaponAbilities, type WeaponStats } from '../types';
import { uid } from './ids';
import { DEFAULT_UNIT_MODELS, DEFAULT_WEAPON_COUNT, defaultArmyId, newLoadout, reconcileAttacker, reconcileDefender } from './loadout';
import { pickStats } from './presets';

export const STORAGE_KEY = 'damage-calculator:v5';
/** The v4 state (sessions 13–14): weapon library, profiles and defender presets, plus armies and units. */
export const V4_STORAGE_KEY = 'damage-calculator:v4';

/** Everything the app keeps in localStorage (v5). */
export interface StoredState {
  /** Armies the user defined (free-text names). May be empty. */
  armies: Army[];
  /** Units the user defined, each with its own weapons. May be empty. */
  units: Unit[];
  /** The attacking unit on the main page and the weapons it carries. */
  attacker: AttackerSelection;
  /** The defending unit on the main page and its size. */
  defender: DefenderSelection;
  /** Situational attack conditions (half range, charged): page state only. */
  conditions: AttackConditions;
  iterations: number;
}

/** The subset of the Web Storage API the app uses, so tests can pass an in-memory stub. */
export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>;

const DEFAULT_ITERATIONS = 10_000;

const exampleWeapon = (name: string, attacks: string, ap: number): StoredWeapon => ({
  id: uid('weapon'),
  name,
  attacks,
  skill: 3,
  strength: 4,
  ap,
  damage: '1',
  abilities: noAbilities(),
});

/**
 * A brand-new state: the example army "Space Marines" with an "Intercessor Squad" (bolt rifle,
 * bolt pistol, close combat weapon), picked on both sides: 5 bolt rifles into 5 Intercessors.
 */
export function defaultState(): StoredState {
  return withExample({ armies: [], units: [], attacker: noAttacker(), defender: noDefender(), conditions: noConditions(), iterations: DEFAULT_ITERATIONS });
}

/** `state` plus the example army and unit, picked on both sides with the bolt rifle carried. Only for a state without armies or units. */
function withExample(state: StoredState): StoredState {
  const army: Army = { id: uid('army'), name: 'Space Marines' };
  const unit: Unit = {
    id: uid('unit'),
    name: 'Intercessor Squad',
    armyId: army.id,
    toughness: 4,
    save: 3,
    invuln: null,
    wounds: 2,
    keywords: ['infantry'],
    weapons: [exampleWeapon('Bolt rifle', '2', -1), exampleWeapon('Bolt pistol', '1', 0), exampleWeapon('Close combat weapon', '3', 0)],
  };
  const rows = newLoadout(unit);
  rows[0].carried = true;
  return {
    ...state,
    armies: [army],
    units: [unit],
    attacker: { armyId: army.id, unitId: unit.id, rows },
    defender: { armyId: army.id, unitId: unit.id, models: DEFAULT_UNIT_MODELS },
  };
}

const noAttacker = (): AttackerSelection => ({ armyId: null, unitId: null, rows: [] });
const noDefender = (): DefenderSelection => ({ armyId: null, unitId: null, models: DEFAULT_UNIT_MODELS });

function browserStorage(): KeyValueStorage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined;
  }
}

/**
 * Load v5 state, take the armies and units (plus conditions and iterations) from v4 state, or
 * fall back to the defaults. Never throws. The v4 key and older keys are left in place: saving
 * writes the v5 key only.
 */
export function loadState(storage: KeyValueStorage | undefined = browserStorage()): StoredState {
  if (!storage) return defaultState();
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) return normalise(JSON.parse(raw));
    const v4 = storage.getItem(V4_STORAGE_KEY);
    if (v4) return fromV4(JSON.parse(v4));
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
 * Check the shape of parsed v5 data and repair what can be repaired: malformed entries are
 * dropped, out-of-range values are kept for validation to flag, and the attacker and defender
 * are reconciled with the units (a missing unit is unpicked, the loadout follows the weapons).
 */
function normalise(raw: unknown): StoredState {
  if (!isRecord(raw)) return defaultState();
  const armies = list(raw.armies, toArmy);
  // A unit whose army is gone moves to "No army".
  const units = list(raw.units, toUnit).map((u) => (u.armyId === null || armies.some((a) => a.id === u.armyId) ? u : { ...u, armyId: null }));
  const attacker = toAttacker(raw.attacker);
  const defender = toDefenderSelection(raw.defender);
  // Nothing saved for a side (a v4 save): its army dropdown starts on the first army with units.
  if (!isRecord(raw.attacker)) attacker.armyId = defaultArmyId(armies, units);
  if (!isRecord(raw.defender)) defender.armyId = defaultArmyId(armies, units);
  reconcileAttacker(attacker, armies, units);
  reconcileDefender(defender, armies, units);
  return { armies, units, attacker, defender, conditions: toConditions(raw.conditions), iterations: num(raw.iterations, DEFAULT_ITERATIONS) };
}

/**
 * v4 → v5: keep the armies and units, the attack conditions and the iterations. The weapon
 * library, profiles, working area and defender presets are dropped (units replaced them), and
 * no unit is picked yet. Without any armies or units the example is added, as for a
 * brand-new state.
 */
function fromV4(raw: unknown): StoredState {
  if (!isRecord(raw)) return defaultState();
  const state = normalise({ armies: raw.armies, units: raw.units, conditions: raw.conditions, iterations: raw.iterations });
  return state.armies.length === 0 && state.units.length === 0 ? withExample(state) : state;
}

/** The attacker: ids as saved (reconciled afterwards) and its loadout rows. */
function toAttacker(value: unknown): AttackerSelection {
  if (!isRecord(value)) return noAttacker();
  return { armyId: optionalId(value.armyId), unitId: optionalId(value.unitId), rows: list(value.rows, toLoadoutRow) };
}

function toLoadoutRow(value: unknown): LoadoutRow | null {
  if (!isRecord(value) || typeof value.weaponId !== 'string') return null;
  return { weaponId: value.weaponId, carried: value.carried === true, count: num(value.count, DEFAULT_WEAPON_COUNT) };
}

function toDefenderSelection(value: unknown): DefenderSelection {
  if (!isRecord(value)) return noDefender();
  return { armyId: optionalId(value.armyId), unitId: optionalId(value.unitId), models: num(value.models, DEFAULT_UNIT_MODELS) };
}

const optionalId = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

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

/** The stat line of a unit; non-numbers get T4, Sv 3+, W2. */
function toUnitStats(value: Record<string, unknown>): UnitStats {
  return {
    toughness: num(value.toughness, 4),
    save: num(value.save, 3),
    invuln: typeof value.invuln === 'number' && Number.isFinite(value.invuln) ? value.invuln : null,
    wounds: num(value.wounds, 2),
    keywords: toKeywords(value.keywords),
  };
}

function toArmy(value: unknown): Army | null {
  if (!isRecord(value) || typeof value.id !== 'string' || value.id === '' || typeof value.name !== 'string') return null;
  return { id: value.id, name: value.name };
}

/** A weapon of a unit: a usable weapon profile, with a new id when it has none. */
function toUnitWeapon(value: unknown): StoredWeapon | null {
  const stats = toWeaponStats(value);
  if (!stats || !isRecord(value)) return null;
  return { ...stats, id: typeof value.id === 'string' && value.id !== '' ? value.id : uid('weapon') };
}

/**
 * A unit: a name, its stat line and keywords, and its weapons.
 * Malformed weapons are dropped; out-of-range stats are kept for validation to flag.
 */
export function toUnit(value: unknown): Unit | null {
  if (!isRecord(value) || typeof value.name !== 'string') return null;
  return {
    id: typeof value.id === 'string' && value.id !== '' ? value.id : uid('unit'),
    name: value.name,
    armyId: typeof value.armyId === 'string' ? value.armyId : null,
    ...toUnitStats(value),
    weapons: list(value.weapons, toUnitWeapon),
  };
}
