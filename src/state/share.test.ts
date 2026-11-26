import { describe, expect, it } from 'vitest';
import { noAbilities, type StoredWeapon, type Unit, type UnitAbility } from '../types';
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
  abilities: [],
  ...overrides,
});

function sourceState(): ShareState {
  return {
    armies: [
      { id: 'sm', name: 'Space Marines', abilities: [] },
      { id: 'cd', name: 'Chaos Daemons', abilities: [] },
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
    target.armies.push({ id: 'mine', name: 'space marines', abilities: [] });
    const data = roundTrip();
    const summary = applyImport(data, planImport(data, target), target, 'rename');
    expect(summary).toEqual({ added: 3, renamed: 0, replaced: 0, armies: 1, armyRules: 0 });
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
    expect(summary).toEqual({ added: 0, renamed: 1, replaced: 0, armies: 0, armyRules: 0 });
    expect(target.units.map((u) => u.name)).toEqual(['Intercessors', 'Bloodletters', 'Test dummy', 'Intercessors (2)']);
    expect(target.units[3]).toMatchObject({ armyId: 'sm', toughness: 5 });
  });

  it('replaces a clash in place, keeping the unit id and the ids of weapons that keep their name', () => {
    const target = sourceState();
    const data = roundTrip(sourceState(), ['u1']);
    data.units[0] = { ...data.units[0], name: 'INTERCESSORS', toughness: 5, weapons: [data.units[0].weapons[0], { ...data.units[0].weapons[1], name: 'Plasma pistol' }] };
    const summary = applyImport(data, planImport(data, target), target, 'replace');
    expect(summary).toEqual({ added: 0, renamed: 0, replaced: 1, armies: 0, armyRules: 0 });
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
    expect(applyImport(data, items, target, 'rename')).toEqual({ added: 1, renamed: 0, replaced: 0, armies: 0, armyRules: 0 });
    expect(target.units.map((u) => u.name)).toEqual(['Test dummy']);
    expect(target.armies).toEqual([]);
  });
});

