import { describe, expect, it } from 'vitest';
import { noAbilities } from '../types';
import { LEGACY_STORAGE_KEY, STORAGE_KEY, defaultState, loadState, saveState, type KeyValueStorage } from './storage';

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

describe('loadState', () => {
  it('returns the default loadout when storage is empty', () => {
    const state = loadState(memoryStorage());
    expect(state.library).toHaveLength(1);
    expect(state.library[0]).toMatchObject({ name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1' });
    expect(state.rows).toEqual([{ id: expect.any(String), models: 10, weaponId: state.library[0].id }]);
    expect(state.defender).toEqual({ models: 10, toughness: 4, save: 3, invuln: null, wounds: 2 });
    expect(state.iterations).toBe(10_000);
    expect(state.attackPresets).toEqual([]);
  });

  it('migrates v1 weapons into a deduplicated library plus rows', () => {
    const state = loadState(memoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(v1) }));
    expect(state.library.map((w) => [w.name, w.ap])).toEqual([
      ['Bolt rifles', -1],
      ['Lascannon', -3],
      ['Bolt rifles', -2],
    ]);
    const [bolt, las, boltAp2] = state.library.map((w) => w.id);
    expect(state.rows.map((r) => [r.models, r.weaponId])).toEqual([
      [10, bolt],
      [1, las],
      [5, bolt],
      [5, boltAp2],
    ]);
    expect(state.defender).toEqual(v1.defender);
    expect(state.iterations).toBe(50_000);
    expect(state.activeAttackPresetId).toBeNull();
  });

  it('prefers v2 over v1', () => {
    const saved = defaultState();
    saved.iterations = 777;
    const storage = memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved), [LEGACY_STORAGE_KEY]: JSON.stringify(v1) });
    expect(loadState(storage).iterations).toBe(777);
  });

  it('falls back to the defaults on corrupt JSON', () => {
    expect(loadState(memoryStorage({ [STORAGE_KEY]: '{not json' })).library[0].name).toBe('Bolt rifle');
    expect(loadState(memoryStorage({ [LEGACY_STORAGE_KEY]: 'nope' })).library[0].name).toBe('Bolt rifle');
    expect(loadState(memoryStorage({ [STORAGE_KEY]: '42' })).rows).toHaveLength(1);
  });

  it('falls back to the default library and rows when the library is empty, keeping the rest', () => {
    const saved = { ...defaultState(), library: [], rows: [], iterations: 2_000, defenderPresets: [{ id: 'd1', name: 'MEQ', defender: { models: 5, toughness: 4, save: 3, invuln: null, wounds: 2 } }] };
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.library.map((w) => w.name)).toEqual(['Bolt rifle']);
    expect(state.rows[0].weaponId).toBe(state.library[0].id);
    expect(state.iterations).toBe(2_000);
    expect(state.defenderPresets).toHaveLength(1);
  });

  it('unlinks rows whose weapon is missing and clears stale active preset ids', () => {
    const saved = defaultState();
    saved.rows.push({ id: 'r-x', models: 3, weaponId: 'deleted' });
    saved.activeAttackPresetId = 'missing';
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.rows[1]).toEqual({ id: 'r-x', models: 3, weaponId: null });
    expect(state.activeAttackPresetId).toBeNull();
  });

  it('round trips through saveState', () => {
    const storage = memoryStorage();
    const state = defaultState();
    state.library[0].abilities = { ...noAbilities(), lethalHits: true, sustainedHits: '2', devastatingWounds: true, blast: 2, cleave: 1 };
    const presetWeapon = { name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: { ...noAbilities(), lethalHits: true, sustainedHits: null, devastatingWounds: false } };
    state.attackPresets.push({ id: 'p1', name: 'Test', rows: [{ models: 10, weaponId: state.library[0].id, weapon: presetWeapon }] });
    state.activeAttackPresetId = 'p1';
    saveState(state, storage);
    expect(loadState(storage)).toEqual(state);
  });

  it('gives weapons saved without abilities (and v1 weapons) no abilities', () => {
    const saved = JSON.parse(JSON.stringify(defaultState()));
    delete saved.library[0].abilities;
    saved.unitPresets = [{ id: 'u', name: 'U', rows: [{ models: 1, weaponId: 'x', weapon: { name: 'Gun', attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1' } }] }];
    const none = { ...noAbilities(), lethalHits: false, sustainedHits: null, devastatingWounds: false };
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.library[0].abilities).toEqual(none);
    expect(state.unitPresets[0].rows[0].weapon.abilities).toEqual(none);
    expect(loadState(memoryStorage({ [LEGACY_STORAGE_KEY]: JSON.stringify(v1) })).library[0].abilities).toEqual(none);
  });

  it('repairs malformed abilities', () => {
    const saved = JSON.parse(JSON.stringify(defaultState()));
    saved.library[0].abilities = { lethalHits: 'yes', sustainedHits: 2, devastatingWounds: true, blast: '2', cleave: 1.5 };
    const state = loadState(memoryStorage({ [STORAGE_KEY]: JSON.stringify(saved) }));
    expect(state.library[0].abilities).toEqual({ ...noAbilities(), lethalHits: false, sustainedHits: null, devastatingWounds: true });
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
