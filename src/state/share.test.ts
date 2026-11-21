import { describe, expect, it } from 'vitest';
import { noAbilities, type ProfileRow, type StoredWeapon } from '../types';
import { pickStats } from './presets';
import {
  SHARE_FORMAT,
  SHARE_VERSION,
  applyImport,
  buildShareFile,
  parseShareText,
  planImport,
  serializeShareFile,
  uniqueName,
  type ShareData,
  type ShareState,
} from './share';

const boltRifle = (): StoredWeapon => ({ id: 'w-bolt', name: 'Bolt rifle', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() });
const lascannon = (): StoredWeapon => ({ id: 'w-las', name: 'Lascannon', attacks: '1', skill: 3, strength: 12, ap: -3, damage: 'D6+1', abilities: noAbilities() });
const meq = () => ({ models: 10, toughness: 4, save: 3, invuln: null, wounds: 2, keywords: [] });
const stats = ({ id: _, ...weapon }: StoredWeapon) => weapon;

const abilityLas = () => ({ ...lascannon(), abilities: { ...noAbilities(), lethalHits: true, sustainedHits: '1', devastatingWounds: false } });
const row = (id: string, models: number, weapon: StoredWeapon): ProfileRow => ({ id, models, weapon: pickStats(weapon) });

/** Profiles hold their own weapon copies, as in the app. */
function sourceState(): ShareState {
  const bolt = boltRifle();
  const las = abilityLas();
  return {
    library: [bolt, las],
    profiles: [
      { id: 'p1', name: 'Gunline', rows: [row('r1', 10, bolt), row('r2', 1, las)] },
      { id: 'p2', name: 'Intercessors', rows: [row('r3', 5, bolt)] },
    ],
    defenderPresets: [{ id: 'd1', name: 'MEQ', defender: meq() }],
  };
}

const everything = (s: ShareState) => ({
  attacks: s.profiles.map((p) => p.id),
  defenders: s.defenderPresets.map((p) => p.id),
  weapons: s.library.map((w) => w.id),
});

function emptyState(): ShareState {
  return { library: [], profiles: [], defenderPresets: [] };
}

/** [models, weapon name, damage] per row. */
const copies = (rows: { models: number; weapon: { name: string; damage: string } }[]) => rows.map((r) => [r.models, r.weapon.name, r.weapon.damage]);

function roundTrip(source = sourceState()): ShareData {
  const parsed = parseShareText(serializeShareFile(buildShareFile(source, everything(source))));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.data;
}

describe('buildShareFile', () => {
  it('exports only the selected items, without profile, preset or row ids', () => {
    const source = sourceState();
    const file = buildShareFile(source, { attacks: ['p2'], defenders: ['d1'], weapons: ['w-las'] }, new Date('2026-11-19T10:00:00Z'));
    expect(file).toMatchObject({ format: SHARE_FORMAT, version: 2, exportedAt: '2026-11-19T10:00:00.000Z' });
    expect(file.attacks).toEqual([{ name: 'Intercessors', rows: [{ models: 5, weapon: stats(boltRifle()) }] }]);
    expect(file.defenders).toEqual([{ name: 'MEQ', defender: meq() }]);
    expect(file.weapons.map((w) => [w.id, w.name, w.abilities.lethalHits])).toEqual([['w-las', 'Lascannon', true]]);
  });

  it("exports the profiles' own weapon copies, not the library", () => {
    const source = sourceState();
    source.library[0].damage = '3';
    source.profiles[0].rows[0].weapon.damage = '2';
    const file = buildShareFile(source, everything(source));
    expect(copies(file.attacks[0].rows)).toEqual([
      [10, 'Bolt rifle', '2'],
      [1, 'Lascannon', 'D6+1'],
    ]);
    const json = JSON.parse(serializeShareFile(file));
    expect(Object.keys(json.attacks[0].rows[0])).toEqual(['models', 'weapon']);
    expect(json.attacks[0].rows[0].weapon).not.toHaveProperty('id');
    // The file holds copies: later edits don't change it.
    source.profiles[0].rows[0].weapon.damage = '4';
    expect(file.attacks[0].rows[0].weapon.damage).toBe('2');
  });

  it('round-trips through JSON unchanged', () => {
    const source = sourceState();
    const data = roundTrip(source);
    expect(data.attacks[0].rows.map((r) => [r.models, r.weapon.name, r.weapon.abilities.sustainedHits])).toEqual([
      [10, 'Bolt rifle', null],
      [1, 'Lascannon', '1'],
    ]);
    expect(data.weapons).toEqual(source.library);
  });

  it('writes no units key', () => {
    const source = sourceState();
    const file = JSON.parse(serializeShareFile(buildShareFile(source, everything(source))));
    expect(Object.keys(file)).toEqual(['format', 'version', 'exportedAt', 'attacks', 'defenders', 'weapons']);
  });
});

