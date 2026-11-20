import { describe, expect, it } from 'vitest';
import { noAbilities, noConditions, type StoredWeapon } from '../types';
import { LEGACY_STORAGE_KEY, STORAGE_KEY, V2_STORAGE_KEY, defaultState, loadState, saveState, type KeyValueStorage, type StoredState } from './storage';

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

const activeRows = (state: StoredState) => state.attacks.find((a) => a.id === state.activeAttackId)!.rows;

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

// ---------- v2 fixture ----------

const bolt = (): StoredWeapon => ({ id: 'w-bolt', name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() });
const las = (): StoredWeapon => ({ id: 'w-las', name: 'Lascannon', attacks: '1', skill: 3, strength: 12, ap: -3, damage: 'D6+1', abilities: noAbilities() });
const snap = (models: number, { id, ...weapon }: StoredWeapon) => ({ models, weaponId: id, weapon });
const meq = () => ({ models: 10, toughness: 4, save: 3, invuln: null, wounds: 2, keywords: [] });
const plasma = (): StoredWeapon => ({ id: 'w-plasma', name: 'Plasma gun', attacks: '1', skill: 3, strength: 7, ap: -2, damage: '1', abilities: noAbilities() });

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
const linked = (rows: { models: number; weaponId: string | null }[]) => rows.map((r) => [r.models, r.weaponId]);

