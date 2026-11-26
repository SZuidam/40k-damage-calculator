import { describe, expect, it } from 'vitest';
import { noAbilities, noConditions, type StoredWeapon, type Unit } from '../types';
import { STORAGE_KEY, V4_STORAGE_KEY, defaultState, loadState, saveState, type KeyValueStorage } from './storage';

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

const bolt = (): StoredWeapon => ({ id: 'w-bolt', name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() });
const las = (): StoredWeapon => ({ id: 'w-las', name: 'Lascannon', attacks: '1', skill: 3, strength: 12, ap: -3, damage: 'D6+1', abilities: noAbilities() });

const intercessors = (overrides: Partial<Unit> = {}): Unit => ({
  id: 'u1',
  name: 'Intercessors',
  armyId: 'sm',
  toughness: 4,
  save: 3,
  invuln: null,
  wounds: 2,
  keywords: ['infantry'],
  weapons: [bolt(), las()],
  ...overrides,
});

/** A v5 save with one army, one unit, picked on both sides; `overrides` replace top-level keys. */
function v5(overrides: Record<string, unknown> = {}) {
  return {
    armies: [{ id: 'sm', name: 'Space Marines' }],
    units: [intercessors()],
    attacker: {
      armyId: 'sm',
      unitId: 'u1',
      rows: [
        { weaponId: 'w-las', carried: true, count: 1 },
        { weaponId: 'w-bolt', carried: true, count: 9 },
      ],
    },
    defender: { armyId: 'sm', unitId: 'u1', models: 10 },
    conditions: { halfRange: true, charged: false },
    iterations: 5_000,
    ...overrides,
  };
}

const load = (data: unknown) => loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(data) }));

/** Load a v5 save whose first unit's first weapon has `abilities` as saved, and return what it loads as. */
const loadAbilities = (abilities: unknown) => load(v5({ units: [{ ...intercessors(), weapons: [{ ...bolt(), abilities }] }] })).units[0].weapons[0].abilities;

/** A v4 save from session 14: the old library, profiles and defender presets, plus armies and units. */
function v4(overrides: Record<string, unknown> = {}) {
  return {
    library: [bolt()],
    rows: [{ id: 'r1', models: 10, weapon: bolt() }],
    profiles: [{ id: 'p1', name: 'Bolt rifles', rows: [{ id: 'r2', models: 10, weapon: bolt() }] }],
    activeProfileId: 'p1',
    defender: { models: 10, toughness: 4, save: 3, invuln: null, wounds: 2, keywords: [] },
    defenderPresets: [],
    activeDefenderPresetId: null,
    conditions: { halfRange: false, charged: true },
    iterations: 20_000,
    armies: [
      { id: 'sm', name: 'Space Marines' },
      { id: 'ad', name: 'Adeptus Custodes' },
    ],
    units: [intercessors()],
    ...overrides,
  };
}