describe('keywords and Anti', () => {
  function antiState(): ShareState {
    const state = sourceState();
    state.library[0].abilities = { ...noAbilities(), devastatingWounds: true, anti: { vehicle: 4, monster: 4 } };
    state.defenderPresets[0].defender.keywords = ['vehicle', 'monster'];
    return state;
  }

  it('exports defender keywords and weapon Anti abilities as readable JSON', () => {
    const source = antiState();
    const json = serializeShareFile(buildShareFile(source, everything(source)));
    const file = JSON.parse(json);
    expect(file.defenders[0].defender.keywords).toEqual(['vehicle', 'monster']);
    expect(file.weapons[0].abilities.anti).toEqual({ vehicle: 4, monster: 4 });
  });

  it('imports them back unchanged', () => {
    const source = antiState();
    const data = roundTrip(source);
    expect(data.defenders[0].defender.keywords).toEqual(['vehicle', 'monster']);
    expect(data.weapons[0].abilities.anti).toEqual({ vehicle: 4, monster: 4 });
    const target = emptyState();
    applyImport(data, planImport(data, target), target, 'rename');
    expect(target.defenderPresets[0].defender.keywords).toEqual(['vehicle', 'monster']);
    expect(target.library[0].abilities.anti).toEqual({ vehicle: 4, monster: 4 });
    // The import doesn't share arrays with the parsed data.
    expect(target.defenderPresets[0].defender.keywords).not.toBe(data.defenders[0].defender.keywords);
  });

  it('a defender or weapon differing only in keywords or Anti is a conflict', () => {
    const data = roundTrip(antiState());
    const target = sourceState();
    const plan = planImport(data, target).map((i) => [i.kind, i.name, i.status]);
    expect(plan).toContainEqual(['defenders', 'MEQ', 'conflict']);
    expect(plan).toContainEqual(['weapons', 'Bolt rifle', 'conflict']);
    expect(planImport(data, antiState()).find((i) => i.kind === 'defenders')?.status).toBe('duplicate');
  });
});

describe('abilities survive export and import', () => {
  it.each([
    ['Rapid Fire and Lance', { rapidFire: 'D3', lance: true }],
    ['Melta', { melta: 'D3' }],
    ['Twin-linked', { twinLinked: true }],
  ])('%s', (_, abilities) => {
    const source = sourceState();
    source.library[0].abilities = { ...noAbilities(), ...abilities };
    source.profiles[1].rows[0].weapon.abilities = { ...noAbilities(), ...abilities };
    const file = JSON.parse(serializeShareFile(buildShareFile(source, everything(source))));
    expect(file).not.toHaveProperty('conditions');
    const data = roundTrip(source);
    expect(data.weapons[0].abilities).toEqual({ ...noAbilities(), ...abilities });
    const target = emptyState();
    applyImport(data, planImport(data, target), target, 'rename');
    expect(target.library[0].abilities).toEqual({ ...noAbilities(), ...abilities });
    expect(target.profiles[1].rows[0].weapon.abilities).toEqual({ ...noAbilities(), ...abilities });
  });
});

