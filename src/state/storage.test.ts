import { describe, expect, it } from 'vitest';
import { noAbilities, noConditions, type ProfileRow, type StoredWeapon } from '../types';
import { sameRows } from './presets';
import { LEGACY_STORAGE_KEY, STORAGE_KEY, V2_STORAGE_KEY, V3_STORAGE_KEY, defaultState, loadState, saveState, type KeyValueStorage, type StoredState } from './storage';

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

const activeProfile = (state: StoredState) => state.profiles.find((p) => p.id === state.activeProfileId);
/** [models, weapon name, AP] per row: enough to tell the weapon copies apart. */
const copies = (rows: ProfileRow[]) => rows.map((r) => [r.models, r.weapon.name, r.weapon.ap]);

const v1 = {
  weapons: [
    { id: 'weapon-a', name: 'Bolt rifles', models: 10, attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1' },
    { id: 'weapon-b', name: 'Lascannon', models: 1, attacks: '1', skill: 3, strength: 12, ap: -3, damage: 'D6+1' },
    { id: 'weapon-c', name: 'Bolt rifles', models: 5, attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1' },
    { id: 'weapon-d', name: 'Bolt rifles', models: 5, attacks: '2', skill: 3, strength: 4, ap: -2, damage: '1' },
  ],
  defender: { models: 5, toughness: 10, save: 2, invuln: 4, wounds: 12 },
  iterations: 50_000,
};

const bolt = (): StoredWeapon => ({ id: 'w-bolt', name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() });
const las = (): StoredWeapon => ({ id: 'w-las', name: 'Lascannon', attacks: '1', skill: 3, strength: 12, ap: -3, damage: 'D6+1', abilities: noAbilities() });
const plasma = (): StoredWeapon => ({ id: 'w-plasma', name: 'Plasma gun', attacks: '1', skill: 3, strength: 7, ap: -2, damage: '1', abilities: noAbilities() });
const stats = ({ id: _, ...weapon }: StoredWeapon) => weapon;
const snap = (models: number, { id, ...weapon }: StoredWeapon) => ({ models, weaponId: id, weapon });
const meq = () => ({ models: 10, toughness: 4, save: 3, invuln: null, wounds: 2, keywords: [] });

// ---------- v3 fixture ----------

/** A v3 save: two attacks linked to the library, one row pointing at a deleted weapon. */
function v3(overrides: Record<string, unknown> = {}) {
  return {
    library: [bolt(), las()],
    attacks: [
      {
        id: 'a1',
        name: 'Gunline',
        rows: [
          { id: 'r1', models: 10, weaponId: 'w-bolt' },
          { id: 'r2', models: 3, weaponId: 'deleted' },
          { id: 'r3', models: 1, weaponId: 'w-las' },
        ],
      },
      { id: 'a2', name: 'Bolters', rows: [{ id: 'r4', models: 20, weaponId: 'w-bolt' }] },
    ],
    activeAttackId: 'a2',
    defender: { ...meq(), toughness: 5 },
    defenderPresets: [{ id: 'd1', name: 'MEQ', defender: meq() }],
    activeDefenderPresetId: 'd1',
    conditions: { halfRange: true, charged: false },
    iterations: 5_000,
    ...overrides,
  };
}

const loadV3 = (data: unknown) => loadState(memoryStorage({ [V3_STORAGE_KEY]: JSON.stringify(data) }));

// ---------- v2 fixture ----------

/**
 * A v2 save: live rows matching the active preset "Gunline", a second preset, a defender preset
 * and a unit preset whose weapon is not in the library (units are dropped on migration).
 */
function v2(overrides: Record<string, unknown> = {}) {
  return {
    library: [bolt(), las()],
    rows: [
      { id: 'r1', models: 10, weaponId: 'w-bolt' },
      { id: 'r2', models: 1, weaponId: 'w-las' },
    ],
    defender: { ...meq(), toughness: 5 },
    iterations: 5_000,
    attackPresets: [
      { id: 'a1', name: 'Gunline', rows: [snap(10, bolt()), snap(1, las())] },
      { id: 'a2', name: 'Bolters', rows: [snap(20, bolt())] },
    ],
    unitPresets: [{ id: 'u1', name: 'Hellblasters', rows: [snap(5, plasma())] }],
    defenderPresets: [{ id: 'd1', name: 'MEQ', defender: meq() }],
    activeAttackPresetId: 'a1',
    activeDefenderPresetId: 'd1',
    conditions: { halfRange: true, charged: false },
    ...overrides,
  };
}

const loadV2 = (data: unknown) => loadState(memoryStorage({ [V2_STORAGE_KEY]: JSON.stringify(data) }));

describe('loadState', () => {
  it('returns the default loadout when storage is empty', () => {
    const state = loadState(memoryStorage());
    expect(state.library).toHaveLength(1);
    expect(state.library[0]).toMatchObject({ name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1' });
    expect(state.profiles).toEqual([{ id: state.activeProfileId, name: 'Bolt rifles', rows: [{ id: expect.any(String), models: 10, weapon: stats(state.library[0]) }] }]);
    // The working area is a copy of the active profile.
    const profile = activeProfile(state)!;
    expect(sameRows(state.rows, profile.rows)).toBe(true);
    expect(state.rows[0].id).not.toBe(profile.rows[0].id);
    expect(state.rows[0].weapon).not.toBe(profile.rows[0].weapon);
    expect(state.defender).toEqual({ models: 10, toughness: 4, save: 3, invuln: null, wounds: 2, keywords: [] });
    expect(state.iterations).toBe(10_000);
  });

  it('prefers v4 over v3 over v2 over v1', () => {
    const saved = defaultState();
    saved.iterations = 777;
    const v1Text = JSON.stringify(v1);
    const v2Text = JSON.stringify(v2({ iterations: 2_000 }));
    const v3Text = JSON.stringify(v3({ iterations: 3_000 }));
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved), [V3_STORAGE_KEY]: v3Text, [V2_STORAGE_KEY]: v2Text, [LEGACY_STORAGE_KEY]: v1Text })).iterations).toBe(777);
    expect(loadState(memoryStorage({ [V3_STORAGE_KEY]: v3Text, [V2_STORAGE_KEY]: v2Text, [LEGACY_STORAGE_KEY]: v1Text })).iterations).toBe(3_000);
    expect(loadState(memoryStorage({ [V2_STORAGE_KEY]: v2Text, [LEGACY_STORAGE_KEY]: v1Text })).iterations).toBe(2_000);
    expect(loadState(memoryStorage({ [LEGACY_STORAGE_KEY]: v1Text })).iterations).toBe(50_000);
  });

  it('falls back to the defaults on corrupt JSON', () => {
    expect(loadState(memoryStorage({ [STORAGE_KEY]: '{not json' })).library[0].name).toBe('Bolt rifle');
    expect(loadState(memoryStorage({ [V3_STORAGE_KEY]: '{not json' })).library[0].name).toBe('Bolt rifle');
    expect(loadState(memoryStorage({ [V2_STORAGE_KEY]: '{not json' })).library[0].name).toBe('Bolt rifle');
    expect(loadState(memoryStorage({ [LEGACY_STORAGE_KEY]: 'nope' })).library[0].name).toBe('Bolt rifle');
    expect(loadState(memoryStorage({ [STORAGE_KEY]: '42' })).rows).toHaveLength(1);
  });

  it('round trips through saveState under the v4 key only', () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.library[0].abilities = { ...noAbilities(), lethalHits: true, sustainedHits: '2', devastatingWounds: true, blast: 'D6+2', cleave: '1' };
    state.rows[0].weapon.abilities = { ...noAbilities(), anti: { vehicle: 4 } };
    state.profiles.push({ id: 'p2', name: 'Twice', rows: [{ id: 'r9', models: 5, weapon: stats(las()) }] });
    state.activeProfileId = 'p2';
    saveState(state, storage);
    expect(Object.keys(storage.data)).toEqual([STORAGE_KEY]);
    expect(loadState(storage)).toEqual(state);
  });

  it('keeps an empty library, no profiles and an empty working area', () => {
    const saved = { ...defaultState(), library: [], profiles: [], rows: [], activeProfileId: null, iterations: 2_000 };
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.library).toEqual([]);
    expect(state.profiles).toEqual([]);
    expect(state.rows).toEqual([]);
    expect(state.activeProfileId).toBeNull();
    expect(state.iterations).toBe(2_000);
  });

  it('repairs rows: fills in missing abilities and ids, drops rows without a usable weapon copy', () => {
    const saved = JSON.parse(JSON.stringify(defaultState()));
    const { abilities: _, ...noAbilitiesWeapon } = stats(las());
    saved.rows = [
      { id: 'r1', models: 2, weapon: noAbilitiesWeapon },
      { models: 4, weapon: stats(bolt()) },
      { id: 'r3', models: 1, weapon: { name: 'No attacks' } },
      { id: 'r4', models: 1 },
      'junk',
    ];
    saved.profiles[0].rows.push({ id: 'r5', models: 1, weapon: 'gone' });
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.rows).toEqual([
      { id: 'r1', models: 2, weapon: { ...stats(las()), abilities: noAbilities() } },
      { id: expect.any(String), models: 4, weapon: stats(bolt()) },
    ]);
    expect(state.profiles[0].rows).toHaveLength(1);
  });

  it('keeps out-of-range values on rows for validation to flag', () => {
    const saved = JSON.parse(JSON.stringify(defaultState()));
    saved.rows[0].models = 99;
    saved.rows[0].weapon.strength = 40;
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.rows[0].models).toBe(99);
    expect(state.rows[0].weapon.strength).toBe(40);
  });

  it('drops malformed profiles and repairs stale active ids', () => {
    const saved = JSON.parse(JSON.stringify(defaultState()));
    saved.profiles.push({ id: 7, name: 'Bad id', rows: [] }, 'junk', { id: 'p2', name: 'Empty', rows: [] });
    saved.activeProfileId = 'missing';
    saved.activeDefenderPresetId = 'missing';
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.profiles.map((p) => p.name)).toEqual(['Bolt rifles', 'Empty']);
    expect(state.activeProfileId).toBeNull();
    expect(state.activeDefenderPresetId).toBeNull();
    // Detaching keeps the working area.
    expect(state.rows).toHaveLength(1);
  });

  it('gives weapons saved without abilities (and v1 weapons) no abilities', () => {
    const saved = JSON.parse(JSON.stringify(defaultState()));
    delete saved.library[0].abilities;
    const none = { ...noAbilities(), lethalHits: false, sustainedHits: null, devastatingWounds: false };
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) })).library[0].abilities).toEqual(none);
    // A v2 attack preset whose weapon copy has no abilities.
    const old = v2({ attackPresets: [{ id: 'a', name: 'A', rows: [{ models: 1, weaponId: 'x', weapon: { name: 'Gun', attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1' } }] }] });
    const migrated = loadV2(old);
    expect(migrated.library.find((w) => w.name === 'Gun')?.abilities).toEqual(none);
    expect(migrated.profiles[0].rows[0].weapon.abilities).toEqual(none);
    expect(loadState(memoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(v1) })).library[0].abilities).toEqual(none);
  });

  it('repairs malformed abilities', () => {
    const saved = JSON.parse(JSON.stringify(defaultState()));
    saved.library[0].abilities = { lethalHits: 'yes', sustainedHits: '', devastatingWounds: true, blast: 1.5, cleave: [] };
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.library[0].abilities).toEqual({ ...noAbilities(), lethalHits: false, sustainedHits: null, devastatingWounds: true });
  });

  it('keeps ability X as text and migrates whole-number Blast / Cleave saved before dice', () => {
    const saved = JSON.parse(JSON.stringify(defaultState()));
    saved.library[0].abilities = { lethalHits: false, sustainedHits: 2, devastatingWounds: false, blast: 2, cleave: '2' };
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.library[0].abilities).toEqual({ ...noAbilities(), sustainedHits: '2', blast: '2', cleave: '2' });
    saved.library[0].abilities = { blast: 0, cleave: '  ' };
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) })).library[0].abilities).toEqual(noAbilities());
  });

  it('round trips defender keywords and Anti abilities', () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.defender.keywords = ['vehicle', 'fly'];
    state.library[0].abilities = { ...noAbilities(), devastatingWounds: true, anti: { vehicle: 4, monster: 4, infantry: 2 } };
    state.defenderPresets.push({ id: 'd1', name: 'Tank', defender: { ...state.defender, keywords: ['vehicle'] } });
    saveState(state, storage);
    expect(loadState(storage)).toEqual(state);
  });

  it('keeps only known keywords, without duplicates, in display order', () => {
    const saved = JSON.parse(JSON.stringify(defaultState()));
    saved.defender.keywords = ['fly', 'titanic', 'vehicle', 'fly', 3, null, 'Monster'];
    saved.defenderPresets = [{ id: 'd1', name: 'X', defender: { ...saved.defender, keywords: 'vehicle' } }];
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.defender.keywords).toEqual(['vehicle', 'fly']);
    expect(state.defenderPresets[0].defender.keywords).toEqual([]);
  });

  it('keeps known Anti keywords with a number as Y, dropping the rest', () => {
    const saved = JSON.parse(JSON.stringify(defaultState()));
    saved.library[0].abilities = { anti: { vehicle: 4, titanic: 3, monster: '4', psyker: null, fly: 9 } };
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    // Y out of range is kept: validation flags it in the UI.
    expect(state.library[0].abilities.anti).toEqual({ vehicle: 4, fly: 9 });
    saved.library[0].abilities = { anti: [4] };
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) })).library[0].abilities.anti).toEqual({});
  });

  it('gives data saved before keywords and Anti existed none', () => {
    const saved = JSON.parse(JSON.stringify(defaultState()));
    delete saved.defender.keywords;
    delete saved.library[0].abilities.anti;
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.defender.keywords).toEqual([]);
    expect(state.library[0].abilities.anti).toEqual({});
  });

  it('round trips Rapid Fire and Lance, and gives weapons saved before them none', () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.library[0].abilities = { ...noAbilities(), rapidFire: 'D3', lance: true };
    saveState(state, storage);
    expect(loadState(storage)).toEqual(state);

    const saved = JSON.parse(JSON.stringify(defaultState()));
    delete saved.library[0].abilities.rapidFire;
    delete saved.library[0].abilities.lance;
    const loaded = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(loaded.library[0].abilities).toEqual(noAbilities());

    saved.library[0].abilities = { rapidFire: 1, lance: 'yes' };
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) })).library[0].abilities).toEqual({ ...noAbilities(), rapidFire: '1' });
  });

  it('round trips Melta, gives weapons saved before it none, and turns a whole number into text', () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.library[0].abilities = { ...noAbilities(), melta: 'D3+1' };
    saveState(state, storage);
    expect(loadState(storage)).toEqual(state);

    const saved = JSON.parse(JSON.stringify(defaultState()));
    delete saved.library[0].abilities.melta;
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) })).library[0].abilities).toEqual(noAbilities());
    saved.library[0].abilities = { melta: 2 };
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) })).library[0].abilities).toEqual({ ...noAbilities(), melta: '2' });
    saved.library[0].abilities = { melta: '  ' };
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) })).library[0].abilities).toEqual(noAbilities());
  });

  it('round trips Twin-linked, and gives weapons saved before it none', () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.library[0].abilities = { ...noAbilities(), twinLinked: true };
    saveState(state, storage);
    expect(loadState(storage)).toEqual(state);

    const saved = JSON.parse(JSON.stringify(defaultState()));
    delete saved.library[0].abilities.twinLinked;
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) })).library[0].abilities).toEqual(noAbilities());
    saved.library[0].abilities = { twinLinked: 'yes' };
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) })).library[0].abilities).toEqual(noAbilities());
  });

  it('defaults, repairs and round trips the attack conditions', () => {
    expect(defaultState().conditions).toEqual(noConditions());

    const saved = JSON.parse(JSON.stringify(defaultState()));
    delete saved.conditions;
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) })).conditions).toEqual(noConditions());
    saved.conditions = 'on';
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) })).conditions).toEqual(noConditions());
    saved.conditions = { halfRange: 'yes', charged: true };
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) })).conditions).toEqual({ halfRange: false, charged: true });
    expect(loadState(memoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(v1) })).conditions).toEqual(noConditions());

    const storage = memoryStorage();
    const state = defaultState();
    state.conditions = { halfRange: true, charged: true };
    saveState(state, storage);
    expect(loadState(storage)).toEqual(state);
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
    expect(loadState(broken).library).toHaveLength(1);
    expect(() => saveState(defaultState(), broken)).not.toThrow();
  });
});

