import { DEFENDER_KEYWORDS, KEYWORD_NAMES, type AttackConditions, type DefenderKeyword, type WeaponAbilities } from '../types';

export type AbilityKey = keyof WeaponAbilities;

/** The abilities that take an X (a dice expression) typed in by the user. */
export type ValueAbilityKey = 'sustainedHits' | 'blast' | 'cleave' | 'rapidFire';

/** An ability a weapon has, as shown in the UI. */
export interface ActiveAbility {
  key: AbilityKey;
  label: string;
  description: string;
  /** Set for abilities with an X, whose chip can be clicked to change X. */
  valueKey?: ValueAbilityKey;
  /** Set for Anti-X Y+: the keywords that share this Y (one chip), in display order. */
  anti?: { keywords: DefenderKeyword[]; value: number };
  /** Set for abilities that only work under an attack condition (Rapid Fire, Lance). */
  condition?: keyof AttackConditions;
}

interface BaseChoice {
  value: string;
  label: string;
  description: string;
  /** Whether the weapon already has this ability (then it leaves the dropdown). */
  isActive: (a: WeaponAbilities) => boolean;
}

/** An ability without a value: picking it adds it straight away. */
export interface FlagAbilityChoice extends BaseChoice {
  /** The abilities with this one added. */
  apply: (a: WeaponAbilities) => WeaponAbilities;
}

/** An ability with an X: picking it asks for X first, then stores it with `withAbilityValue`. */
export interface ValueAbilityChoice extends BaseChoice {
  valueKey: ValueAbilityKey;
  /** The ability's name without X, e.g. "Blast". */
  name: string;
}

/** Anti-X Y+ for one keyword: picking it asks for Y first, then stores it with `withAntiValue`. */
export interface AntiAbilityChoice extends BaseChoice {
  keyword: DefenderKeyword;
}

/** An entry in the "Add ability…" dropdown. */
export type AbilityChoice = FlagAbilityChoice | ValueAbilityChoice | AntiAbilityChoice;

export function isValueChoice(choice: AbilityChoice): choice is ValueAbilityChoice {
  return 'valueKey' in choice;
}

export function isAntiChoice(choice: AbilityChoice): choice is AntiAbilityChoice {
  return 'keyword' in choice;
}

/** Ability names without X, as shown before the value: "Blast D6+2". */
export const VALUE_ABILITY_NAMES: Record<ValueAbilityKey, string> = {
  sustainedHits: 'Sustained Hits',
  blast: 'Blast',
  cleave: 'Cleave',
  rapidFire: 'Rapid Fire',
};

const attacksPerFive = (x: string) => `Adds ${x} attack${x === '1' ? '' : 's'} per model for every 5 models in the target unit`;

const DESCRIPTIONS = {
  lethalHits: 'An unmodified hit roll of 6 wounds automatically.',
  sustainedHits: (x: string) => `An unmodified hit roll of 6 scores ${x} extra hit${x === '1' ? '' : 's'}.`,
  devastatingWounds: 'An unmodified wound roll of 6 cannot be saved.',
  blast: (x: string) => `${attacksPerFive(x)}.`,
  cleave: (x: string) => `${attacksPerFive(x)} (melee only; works the same as Blast here).`,
  anti: (keywords: string, y: string) => `An unmodified wound roll of ${y} against a ${keywords} target is a critical wound (it always wounds).`,
  rapidFire: (x: string) => `Adds ${x} attack${x === '1' ? '' : 's'} per model when the target is within half range.`,
  lance: 'Adds 1 to the wound roll if the bearer charged this turn.',
};

/** The attack condition each conditional ability needs. */
const CONDITIONS: Partial<Record<keyof WeaponAbilities, keyof AttackConditions>> = { rapidFire: 'halfRange', lance: 'charged' };