describe('loadState', () => {
  it('starts with the example army and unit, picked on both sides, when storage is empty', () => {
    const state = loadState(memoryStorage());
    expect(state.armies).toEqual([{ id: expect.any(String), name: 'Space Marines' }]);
    expect(state.units).toHaveLength(1);
    const [unit] = state.units;
    expect(unit).toMatchObject({ name: 'Intercessor Squad', armyId: state.armies[0].id, toughness: 4, save: 3, invuln: null, wounds: 2, keywords: ['infantry'] });
    expect(unit.weapons.map((w) => w.name)).toEqual(['Bolt rifle', 'Bolt pistol', 'Close combat weapon']);
    expect(unit.weapons[0]).toMatchObject({ attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1' });
    // 5 bolt rifles fire; the other weapons start unticked at the default count.
    expect(state.attacker).toEqual({
      armyId: unit.armyId,
      unitId: unit.id,
      rows: [
        { weaponId: unit.weapons[0].id, carried: true, count: 5 },
        { weaponId: unit.weapons[1].id, carried: false, count: 5 },
        { weaponId: unit.weapons[2].id, carried: false, count: 5 },
      ],
    });
    expect(state.defender).toEqual({ armyId: unit.armyId, unitId: unit.id, models: 5 });
    expect(state.conditions).toEqual(noConditions());
    expect(state.iterations).toBe(10_000);
  });

  it('falls back to the defaults on corrupt JSON', () => {
    expect(loadState(memoryStorage({ [STORAGE_KEY]: '{not json' })).units[0].name).toBe('Intercessor Squad');
    expect(loadState(memoryStorage({ [V4_STORAGE_KEY]: '{not json' })).units[0].name).toBe('Intercessor Squad');
    expect(loadState(memoryStorage({ [STORAGE_KEY]: '42' })).units[0].name).toBe('Intercessor Squad');
  });

  it('round trips through saveState under the v5 key only', () => {
    const storage = memoryStorage();
    const state = load(v5());
    state.units[0].weapons[0].abilities = { ...noAbilities(), lethalHits: true, sustainedHits: '2', anti: { vehicle: 4 } };
    saveState(state, storage);
    expect(Object.keys(storage.data)).toEqual([STORAGE_KEY]);
    expect(loadState(storage)).toEqual(state);
    expect(state.attacker.rows).toEqual(v5().attacker.rows);
  });

  it('keeps no armies or units in a v5 save (the example is only for a new state)', () => {
    const state = load(v5({ armies: [], units: [] }));
    expect(state.armies).toEqual([]);
    expect(state.units).toEqual([]);
    expect(state.attacker).toEqual({ armyId: null, unitId: null, rows: [] });
    expect(state.defender).toEqual({ armyId: null, unitId: null, models: 10 });
  });

  it('round trips armies and units with their own weapons', () => {
    const storage = memoryStorage();
    const state = load(v5());
    state.armies.push({ id: 'cd', name: 'Chaos Daemons' });
    state.units.push({ ...intercessors(), id: 'u2', name: 'Test dummy', armyId: null, toughness: 10, save: 2, invuln: 4, wounds: 12, keywords: ['vehicle', 'fly'], weapons: [{ ...bolt(), strength: 5 }] });
    saveState(state, storage);
    expect(loadState(storage)).toEqual(state);
  });

  it('repairs units: stale army, missing ids, unknown keywords, broken weapons', () => {
    const saved = v5({
      armies: [{ id: 'sm', name: 'Space Marines' }, { id: 'broken' }, 'nope', { id: '', name: 'No id' }],
      units: [
        {
          name: 'Intercessors',
          armyId: 'gone',
          toughness: 4,
          save: 3,
          wounds: 2,
          keywords: ['infantry', 'tank', 'infantry'],
          weapons: [{ name: 'Bolt rifle', attacks: '2', damage: '1', skill: 3, strength: 4, ap: -1 }, { name: 'Broken' }, null],
        },
        { id: 'u2', name: 'Tough', armyId: 'sm', toughness: 'x', save: 99, invuln: 'no', wounds: 3 },
        { id: 'u3' },
        42,
      ],
    });
    const state = load(saved);
    expect(state.armies).toEqual([{ id: 'sm', name: 'Space Marines' }]);
    expect(state.units).toHaveLength(2);
    const [first, second] = state.units;
    expect(first.id).toMatch(/^unit-/);
    expect(first.armyId).toBeNull();
    expect(first.invuln).toBeNull();
    expect(first.keywords).toEqual(['infantry']);
    expect(first.weapons).toHaveLength(1);
    expect(first.weapons[0].id).toMatch(/^weapon-/);
    expect(first.weapons[0].abilities).toEqual(noAbilities());
    // Out-of-range numbers are kept for validation to flag; non-numbers get the defaults.
    expect(second).toEqual({ id: 'u2', name: 'Tough', armyId: 'sm', toughness: 4, save: 99, invuln: null, wounds: 3, keywords: [], weapons: [] });
  });

  it('does not throw when storage throws', () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(loadState(broken).units).toHaveLength(1);
    expect(() => saveState(defaultState(), broken)).not.toThrow();
  });
});

describe('attacker and defender on load', () => {
  it('matches the loadout to the unit: drops stale, duplicate and malformed rows, appends missing weapons', () => {
    const state = load(
      v5({
        units: [intercessors({ weapons: [bolt(), las(), { ...bolt(), id: 'w-new', name: 'New gun' }] })],
        attacker: {
          armyId: 'sm',
          unitId: 'u1',
          rows: [
            { weaponId: 'w-las', carried: true, count: 1 },
            { weaponId: 'w-gone', carried: true, count: 3 },
            { weaponId: 'w-las', carried: false, count: 7 },
            { carried: true, count: 2 },
            'nope',
            { weaponId: 'w-bolt', carried: 'yes', count: 'x' },
          ],
        },
      }),
    );
    expect(state.attacker.rows).toEqual([
      { weaponId: 'w-las', carried: true, count: 1 },
      { weaponId: 'w-bolt', carried: false, count: 5 },
      { weaponId: 'w-new', carried: false, count: 5 },
    ]);
  });

  it('keeps out-of-range counts and model numbers for validation to flag', () => {
    const state = load(v5({ attacker: { ...v5().attacker, rows: [{ weaponId: 'w-bolt', carried: true, count: 0 }] }, defender: { armyId: 'sm', unitId: 'u1', models: 99 } }));
    expect(state.attacker.rows[0].count).toBe(0);
    expect(state.defender.models).toBe(99);
  });

  it('unpicks a unit that is gone and keeps the army dropdown on an existing choice', () => {
    const state = load(v5({ attacker: { armyId: 'sm', unitId: 'gone', rows: [{ weaponId: 'w-bolt', carried: true, count: 5 }] }, defender: { armyId: 'gone', unitId: 'gone', models: 'x' } }));
    expect(state.attacker).toEqual({ armyId: 'sm', unitId: null, rows: [] });
    expect(state.defender).toEqual({ armyId: 'sm', unitId: null, models: 5 });
  });

  it('moves the army dropdown to the picked unit’s army', () => {
    const state = load(
      v5({
        armies: [
          { id: 'sm', name: 'Space Marines' },
          { id: 'cd', name: 'Chaos Daemons' },
        ],
        units: [intercessors({ armyId: 'cd' })],
        defender: { armyId: 'sm', unitId: 'u1', models: 5 },
      }),
    );
    expect(state.attacker.armyId).toBe('cd');
    expect(state.defender.armyId).toBe('cd');
  });

  it('starts without a selection when nothing was saved for it', () => {
    const { attacker: _a, defender: _d, ...rest } = v5();
    const state = load(rest);
    expect(state.attacker).toEqual({ armyId: 'sm', unitId: null, rows: [] });
    expect(state.defender).toEqual({ armyId: 'sm', unitId: null, models: 5 });
  });
});

describe('v4 → v5', () => {
  it('keeps the armies, units, conditions and iterations, and drops the rest', () => {
    const storage = memoryStorage({ [V4_STORAGE_KEY]: JSON.stringify(v4()) });
    const state = loadState(storage);
    expect(Object.keys(state).sort()).toEqual(['armies', 'attacker', 'conditions', 'defender', 'iterations', 'units']);
    expect(state.armies).toEqual(v4().armies);
    expect(state.units).toEqual([intercessors()]);
    expect(state.conditions).toEqual({ halfRange: false, charged: true });
    expect(state.iterations).toBe(20_000);
    // No unit is picked yet; the army dropdowns start on the first army (by name) that has units.
    expect(state.attacker).toEqual({ armyId: 'sm', unitId: null, rows: [] });
    expect(state.defender).toEqual({ armyId: 'sm', unitId: null, models: 5 });
  });

  it('starts the army dropdowns on the first army with units, also when some units have no army', () => {
    const units = [intercessors({ armyId: null }), intercessors({ id: 'u2', armyId: 'sm' })];
    const state = loadState(memoryStorage({ [V4_STORAGE_KEY]: JSON.stringify(v4({ units })) }));
    expect(state.attacker.armyId).toBe('sm');
    expect(state.defender.armyId).toBe('sm');
  });

  it('adds the example when the v4 save has no armies or units', () => {
    const state = loadState(memoryStorage({ [V4_STORAGE_KEY]: JSON.stringify(v4({ armies: undefined, units: [] })) }));
    expect(state.units.map((u) => u.name)).toEqual(['Intercessor Squad']);
    expect(state.attacker.unitId).toBe(state.units[0].id);
    expect(state.conditions).toEqual({ halfRange: false, charged: true });
  });

  it('prefers v5 over v4, and leaves the v4 key in place when saving', () => {
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(v5({ iterations: 777 })), [V4_STORAGE_KEY]: JSON.stringify(v4()) });
    expect(loadState(storage).iterations).toBe(777);

    const old = memoryStorage({ [V4_STORAGE_KEY]: JSON.stringify(v4()) });
    saveState(loadState(old), old);
    expect(Object.keys(old.data).sort()).toEqual([V4_STORAGE_KEY, STORAGE_KEY]);
    expect(JSON.parse(old.data[V4_STORAGE_KEY])).toEqual(v4());
  });
});