describe('v3 → v4 migration', () => {
  it('turns every attack into a profile with the same id and name, copying its weapons', () => {
    const state = loadV3(v3());
    expect(state.profiles.map((p) => [p.id, p.name])).toEqual([
      ['a1', 'Gunline'],
      ['a2', 'Bolters'],
    ]);
    expect(state.profiles[1].rows).toEqual([{ id: 'r4', models: 20, weapon: stats(bolt()) }]);
    expect(state.library).toEqual([bolt(), las()]);
  });

  it('drops rows whose weapon is missing', () => {
    const state = loadV3(v3());
    expect(copies(state.profiles[0].rows)).toEqual([
      [10, 'Bolt rifle', -1],
      [1, 'Lascannon', -3],
    ]);
  });

  it('keeps the active attack active and loads a copy of it into the working area', () => {
    const state = loadV3(v3());
    expect(state.activeProfileId).toBe('a2');
    expect(copies(state.rows)).toEqual([[20, 'Bolt rifle', -1]]);
    expect(state.rows[0].id).not.toBe('r4');
    expect(state.rows[0].weapon).not.toBe(state.profiles[1].rows[0].weapon);
  });

  it('keeps the defender, its presets, the conditions and the iterations', () => {
    const state = loadV3(v3());
    expect(state.defender).toEqual({ ...meq(), toughness: 5 });
    expect(state.defenderPresets).toEqual(v3().defenderPresets);
    expect(state.activeDefenderPresetId).toBe('d1');
    expect(state.conditions).toEqual({ halfRange: true, charged: false });
    expect(state.iterations).toBe(5_000);
  });

  it('makes the first attack active when the active id is stale', () => {
    const state = loadV3(v3({ activeAttackId: 'missing' }));
    expect(state.activeProfileId).toBe('a1');
    expect(copies(state.rows)).toEqual(copies(state.profiles[0].rows));
  });

  it('falls back to the defaults for an empty v3 save', () => {
    const state = loadV3(v3({ library: [], attacks: [] }));
    expect(state.library.map((w) => w.name)).toEqual(['Bolt rifle']);
    expect(state.profiles.map((p) => p.name)).toEqual(['Bolt rifles']);
    expect(copies(state.rows)).toEqual([[10, 'Bolt rifle', -1]]);
  });

  it('ignores the units of a v3 save made while units existed', () => {
    const state = loadV3({ ...v3(), units: [{ id: 'u1', name: 'Squad', rows: [{ id: 'r8', models: 4, weaponId: 'w-bolt' }] }] });
    expect(state).not.toHaveProperty('units');
    expect(state.profiles.map((p) => p.name)).toEqual(['Gunline', 'Bolters']);
  });

  it('leaves the v3 key in place and saves v4 next to it', () => {
    const old = JSON.stringify(v3());
    const storage = memoryStorage({ [V3_STORAGE_KEY]: old });
    const state = loadState(storage);
    saveState(state, storage);
    expect(storage.data[V3_STORAGE_KEY]).toBe(old);
    expect(Object.keys(storage.data).sort()).toEqual([V3_STORAGE_KEY, STORAGE_KEY].sort());
    expect(loadState(storage)).toEqual(state);
  });
});