describe('parseShareText', () => {
  const error = (text: string) => {
    const result = parseShareText(text);
    return result.ok ? null : result.error;
  };

  it('explains why text cannot be imported', () => {
    expect(error('   ')).toMatch(/Paste/);
    expect(error('{ nope')).toMatch(/not valid JSON/);
    expect(error('{"library": []}')).toMatch(/not an export/);
    expect(error(JSON.stringify({ format: SHARE_FORMAT, version: SHARE_VERSION + 1 }))).toMatch(/newer version/);
    expect(error(JSON.stringify({ format: SHARE_FORMAT, version: 2, attacks: [] }))).toMatch(/nothing to import/);
  });

  it('drops malformed entries, trims names and fills in missing abilities', () => {
    const text = JSON.stringify({
      format: SHARE_FORMAT,
      version: 2,
      defenders: [{ name: '  Terminators  ', defender: { models: 5, toughness: 5, save: 2, invuln: 4, wounds: 3 } }, { name: '', defender: meq() }, 'junk'],
      weapons: [{ name: 'Old gun', attacks: '1', skill: 4, strength: 4, ap: 0, damage: '1' }, { name: 'No attacks' }],
      attacks: [{ name: 'x'.repeat(60), rows: [{ models: 2, weapon: { name: ' Old gun ', attacks: '1', skill: 4, strength: 4, ap: 0, damage: '1' } }, { models: 1, weapon: 'junk' }, 'junk'] }],
    });
    const result = parseShareText(text);
    if (!result.ok) throw new Error(result.error);
    // Files from before keywords and Anti existed load with none.
    expect(result.data.defenders).toEqual([{ name: 'Terminators', defender: { models: 5, toughness: 5, save: 2, invuln: 4, wounds: 3, keywords: [] } }]);
    expect(result.data.weapons).toHaveLength(1);
    expect(result.data.weapons[0]).toMatchObject({ name: 'Old gun', abilities: noAbilities(), id: expect.any(String) });
    expect(result.data.attacks[0].name).toHaveLength(40);
    expect(result.data.attacks[0].rows).toEqual([{ models: 2, weapon: { name: 'Old gun', attacks: '1', skill: 4, strength: 4, ap: 0, damage: '1', abilities: noAbilities() } }]);
  });

  it('reads version 1 files: rows with a weaponId are taken as copies', () => {
    const v1 = {
      format: SHARE_FORMAT,
      version: 1,
      attacks: [{ name: 'Gunline', rows: [{ models: 10, weaponId: 'w-bolt', weapon: stats(boltRifle()) }, { models: 1, weaponId: 'w-las', weapon: stats(lascannon()) }] }],
      weapons: [boltRifle()],
    };
    const result = parseShareText(JSON.stringify(v1));
    if (!result.ok) throw new Error(result.error);
    expect(result.data.attacks[0].rows).toEqual([
      { models: 10, weapon: stats(boltRifle()) },
      { models: 1, weapon: stats(lascannon()) },
    ]);
    // Importing only the profile adds nothing to the library: it keeps its copies.
    const target = emptyState();
    const plan = planImport(result.data, target).filter((i) => i.kind === 'attacks');
    expect(applyImport(result.data, plan, target, 'rename')).toEqual({ added: 1, renamed: 0, replaced: 0 });
    expect(target.library).toEqual([]);
    expect(copies(target.profiles[0].rows)).toEqual([
      [10, 'Bolt rifle', '1'],
      [1, 'Lascannon', 'D6+1'],
    ]);
  });

  it('ignores the units of files exported while units existed', () => {
    const unit = { name: 'Intercessors', rows: [{ models: 5, weaponId: 'w-bolt', weapon: stats(boltRifle()) }] };
    expect(parseShareText(JSON.stringify({ format: SHARE_FORMAT, version: 1, units: [unit] }))).toEqual({ ok: false, error: 'This export contains nothing to import.' });

    const result = parseShareText(JSON.stringify({ format: SHARE_FORMAT, version: 1, attacks: [{ ...unit, name: 'Gunline' }], units: [unit] }));
    if (!result.ok) throw new Error(result.error);
    expect(result.data).not.toHaveProperty('units');
    const target = emptyState();
    expect(applyImport(result.data, planImport(result.data, target), target, 'rename')).toEqual({ added: 1, renamed: 0, replaced: 0 });
    expect(target.profiles.map((p) => p.name)).toEqual(['Gunline']);
  });
});