describe('weapon abilities on load', () => {
  it('gives weapons saved without abilities none', () => {
    const { abilities: _, ...withoutAbilities } = bolt();
    const state = load(v5({ units: [{ ...intercessors(), weapons: [withoutAbilities] }] }));
    expect(state.units[0].weapons[0].abilities).toEqual(noAbilities());
  });

  it('repairs malformed abilities', () => {
    expect(loadAbilities({ lethalHits: 'yes', sustainedHits: '', devastatingWounds: true, blast: 1.5, cleave: [] })).toEqual({ ...noAbilities(), devastatingWounds: true });
  });

  it('keeps ability X as text and turns a whole number into text', () => {
    expect(loadAbilities({ sustainedHits: 2, blast: 2, cleave: '2', rapidFire: 1, melta: 2 })).toEqual({ ...noAbilities(), sustainedHits: '2', blast: '2', cleave: '2', rapidFire: '1', melta: '2' });
    expect(loadAbilities({ blast: 0, cleave: '  ', melta: '  ' })).toEqual(noAbilities());
  });

  it('keeps known Anti keywords with a number as Y, dropping the rest', () => {
    // Y out of range is kept: validation flags it in the UI.
    expect(loadAbilities({ anti: { vehicle: 4, titanic: 3, monster: '4', psyker: null, fly: 9 } }).anti).toEqual({ vehicle: 4, fly: 9 });
    expect(loadAbilities({ anti: [4] }).anti).toEqual({});
  });

  it('only takes true for the on / off abilities', () => {
    expect(loadAbilities({ lance: 'yes', twinLinked: 1, lethalHits: true })).toEqual({ ...noAbilities(), lethalHits: true });
    expect(loadAbilities({ lance: true, twinLinked: true })).toEqual({ ...noAbilities(), lance: true, twinLinked: true });
  });

  it('round trips every ability', () => {
    const storage = memoryStorage();
    const state = load(v5());
    state.units[0].weapons[0].abilities = {
      lethalHits: true,
      sustainedHits: 'D3',
      devastatingWounds: true,
      blast: 'D6+2',
      cleave: '1',
      anti: { vehicle: 4, monster: 4, infantry: 2 },
      rapidFire: 'D3',
      melta: 'D3+1',
      lance: true,
      twinLinked: true,
    };
    saveState(state, storage);
    expect(loadState(storage)).toEqual(state);
  });
});

describe('conditions on load', () => {
  it('defaults, repairs and round trips the attack conditions', () => {
    expect(defaultState().conditions).toEqual(noConditions());
    const { conditions: _, ...withoutConditions } = v5();
    expect(load(withoutConditions).conditions).toEqual(noConditions());
    expect(load(v5({ conditions: 'on' })).conditions).toEqual(noConditions());
    expect(load(v5({ conditions: { halfRange: 'yes', charged: true } })).conditions).toEqual({ halfRange: false, charged: true });
  });
});