describe('v2 → v4 migration (through v3)', () => {
  it('makes the clean active preset the active profile, loaded into the working area', () => {
    const state = loadV2(v2());
    expect(state.profiles.map((p) => [p.id, p.name])).toEqual([
      ['a1', 'Gunline'],
      ['a2', 'Bolters'],
    ]);
    expect(state.activeProfileId).toBe('a1');
    expect(copies(state.profiles[0].rows)).toEqual([
      [10, 'Bolt rifle', -1],
      [1, 'Lascannon', -3],
    ]);
    expect(copies(state.rows)).toEqual(copies(state.profiles[0].rows));
    expect(copies(state.profiles[1].rows)).toEqual([[20, 'Bolt rifle', -1]]);
    // Every preset weapon matched a library entry: nothing was added.
    expect(state.library).toEqual([bolt(), las()]);
  });

  it('drops the unit presets without restoring their weapons', () => {
    const state = loadV2(v2());
    expect(state).not.toHaveProperty('units');
    expect(state.profiles.map((p) => p.name)).toEqual(['Gunline', 'Bolters']);
    expect(state.library.map((w) => w.id)).toEqual(['w-bolt', 'w-las']);
  });

  it('keeps the defender, its presets, the conditions and the iterations', () => {
    const state = loadV2(v2());
    expect(state.defender).toEqual({ ...meq(), toughness: 5 });
    expect(state.defenderPresets).toEqual(v2().defenderPresets);
    expect(state.activeDefenderPresetId).toBe('d1');
    expect(state.conditions).toEqual({ halfRange: true, charged: false });
    expect(state.iterations).toBe(5_000);
  });

  it('keeps a modified active preset as it was saved and adds the live rows as "Name (modified)"', () => {
    const rows = [
      { id: 'r1', models: 9, weaponId: 'w-bolt' },
      { id: 'r2', models: 1, weaponId: 'w-las' },
    ];
    const state = loadV2(v2({ rows }));
    expect(state.profiles.map((p) => p.name)).toEqual(['Gunline', 'Bolters', 'Gunline (modified)']);
    const [gunline, , modified] = state.profiles;
    expect(copies(gunline.rows)).toEqual([
      [10, 'Bolt rifle', -1],
      [1, 'Lascannon', -3],
    ]);
    expect(copies(modified.rows)).toEqual([
      [9, 'Bolt rifle', -1],
      [1, 'Lascannon', -3],
    ]);
    expect(state.activeProfileId).toBe(modified.id);
    expect(copies(state.rows)).toEqual(copies(modified.rows));
  });

  it('treats a live row without a weapon as a modification, and drops that row', () => {
    const rows = [...v2().rows, { id: 'r3', models: 2, weaponId: null }];
    const state = loadV2(v2({ rows }));
    expect(state.profiles.map((p) => p.name)).toEqual(['Gunline', 'Bolters', 'Gunline (modified)']);
    expect(copies(activeProfile(state)!.rows)).toEqual([
      [10, 'Bolt rifle', -1],
      [1, 'Lascannon', -3],
    ]);
  });

  it('adds the live rows as "Current attack" when no preset was active, with a unique name', () => {
    const state = loadV2(v2({ activeAttackPresetId: null }));
    expect(state.profiles.map((p) => p.name)).toEqual(['Gunline', 'Bolters', 'Current attack']);
    expect(activeProfile(state)?.name).toBe('Current attack');

    const clash = loadV2(v2({ activeAttackPresetId: 'missing', attackPresets: [{ id: 'a9', name: 'current attack', rows: [snap(1, las())] }] }));
    expect(clash.profiles.map((p) => p.name)).toEqual(['current attack', 'Current attack (2)']);
  });

  it('keeps a "(modified)" name within 40 characters', () => {
    const name = 'x'.repeat(40);
    const state = loadV2(v2({ rows: [{ id: 'r1', models: 3, weaponId: 'w-bolt' }], attackPresets: [{ id: 'a1', name, rows: [snap(10, bolt())] }] }));
    expect(activeProfile(state)?.name).toBe(`${'x'.repeat(29)} (modified)`);
  });

  it('keeps the preset weapon copies, adding changed or deleted ones to the library once', () => {
    const boltAp2 = { ...bolt(), ap: -2 };
    const state = loadV2(
      v2({
        attackPresets: [
          { id: 'a1', name: 'Gunline', rows: [snap(10, bolt()), snap(1, las())] },
          { id: 'a2', name: 'Old bolters', rows: [snap(10, boltAp2), snap(2, plasma())] },
          { id: 'a3', name: 'Hellblasters', rows: [snap(5, plasma())] },
        ],
      }),
    );
    expect(state.library.map((w) => [w.id, w.name])).toEqual([
      ['w-bolt', 'Bolt rifle'],
      ['w-las', 'Lascannon'],
      [expect.any(String), 'Bolt rifle (Old bolters)'],
      ['w-plasma', 'Plasma gun'],
    ]);
    expect(copies(state.profiles[1].rows)).toEqual([
      [10, 'Bolt rifle (Old bolters)', -2],
      [2, 'Plasma gun', -2],
    ]);
    expect(copies(state.profiles[2].rows)).toEqual([[5, 'Plasma gun', -2]]);
  });

  it('migrates v1 weapons into a deduplicated library plus a "Current attack" profile', () => {
    const state = loadState(memoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(v1) }));
    expect(state.library.map((w) => [w.name, w.ap])).toEqual([
      ['Bolt rifles', -1],
      ['Lascannon', -3],
      ['Bolt rifles', -2],
    ]);
    expect(state.profiles.map((p) => p.name)).toEqual(['Current attack']);
    expect(state.activeProfileId).toBe(state.profiles[0].id);
    expect(copies(state.rows)).toEqual([
      [10, 'Bolt rifles', -1],
      [1, 'Lascannon', -3],
      [5, 'Bolt rifles', -1],
      [5, 'Bolt rifles', -2],
    ]);
    expect(state.defenderPresets).toEqual([]);
    expect(state.defender).toEqual({ ...v1.defender, keywords: [] });
    expect(state.iterations).toBe(50_000);
  });

  it('leaves the old keys in place and saves v4 next to them', () => {
    const old = JSON.stringify(v2());
    const legacy = JSON.stringify(v1);
    const storage = memoryStorage({ [V2_STORAGE_KEY]: old, [LEGACY_STORAGE_KEY]: legacy });
    const state = loadState(storage);
    saveState(state, storage);
    expect(storage.data[V2_STORAGE_KEY]).toBe(old);
    expect(storage.data[LEGACY_STORAGE_KEY]).toBe(legacy);
    expect(loadState(storage)).toEqual(state);
  });
});