describe('loadState', () => {
  it('returns the default loadout when storage is empty', () => {
    const state = loadState(memoryStorage());
    expect(state.library).toHaveLength(1);
    expect(state.library[0]).toMatchObject({ name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1' });
    expect(state.attacks).toEqual([{ id: state.activeAttackId, name: 'Bolt rifles', rows: [{ id: expect.any(String), models: 10, weaponId: state.library[0].id }] }]);
    expect(state).not.toHaveProperty('units');
    expect(state.defender).toEqual({ models: 10, toughness: 4, save: 3, invuln: null, wounds: 2, keywords: [] });
    expect(state.iterations).toBe(10_000);
  });

  it('migrates v1 weapons into a deduplicated library plus the rows of a "Current attack"', () => {
    const state = loadState(memoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(v1) }));
    expect(state.library.map((w) => [w.name, w.ap])).toEqual([
      ['Bolt rifles', -1],
      ['Lascannon', -3],
      ['Bolt rifles', -2],
    ]);
    const [bolt, las, boltAp2] = state.library.map((w) => w.id);
    expect(state.attacks.map((a) => a.name)).toEqual(['Current attack']);
    expect(linked(activeRows(state))).toEqual([
      [10, bolt],
      [1, las],
      [5, bolt],
      [5, boltAp2],
    ]);
    expect(state.defender).toEqual({ ...v1.defender, keywords: [] });
    expect(state.iterations).toBe(50_000);
  });

  it('prefers v3 over v2 over v1', () => {
    const saved = defaultState();
    saved.iterations = 777;
    const v1Text = JSON.stringify(v1);
    const v2Text = JSON.stringify(v2());
    expect(loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved), [V2_STORAGE_KEY]: v2Text, [LEGACY_STORAGE_KEY]: v1Text })).iterations).toBe(777);
    expect(loadState(memoryStorage({ [V2_STORAGE_KEY]: v2Text, [LEGACY_STORAGE_KEY]: v1Text })).iterations).toBe(5_000);
  });

  it('falls back to the defaults on corrupt JSON', () => {
    expect(loadState(memoryStorage({ [STORAGE_KEY]: '{not json' })).library[0].name).toBe('Bolt rifle');
    expect(loadState(memoryStorage({ [V2_STORAGE_KEY]: '{not json' })).library[0].name).toBe('Bolt rifle');
    expect(loadState(memoryStorage({ [LEGACY_STORAGE_KEY]: 'nope' })).library[0].name).toBe('Bolt rifle');
    expect(activeRows(loadState(memoryStorage({ [STORAGE_KEY]: '42' })))).toHaveLength(1);
  });

  it('falls back to the default library and attack when both are empty, keeping the rest', () => {
    const saved = { ...defaultState(), library: [], attacks: [], iterations: 2_000, defenderPresets: [{ id: 'd1', name: 'MEQ', defender: meq() }] };
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.library.map((w) => w.name)).toEqual(['Bolt rifle']);
    expect(state.attacks.map((a) => a.name)).toEqual(['Bolt rifles']);
    expect(activeRows(state)[0].weaponId).toBe(state.library[0].id);
    expect(state.iterations).toBe(2_000);
    expect(state.defenderPresets).toHaveLength(1);
  });

  it('gives a library without attacks one attack using its first weapon', () => {
    const saved = { ...defaultState(), library: [las()], attacks: [] };
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.attacks).toHaveLength(1);
    expect(state.activeAttackId).toBe(state.attacks[0].id);
    expect(linked(activeRows(state))).toEqual([[1, 'w-las']]);
  });

  it('unlinks rows whose weapon is missing and repairs stale active ids', () => {
    const saved = defaultState();
    saved.attacks[0].rows.push({ id: 'r-x', models: 3, weaponId: 'deleted' });
    saved.attacks.push({ id: 'a2', name: 'Second', rows: [] });
    saved.activeAttackId = 'missing';
    saved.activeDefenderPresetId = 'missing';
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.attacks[0].rows[1]).toEqual({ id: 'r-x', models: 3, weaponId: null });
    expect(state.activeAttackId).toBe(state.attacks[0].id);
    expect(state.activeDefenderPresetId).toBeNull();
    // An empty attack is kept: the editor shows it as empty.
    expect(state.attacks[1]).toEqual({ id: 'a2', name: 'Second', rows: [] });
  });

  it('drops malformed attacks and rows', () => {
    const saved = JSON.parse(JSON.stringify(defaultState()));
    saved.attacks.push({ id: 7, name: 'Bad id', rows: [] }, 'junk', { id: 'a2', name: 'Ok', rows: [{ models: 2, weaponId: saved.library[0].id }, 'x'] });
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.attacks.map((a) => a.name)).toEqual(['Bolt rifles', 'Ok']);
    expect(state.attacks[1].rows).toEqual([]);
  });

  it('ignores the units of a v3 save made while units existed, and drops them on the next save', () => {
    const saved = { ...defaultState(), units: [{ id: 'u1', name: 'Squad', rows: [{ id: 'r8', models: 4, weaponId: 'w-unit' }] }] };
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) });
    const state = loadState(storage);
    expect(state).not.toHaveProperty('units');
    const { units: _, ...rest } = saved;
    expect(state).toEqual(rest);
    saveState(state, storage);
    expect(JSON.parse(storage.data[STORAGE_KEY])).not.toHaveProperty('units');
  });

  it('round trips through saveState under the v3 key', () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.library[0].abilities = { ...noAbilities(), lethalHits: true, sustainedHits: '2', devastatingWounds: true, blast: 'D6+2', cleave: '1' };
    state.attacks.push({ id: 'a2', name: 'Twice', rows: [{ id: 'r9', models: 5, weaponId: state.library[0].id }] });
    state.activeAttackId = 'a2';
    saveState(state, storage);
    expect(Object.keys(storage.data)).toEqual([STORAGE_KEY]);
    expect(loadState(storage)).toEqual(state);
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

describe('v2 → v3 migration', () => {
  it('makes the clean active preset the active attack, using the live rows', () => {
    const state = loadV2(v2());
    expect(state.attacks.map((a) => [a.id, a.name])).toEqual([
      ['a1', 'Gunline'],
      ['a2', 'Bolters'],
    ]);
    expect(state.activeAttackId).toBe('a1');
    expect(state.attacks[0].rows).toEqual(v2().rows);
    expect(linked(state.attacks[1].rows)).toEqual([[20, 'w-bolt']]);
    // Every preset weapon matched a library entry: nothing was added.
    expect(state.library).toEqual([bolt(), las()]);
  });

  it('drops the unit presets without restoring their weapons', () => {
    const state = loadV2(v2());
    expect(state).not.toHaveProperty('units');
    expect(state.attacks.map((a) => a.name)).toEqual(['Gunline', 'Bolters']);
    // The plasma gun only lived in the unit preset: it is not added to the library.
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
    expect(state.attacks.map((a) => a.name)).toEqual(['Gunline', 'Bolters', 'Gunline (modified)']);
    const [gunline, , modified] = state.attacks;
    expect(linked(gunline.rows)).toEqual([
      [10, 'w-bolt'],
      [1, 'w-las'],
    ]);
    expect(modified.rows).toEqual(rows);
    expect(state.activeAttackId).toBe(modified.id);
    expect(state.library).toHaveLength(2);
  });

  it('treats a live row without a weapon as a modification', () => {
    const rows = [...v2().rows, { id: 'r3', models: 2, weaponId: null }];
    const state = loadV2(v2({ rows }));
    expect(state.attacks.map((a) => a.name)).toEqual(['Gunline', 'Bolters', 'Gunline (modified)']);
    expect(activeRows(state)).toEqual(rows);
  });

  it('adds the live rows as "Current attack" when no preset was active, with a unique name', () => {
    const state = loadV2(v2({ activeAttackPresetId: null }));
    expect(state.attacks.map((a) => a.name)).toEqual(['Gunline', 'Bolters', 'Current attack']);
    expect(activeRows(state)).toEqual(v2().rows);

    const clash = loadV2(v2({ activeAttackPresetId: 'missing', attackPresets: [{ id: 'a9', name: 'current attack', rows: [snap(1, las())] }] }));
    expect(clash.attacks.map((a) => a.name)).toEqual(['current attack', 'Current attack (2)']);
  });

  it('keeps a "(modified)" name within 40 characters', () => {
    const name = 'x'.repeat(40);
    const state = loadV2(v2({ rows: [{ id: 'r1', models: 3, weaponId: 'w-bolt' }], attackPresets: [{ id: 'a1', name, rows: [snap(10, bolt())] }] }));
    const modified = state.attacks.find((a) => a.id === state.activeAttackId)!;
    expect(modified.name).toBe(`${'x'.repeat(29)} (modified)`);
    expect(modified.name).toHaveLength(40);
  });

  it('links preset weapons to the library without duplicates, adding changed or deleted ones', () => {
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
    // The bolt rifle changed since "Old bolters" was saved: its copy is added once, named after the preset.
    // The plasma gun was deleted from the library: it is restored under its own id, once.
    expect(state.library.map((w) => [w.id, w.name])).toEqual([
      ['w-bolt', 'Bolt rifle'],
      ['w-las', 'Lascannon'],
      [expect.any(String), 'Bolt rifle (Old bolters)'],
      ['w-plasma', 'Plasma gun'],
    ]);
    const copyId = state.library[2].id;
    expect(state.library[2].ap).toBe(-2);
    expect(linked(state.attacks[1].rows)).toEqual([
      [10, copyId],
      [2, 'w-plasma'],
    ]);
    expect(linked(state.attacks[2].rows)).toEqual([[5, 'w-plasma']]);
  });

  it('migrates v1 → v3 through the same conversion', () => {
    const state = loadState(memoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(v1) }));
    expect(state).not.toHaveProperty('units');
    expect(state.defenderPresets).toEqual([]);
    expect(state.attacks).toHaveLength(1);
    expect(state.activeAttackId).toBe(state.attacks[0].id);
  });

  it('leaves the old keys in place and saves v3 next to them', () => {
    const old = JSON.stringify(v2());
    const storage = memoryStorage({ [V2_STORAGE_KEY]: old });
    const state = loadState(storage);
    saveState(state, storage);
    expect(storage.data[V2_STORAGE_KEY]).toBe(old);
    expect(loadState(storage)).toEqual(state);
  });
});