describe('planImport', () => {
  it('marks items as new, duplicate, conflict or invalid', () => {
    const data = roundTrip();
    data.defenders.push({ name: 'Too big', defender: { ...meq(), models: 40, wounds: 40 } });
    data.attacks.push({ name: 'Empty', rows: [] });

    const target = sourceState();
    target.profiles[0].rows[0].models = 5; // same name, different content
    target.library[1] = lascannon(); // Lascannon without abilities

    const plan = planImport(data, target).map((i) => [i.kind, i.name, i.status, i.problem]);
    expect(plan).toEqual([
      ['attacks', 'Gunline', 'conflict', undefined],
      ['attacks', 'Intercessors', 'duplicate', undefined],
      ['attacks', 'Empty', 'invalid', 'Has no weapons'],
      ['defenders', 'MEQ', 'duplicate', undefined],
      ['defenders', 'Too big', 'invalid', 'Models × wounds must be at most 400'],
      ['weapons', 'Bolt rifle', 'duplicate', undefined],
      ['weapons', 'Lascannon', 'conflict', undefined],
    ]);
  });

  it('compares profiles by their own copies, not the library', () => {
    const data = roundTrip();
    const target = sourceState();
    // The library changed since: the saved profiles still hold the old copies.
    target.library[0].damage = '2';
    expect(planImport(data, target).filter((i) => i.kind === 'attacks').map((i) => i.status)).toEqual(['duplicate', 'duplicate']);
    // A changed copy is a conflict; a renamed weapon copy isn't.
    target.profiles[1].rows[0].weapon.damage = '2';
    target.profiles[0].rows[0].weapon.name = 'Bolt rifle (Mk II)';
    expect(planImport(data, target).filter((i) => i.kind === 'attacks').map((i) => i.status)).toEqual(['duplicate', 'conflict']);
  });

  it('matches names case-insensitively and flags invalid rows by weapon', () => {
    const data = roundTrip();
    data.attacks[0].rows[1].weapon.strength = 99;
    data.attacks[1].rows[0].models = 0;
    const target = emptyState();
    target.defenderPresets.push({ id: 'x', name: 'meq', defender: meq() });
    const plan = planImport(data, target);
    expect(plan.filter((i) => i.kind === 'attacks')).toMatchObject([
      { status: 'invalid', problem: 'Lascannon: Strength must be between 1 and 30' },
      { status: 'invalid', problem: 'Bolt rifle: Models must be between 1 and 50' },
    ]);
    expect(plan.find((i) => i.kind === 'defenders')).toMatchObject({ status: 'duplicate' });
  });
});