/** "Vehicle", "Vehicle or Monster", "Vehicle, Monster or Fly". */
function keywordList(keywords: DefenderKeyword[]): string {
  const names = keywords.map((k) => KEYWORD_NAMES[k]);
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} or ${names.at(-1)}`;
}

/** "Anti-Vehicle/Monster": the name of an Anti chip, without Y. */
export function antiName(keywords: DefenderKeyword[]): string {
  return `Anti-${keywords.map((k) => KEYWORD_NAMES[k]).join('/')}`;
}

const antiChoice = (keyword: DefenderKeyword): AntiAbilityChoice => ({
  value: `anti-${keyword}`,
  label: `${antiName([keyword])} Y+…`,
  description: DESCRIPTIONS.anti(KEYWORD_NAMES[keyword], 'Y+'),
  keyword,
  isActive: (a) => a.anti[keyword] !== undefined,
});

const valueChoice = (valueKey: ValueAbilityKey, value: string, description: string): ValueAbilityChoice => ({
  value,
  label: `${VALUE_ABILITY_NAMES[valueKey]} X…`,
  name: VALUE_ABILITY_NAMES[valueKey],
  description,
  valueKey,
  isActive: (a) => a[valueKey] !== null,
});

export const ABILITY_CHOICES: AbilityChoice[] = [
  {
    value: 'lethal-hits',
    label: 'Lethal Hits',
    description: DESCRIPTIONS.lethalHits,
    isActive: (a) => a.lethalHits,
    apply: (a) => ({ ...a, lethalHits: true }),
  },
  valueChoice('sustainedHits', 'sustained-hits', DESCRIPTIONS.sustainedHits('X')),
  {
    value: 'devastating-wounds',
    label: 'Devastating Wounds',
    description: DESCRIPTIONS.devastatingWounds,
    isActive: (a) => a.devastatingWounds,
    apply: (a) => ({ ...a, devastatingWounds: true }),
  },
  ...DEFENDER_KEYWORDS.map(antiChoice),
  valueChoice('blast', 'blast', DESCRIPTIONS.blast('X')),
  valueChoice('cleave', 'cleave', DESCRIPTIONS.cleave('X')),
  valueChoice('rapidFire', 'rapid-fire', DESCRIPTIONS.rapidFire('X')),
  {
    value: 'lance',
    label: 'Lance',
    description: DESCRIPTIONS.lance,
    isActive: (a) => a.lance,
    apply: (a) => ({ ...a, lance: true }),
  },
];

/** The abilities with X of `key` set (or replaced), stored normalised: " d6 + 2 " → "D6+2". */
export function withAbilityValue(a: WeaponAbilities, key: ValueAbilityKey, expr: string): WeaponAbilities {
  return { ...a, [key]: normaliseDice(expr) };
}

/** The abilities a weapon has, in a fixed order. */
export function activeAbilities(a: WeaponAbilities): ActiveAbility[] {
  const out: ActiveAbility[] = [];
  const withValue = (key: ValueAbilityKey, value: string) => {
    const x = normaliseDice(value);
    const condition = CONDITIONS[key];
    out.push({ key, label: `${VALUE_ABILITY_NAMES[key]} ${x}`, description: DESCRIPTIONS[key](x), valueKey: key, ...(condition && { condition }) });
  };
  if (a.lethalHits) out.push({ key: 'lethalHits', label: 'Lethal Hits', description: DESCRIPTIONS.lethalHits });
  if (a.sustainedHits !== null) withValue('sustainedHits', a.sustainedHits);
  if (a.devastatingWounds) out.push({ key: 'devastatingWounds', label: 'Devastating Wounds', description: DESCRIPTIONS.devastatingWounds });
  for (const { keywords, value } of antiGroups(a)) {
    out.push({ key: 'anti', label: `${antiName(keywords)} ${value}+`, description: DESCRIPTIONS.anti(keywordList(keywords), `${value}+`), anti: { keywords, value } });
  }
  if (a.blast !== null) withValue('blast', a.blast);
  if (a.cleave !== null) withValue('cleave', a.cleave);
  if (a.rapidFire !== null) withValue('rapidFire', a.rapidFire);
  if (a.lance) out.push({ key: 'lance', label: 'Lance', description: DESCRIPTIONS.lance, condition: 'charged' });
  return out;
}

/**
 * The Anti abilities grouped by Y: keywords with the same Y share one entry. Keywords keep
 * their display order, and groups are ordered by their first keyword.
 */
function antiGroups(a: WeaponAbilities): { keywords: DefenderKeyword[]; value: number }[] {
  const groups = new Map<number, DefenderKeyword[]>();
  for (const keyword of DEFENDER_KEYWORDS) {
    const y = a.anti[keyword];
    if (y === undefined) continue;
    const group = groups.get(y);
    if (group) group.push(keyword);
    else groups.set(y, [keyword]);
  }
  return [...groups].map(([value, keywords]) => ({ keywords, value }));
}

export function withoutAbility(a: WeaponAbilities, key: AbilityKey): WeaponAbilities {
  if (key === 'anti') return { ...a, anti: {} };
  return { ...a, [key]: typeof a[key] === 'boolean' ? false : null };
}

/** The abilities with Anti-X Y+ set (or replaced) to `y` for every keyword in `keywords`. */
export function withAntiValue(a: WeaponAbilities, keywords: readonly DefenderKeyword[], y: number): WeaponAbilities {
  const anti = { ...a.anti };
  for (const keyword of keywords) anti[keyword] = y;
  return { ...a, anti };
}

/** The abilities without Anti for any of `keywords`. */
export function withoutAnti(a: WeaponAbilities, keywords: readonly DefenderKeyword[]): WeaponAbilities {
  const anti = { ...a.anti };
  for (const keyword of keywords) delete anti[keyword];
  return { ...a, anti };
}

/** Y of Anti-X Y+ as typed: "4", "4+", " 4 + " → 4. Only 2–6; anything else is null. */
export function parseAntiValue(text: string): number | null {
  const match = /^\s*([2-6])\s*\+?\s*$/.exec(text);
  return match ? Number(match[1]) : null;
}

/** "Lethal Hits, Sustained Hits 1", or '' for none. */
export function abilitiesSummary(a: WeaponAbilities): string {
  return activeAbilities(a)
    .map((x) => x.label)
    .join(', ');
}

export function sameAbilities(a: WeaponAbilities, b: WeaponAbilities): boolean {
  const sameValue = (key: ValueAbilityKey) => (a[key] === null ? null : normaliseDice(a[key])) === (b[key] === null ? null : normaliseDice(b[key]));
  return (
    a.lethalHits === b.lethalHits &&
    a.devastatingWounds === b.devastatingWounds &&
    a.lance === b.lance &&
    sameValue('sustainedHits') &&
    sameValue('blast') &&
    sameValue('cleave') &&
    sameValue('rapidFire') &&
    DEFENDER_KEYWORDS.every((k) => a.anti[k] === b.anti[k])
  );
}

/** Dice are compared and shown case- and space-insensitively: " d3 " → "D3". */
export function normaliseDice(expr: string | null): string {
  return (expr ?? '').replace(/\s+/g, '').toUpperCase();
}
