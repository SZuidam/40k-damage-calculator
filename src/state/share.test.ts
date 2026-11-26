import { describe, expect, it } from 'vitest';
import { noAbilities, type StoredWeapon, type Unit } from '../types';
import { SHARE_FORMAT, SHARE_VERSION, applyImport, buildShareFile, parseShareText, planImport, sameUnitContent, serializeShareFile, uniqueName, type ShareData, type ShareState } from './share';

const bolt = (): StoredWeapon => ({ id: 'w-bolt', name: 'Bolt rifle', type: 'ranged', attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1', abilities: noAbilities() });
const pistol = (): StoredWeapon => ({ id: 'w-pistol', name: 'Bolt pistol', type: 'ranged', attacks: '1', skill: 3, strength: 4, ap: 0, damage: '1', abilities: noAbilities() });
const blade = (): StoredWeapon => ({ id: 'w-blade', name: 'Hellblade', type: 'ranged', attacks: '2', skill: 3, strength: 5, ap: -2, damage: '2', abilities: { ...noAbilities(), lethalHits: true, anti: { infantry: 4 } } });

const unit = (overrides: Partial<Unit> = {}): Unit => ({
  id: 'u1',
  name: 'Intercessors',
  armyId: 'sm',
  toughness: 4,
  save: 3,
  invuln: null,
  wounds: 2,
  keywords: ['infantry'],
  weapons: [bolt(), pistol()],
  ...overrides,
});

function sourceState(): ShareState {
  return {
    armies: [
      { id: 'sm', name: 'Space Marines' },
      { id: 'cd', name: 'Chaos Daemons' },
    ],
    units: [
      unit(),
      unit({ id: 'u2', name: 'Bloodletters', armyId: 'cd', save: 7, invuln: 5, wounds: 1, weapons: [blade()] }),
      unit({ id: 'u3', name: 'Test dummy', armyId: null, toughness: 10, keywords: ['vehicle'], weapons: [] }),
    ],
  };
}

const emptyState = (): ShareState => ({ armies: [], units: [] });

function roundTrip(source = sourceState(), ids = source.units.map((u) => u.id)): ShareData {
  const parsed = parseShareText(serializeShareFile(buildShareFile(source, ids)));
  if (!parsed.ok) throw new Error(parsed.error);
  return parsed.data;
}

const file = (units: unknown[], version: number = SHARE_VERSION) => JSON.stringify({ format: SHARE_FORMAT, version, exportedAt: '2026-11-26T00:00:00.000Z', units });

describe('buildShareFile', () => {
  it('exports only the selected units with their army name, without ids', () => {
    const exported = buildShareFile(sourceState(), ['u2', 'u3'], new Date('2026-11-26T12:00:00Z'));
    expect(exported.format).toBe(SHARE_FORMAT);
    expect(exported.version).toBe(3);
    expect(exported.exportedAt).toBe('2026-11-26T12:00:00.000Z');
    expect(exported.units.map((u) => [u.name, u.army])).toEqual([
      ['Bloodletters', 'Chaos Daemons'],
      ['Test dummy', null],
    ]);
    expect(JSON.stringify(exported)).not.toContain('"id"');
    expect(exported.units[0].weapons[0]).toEqual({ name: 'Hellblade', type: 'ranged', attacks: '2', skill: 3, strength: 5, ap: -2, damage: '2', abilities: blade().abilities });
  });

  it('exports a unit whose army is gone as "No army"', () => {
    const source = sourceState();
    source.units[0].armyId = 'gone';
    expect(buildShareFile(source, ['u1']).units[0].army).toBeNull();
  });
});

describe('parseShareText', () => {
  it('round trips units, stats, keywords and weapon abilities', () => {
    const data = roundTrip();
    expect(data.units).toHaveLength(3);
    expect(data.units[1]).toMatchObject({ name: 'Bloodletters', army: 'Chaos Daemons', save: 7, invuln: 5, wounds: 1, keywords: ['infantry'] });
    expect(data.units[1].weapons[0].abilities).toEqual(blade().abilities);
  });

  it('gives clear errors', () => {
    const error = (text: string) => {
      const result = parseShareText(text);
      return result.ok ? null : result.error;
    };
    expect(error('  ')).toBe('Paste an export or choose a file first.');
    expect(error('{nope')).toMatch(/not valid JSON/);
    expect(error('{"format":"other"}')).toBe('This is not an export of the Damage Calculator.');
    expect(error(file([], 99))).toBe('This export was made by a newer version of the app.');
    expect(error(file([], 2))).toMatch(/older version of the app/);
    expect(error(file([]))).toBe('This export contains nothing to import.');
    expect(error('x'.repeat(1_000_001))).toMatch(/too large/);
  });

  it('drops malformed units and weapons, trims names and repairs values like stored state', () => {
    const result = parseShareText(
      file([
        { name: '  Squad  ', army: '  Space Marines ', toughness: 4, save: 3, wounds: 2, keywords: ['infantry', 'tank'], weapons: [{ name: ' Gun ', attacks: '1', damage: '1' }, { name: 'Broken' }] },
        { name: '   ' },
        { army: 'x' },
        42,
        { name: 'No army', army: '', toughness: 5 },
      ]),
    );
    if (!result.ok) throw new Error(result.error);
    expect(result.data.units).toHaveLength(2);
    const [squad, loose] = result.data.units;
    expect(squad).toMatchObject({ name: 'Squad', army: 'Space Marines', keywords: ['infantry'] });
    expect(squad.weapons.map((w) => w.name)).toEqual(['Gun']);
    expect(squad.weapons[0].abilities).toEqual(noAbilities());
    expect(loose.army).toBeNull();
  });
});

describe('planImport', () => {
  it('marks units as new, already saved, name in use (per army) or invalid', () => {
    const target = sourceState();
    const data = roundTrip();
    data.units.push(
      { ...data.units[0], name: 'intercessors', toughness: 5 },
      { ...data.units[0], army: 'Chaos Daemons' },
      { ...data.units[0], name: 'Hellblasters', army: 'Dark Angels' },
      { ...data.units[0], name: 'Broken', wounds: 99 },
    );
    expect(planImport(data, target).map((i) => [i.name, i.army, i.status, i.newArmy])).toEqual([
      ['Intercessors', 'Space Marines', 'duplicate', false],
      ['Bloodletters', 'Chaos Daemons', 'duplicate', false],
      ['Test dummy', null, 'duplicate', false],
      ['intercessors', 'Space Marines', 'conflict', false],
      // The same name in another army is no clash.
      ['Intercessors', 'Chaos Daemons', 'new', false],
      ['Hellblasters', 'Dark Angels', 'new', true],
      ['Broken', 'Space Marines', 'invalid', false],
    ]);
    expect(planImport(data, target)[6].problem).toBe('Wounds must be between 1 and 40');
  });

  it('matches the army name case-insensitively', () => {
    const data = roundTrip();
    data.units[0].army = 'space marines';
    expect(planImport(data, sourceState())[0]).toMatchObject({ status: 'duplicate', newArmy: false });
  });

  it('treats a weapon rename or stat change as different content', () => {
    const a = unit();
    expect(sameUnitContent(a, unit({ id: 'x', name: 'Other', armyId: null }))).toBe(true);
    expect(sameUnitContent(a, unit({ weapons: [{ ...bolt(), name: 'Bolter' }, pistol()] }))).toBe(false);
    expect(sameUnitContent(a, unit({ weapons: [{ ...bolt(), ap: -2 }, pistol()] }))).toBe(false);
    expect(sameUnitContent(a, unit({ weapons: [pistol(), bolt()] }))).toBe(false);
    expect(sameUnitContent(a, unit({ keywords: [] }))).toBe(false);
  });
});

describe('applyImport', () => {
  it('adds units with new ids, creating missing armies by name', () => {
    const target = emptyState();
    target.armies.push({ id: 'mine', name: 'space marines' });
    const data = roundTrip();
    const summary = applyImport(data, planImport(data, target), target, 'rename');
    expect(summary).toEqual({ added: 3, renamed: 0, replaced: 0, armies: 1 });
    expect(target.armies.map((a) => a.name)).toEqual(['space marines', 'Chaos Daemons']);
    const [sm, cd, dummy] = target.units;
    expect(sm.armyId).toBe('mine');
    expect(cd.armyId).toBe(target.armies[1].id);
    expect(dummy.armyId).toBeNull();
    expect(target.units.map((u) => u.id)).not.toContain('u1');
    expect(sm.weapons.map((w) => w.id).every((id) => id.startsWith('weapon-'))).toBe(true);
    expect(sm.weapons.map((w) => w.name)).toEqual(['Bolt rifle', 'Bolt pistol']);
  });

  it('skips duplicates and invalid units, and renames a clash within the army under "keep both"', () => {
    const target = sourceState();
    const data = roundTrip();
    data.units.push({ ...data.units[0], toughness: 5 }, { ...data.units[0], name: 'Broken', wounds: 0 });
    const summary = applyImport(data, planImport(data, target), target, 'rename');
    expect(summary).toEqual({ added: 0, renamed: 1, replaced: 0, armies: 0 });
    expect(target.units.map((u) => u.name)).toEqual(['Intercessors', 'Bloodletters', 'Test dummy', 'Intercessors (2)']);
    expect(target.units[3]).toMatchObject({ armyId: 'sm', toughness: 5 });
  });

  it('replaces a clash in place, keeping the unit id and the ids of weapons that keep their name', () => {
    const target = sourceState();
    const data = roundTrip(sourceState(), ['u1']);
    data.units[0] = { ...data.units[0], name: 'INTERCESSORS', toughness: 5, weapons: [data.units[0].weapons[0], { ...data.units[0].weapons[1], name: 'Plasma pistol' }] };
    const summary = applyImport(data, planImport(data, target), target, 'replace');
    expect(summary).toEqual({ added: 0, renamed: 0, replaced: 1, armies: 0 });
    const replaced = target.units[0];
    // The saved name and army stay; the stats and weapons come from the file.
    expect(replaced).toMatchObject({ id: 'u1', name: 'Intercessors', armyId: 'sm', toughness: 5 });
    expect(replaced).not.toHaveProperty('army');
    expect(replaced.weapons.map((w) => [w.id, w.name])).toEqual([
      ['w-bolt', 'Bolt rifle'],
      [expect.stringMatching(/^weapon-/), 'Plasma pistol'],
    ]);
    expect(target.units).toHaveLength(3);
  });

  it('only imports the chosen items', () => {
    const target = emptyState();
    const data = roundTrip();
    const items = planImport(data, target).filter((i) => i.name === 'Test dummy');
    expect(applyImport(data, items, target, 'rename')).toEqual({ added: 1, renamed: 0, replaced: 0, armies: 0 });
    expect(target.units.map((u) => u.name)).toEqual(['Test dummy']);
    expect(target.armies).toEqual([]);
  });
});

describe('uniqueName', () => {
  it('numbers taken names case-insensitively and stays within 40 characters', () => {
    expect(uniqueName([], 'Squad')).toBe('Squad');
    expect(uniqueName(['squad'], 'Squad')).toBe('Squad (2)');
    expect(uniqueName(['Squad', 'Squad (2)'], 'Squad')).toBe('Squad (3)');
    expect(uniqueName(['y'.repeat(40)], 'y'.repeat(50))).toBe(`${'y'.repeat(36)} (2)`);
  });
});