describe('applyImport', () => {
  it('adds everything to an empty state, keeping free weapon ids and copying the profile rows', () => {
    const data = roundTrip();
    const target = emptyState();
    const summary = applyImport(data, planImport(data, target), target, 'rename');
    expect(summary).toEqual({ added: 5, renamed: 0, replaced: 0 });
    expect(target.library.map((w) => w.id)).toEqual(['w-bolt', 'w-las']);
    expect(target.profiles.map((p) => p.name)).toEqual(['Gunline', 'Intercessors']);
    expect(target.profiles[0].id).not.toBe('p1');
    expect(target.profiles[0].rows).toEqual([
      { id: expect.any(String), models: 10, weapon: stats(boltRifle()) },
      { id: expect.any(String), models: 1, weapon: stats(abilityLas()) },
    ]);
    // Copies: no objects shared with the parsed data or the library.
    expect(target.profiles[0].rows[0].weapon).not.toBe(data.attacks[0].rows[0].weapon);
    target.library[0].damage = '3';
    expect(target.profiles[0].rows[0].weapon.damage).toBe('1');
    expect(target.defenderPresets[0]).toMatchObject({ name: 'MEQ', defender: meq() });
  });

  it('does not add the weapons of an imported profile to the library', () => {
    const data = roundTrip();
    const target = emptyState();
    target.library.push({ ...boltRifle(), id: 'mine', damage: '2' });
    const plan = planImport(data, target).filter((i) => i.kind === 'attacks');
    applyImport(data, plan, target, 'rename');
    expect(target.library.map((w) => [w.id, w.damage])).toEqual([['mine', '2']]);
    expect(copies(target.profiles[1].rows)).toEqual([[5, 'Bolt rifle', '1']]);
  });

  it('skips duplicates, and renames conflicts under the rename policy', () => {
    const data = roundTrip();
    const target = sourceState();
    target.defenderPresets[0].defender.save = 4;
    target.library[0] = { ...boltRifle(), damage: '2' };
    target.profiles[0].rows[0].models = 9;
    const plan = planImport(data, target);
    expect(plan.map((i) => [i.kind, i.status])).toEqual([
      ['attacks', 'conflict'],
      ['attacks', 'duplicate'],
      ['defenders', 'conflict'],
      ['weapons', 'conflict'],
      ['weapons', 'duplicate'],
    ]);
    const summary = applyImport(data, plan, target, 'rename');
    expect(summary).toEqual({ added: 0, renamed: 3, replaced: 0 });
    expect(target.defenderPresets.map((p) => [p.name, p.defender.save])).toEqual([
      ['MEQ', 4],
      ['MEQ (2)', 3],
    ]);
    expect(target.library.map((w) => [w.name, w.damage])).toEqual([
      ['Bolt rifle', '2'],
      ['Lascannon', 'D6+1'],
      ['Bolt rifle (2)', '1'],
    ]);
    // The original id is taken, so the renamed copy gets a fresh one.
    expect(target.library[2].id).not.toBe('w-bolt');
    expect(target.profiles.map((p) => p.name)).toEqual(['Gunline', 'Intercessors', 'Gunline (2)']);
    expect(copies(target.profiles[0].rows)).toEqual([
      [9, 'Bolt rifle', '1'],
      [1, 'Lascannon', 'D6+1'],
    ]);
    expect(copies(target.profiles[2].rows)).toEqual([
      [10, 'Bolt rifle', '1'],
      [1, 'Lascannon', 'D6+1'],
    ]);
  });

  it('replaces conflicts in place under the replace policy', () => {
    const data = roundTrip();
    const target = sourceState();
    const squad = target.profiles[1];
    squad.rows[0].models = 3;
    target.library[0] = { ...boltRifle(), name: 'BOLT RIFLE', damage: '2' };
    const libraryEntry = target.library[0];
    const summary = applyImport(data, planImport(data, target), target, 'replace');
    expect(summary).toEqual({ added: 0, renamed: 0, replaced: 2 });
    expect(target.profiles).toHaveLength(2);
    expect(target.profiles[1]).toBe(squad);
    expect(target.profiles[1].id).toBe('p2');
    expect(copies(squad.rows)).toEqual([[5, 'Bolt rifle', '1']]);
    // A replaced weapon keeps its library entry and id.
    expect(target.library[0]).toBe(libraryEntry);
    expect(target.library).toEqual([boltRifle(), abilityLas()]);
  });

  it('only applies the chosen items and renames clashes within one import', () => {
    const data = roundTrip();
    data.defenders.push({ name: 'meq', defender: { ...meq(), toughness: 5 } });
    const target = emptyState();
    const plan = planImport(data, target).filter((i) => i.kind === 'defenders');
    expect(applyImport(data, plan, target, 'replace')).toEqual({ added: 1, renamed: 1, replaced: 0 });
    expect(target.defenderPresets.map((p) => p.name)).toEqual(['MEQ', 'meq (2)']);
    expect(target.library).toEqual([]);
    expect(target.profiles).toEqual([]);
  });
});

describe('uniqueName', () => {
  it('numbers clashing names and stays within 40 characters', () => {
    expect(uniqueName(['A'], 'B')).toBe('B');
    expect(uniqueName(['A', 'a (2)'], 'A')).toBe('A (3)');
    const long = 'x'.repeat(40);
    expect(uniqueName([long], long)).toBe(`${'x'.repeat(36)} (2)`);
  });
});