describe('banner links', () => {
  const link = 'https://example.com/intercessors.png';
  const png = 'data:image/png;base64,iVBORw0KGgo=';
  const withBanners = (banners: Record<string, string>): ShareState => ({ ...sourceState(), banners });

  it('exports links but not pictures from the PC', () => {
    const exported = buildShareFile(withBanners({ u1: link, u2: png }), ['u1', 'u2', 'u3']);
    expect(exported.units.map((u) => u.banner)).toEqual([link, undefined, undefined]);
    expect(serializeShareFile(exported)).not.toContain('data:image');
  });

  it('reads valid links only', () => {
    const units = [
      { ...buildShareFile(sourceState(), ['u1']).units[0], banner: link },
      { ...buildShareFile(sourceState(), ['u2']).units[0], banner: 'javascript:alert(1)' },
    ];
    const parsed = parseShareText(file(units));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.data.units.map((u) => u.banner)).toEqual([link, undefined]);
  });

  it('adds the link of a new unit to the banners', () => {
    const data = roundTrip(withBanners({ u1: link }), ['u1']);
    const target: ShareState = { ...emptyState(), banners: {} };
    applyImport(data, planImport(data, target), target, 'rename');
    expect(target.banners).toEqual({ [target.units[0].id]: link });
  });

  it('treats a different banner link as a conflict, and replacing takes it over', () => {
    const data = roundTrip(withBanners({ u1: link }), ['u1']);
    const same = withBanners({ u1: link });
    expect(planImport(data, same)[0].status).toBe('duplicate');

    const target = withBanners({ u1: png });
    const items = planImport(data, target);
    expect(items[0].status).toBe('conflict');
    applyImport(data, items, target, 'replace');
    expect(target.banners).toEqual({ u1: link });
  });

  it('keeps the banner of a replaced unit when the file has no link', () => {
    const data = roundTrip(sourceState(), ['u1']);
    data.units[0].wounds = 3;
    const target = withBanners({ u1: png });
    const items = planImport(data, target);
    expect(items[0].status).toBe('conflict');
    applyImport(data, items, target, 'replace');
    expect(target.banners).toEqual({ u1: png });
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

describe('abilities and army rules', () => {
  const oath = (): UnitAbility => ({ id: 'a-oath', name: 'Oath', description: '', appliesTo: 'unit', when: { toggle: true, conditions: [], weaponType: 'any', targetKeyword: null }, effects: [{ kind: 'reroll', roll: 'hit', which: 'failed' }] });
  const shock = (): UnitAbility => ({ id: 'a-shock', name: 'Shock Assault', description: 'Charge!', appliesTo: 'unit', when: { toggle: false, conditions: ['charged'], weaponType: 'melee', targetKeyword: null }, effects: [{ kind: 'stat', stat: 'attacks', amount: 1 }] });
  const content = ({ id: _, ...rest }: UnitAbility) => rest;

  const withAbilities = (): ShareState => {
    const state = sourceState();
    state.armies[0].abilities = [oath()];
    state.units[0].abilities = [shock()];
    return state;
  };

  it('exports unit abilities and the rules of the exported units’ armies, without ids', () => {
    const exported = buildShareFile(withAbilities(), ['u1', 'u2']);
    expect(exported.armies).toEqual([{ name: 'Space Marines', abilities: [content(oath())] }]);
    expect(exported.units[0].abilities).toEqual([content(shock())]);
    expect(JSON.stringify(exported)).not.toContain('"id"');
    // Bloodletters' army has no rules, and Space Marines are left out when none of its units is exported.
    expect(buildShareFile(withAbilities(), ['u2']).armies).toEqual([]);
  });

  it('round trips abilities and army rules', () => {
    const data = roundTrip(withAbilities());
    expect(data.units[0].abilities).toEqual([content(shock())]);
    expect(data.armies).toEqual([{ name: 'Space Marines', abilities: [content(oath())] }]);
  });

  it('reads files without abilities or armies (older exports of version 3)', () => {
    const parsed = parseShareText(file([{ name: 'Old', army: null, toughness: 4, save: 3, invuln: null, wounds: 1, keywords: [], weapons: [] }]));
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.data.units[0].abilities).toEqual([]);
    expect(parsed.data.armies).toEqual([]);
  });

  it('treats a changed ability as different content', () => {
    const target = withAbilities();
    target.units[0].abilities[0].effects = [{ kind: 'stat', stat: 'attacks', amount: 2 }];
    expect(planImport(roundTrip(withAbilities(), ['u1']), target)[0].status).toBe('conflict');
    expect(planImport(roundTrip(withAbilities(), ['u1']), withAbilities())[0].status).toBe('duplicate');
  });

  it('imports unit abilities with new ids and merges army rules by name', () => {
    const data = roundTrip(withAbilities(), ['u1']);
    data.armies[0].abilities.push({ ...content(oath()), name: 'Bolter Drill', effects: [{ kind: 'critical', roll: 'hit', on: 5 }] });
    const target = emptyState();
    target.armies.push({ id: 'mine', name: 'space marines', abilities: [{ ...oath(), id: 'keep-me', effects: [{ kind: 'reroll', roll: 'hit', which: 'ones' }] }] });
    const summary = applyImport(data, planImport(data, target), target, 'rename');
    expect(summary).toMatchObject({ added: 1, armies: 0, armyRules: 2 });
    expect(target.units[0].abilities[0].id).toMatch(/^ability-/);
    expect(target.armies[0].abilities.map((a) => [a.id, a.name, a.effects[0]])).toEqual([
      ['keep-me', 'Oath', { kind: 'reroll', roll: 'hit', which: 'failed' }],
      [expect.stringMatching(/^ability-/), 'Bolter Drill', { kind: 'critical', roll: 'hit', on: 5 }],
    ]);
    // Importing again adds the unit under a new name but changes no rules.
    expect(applyImport(data, planImport(data, target), target, 'rename').armyRules).toBe(0);
  });

  it('flags a unit with an invalid ability as invalid', () => {
    const data = roundTrip(withAbilities(), ['u1']);
    data.units[0].abilities[0].effects = [];
    expect(planImport(data, emptyState())[0]).toMatchObject({ status: 'invalid', problem: expect.stringContaining('Shock Assault') });
  });
});
