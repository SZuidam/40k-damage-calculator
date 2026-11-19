import type { WeaponAbilities } from '../types';

export type AbilityKey = keyof WeaponAbilities;

/** An ability a weapon has, as shown in the UI. */
export interface ActiveAbility {
  key: AbilityKey;
  label: string;
  description: string;
}

/** An entry in the "Add ability…" dropdown. */
export interface AbilityChoice {
  value: string;
  label: string;
  description: string;
  /** Whether the weapon already has exactly this ability. */
  isActive: (a: WeaponAbilities) => boolean;
  /** The abilities with this one added (a different value of the same ability is replaced). */
  apply: (a: WeaponAbilities) => WeaponAbilities;
}

/** Sustained Hits values offered in the dropdown. D3/D6 and higher numbers come later. */
export const SUSTAINED_HITS_VALUES = ['1', '2'] as const;

/** Blast X / Cleave X values offered in the dropdown (validation allows up to 10). */
export const BONUS_ATTACK_VALUES = [1, 2] as const;

const attacksPerFive = (x: number) => `Adds ${x} attack${x === 1 ? '' : 's'} per model for every 5 models in the target unit`;

const DESCRIPTIONS = {
  lethalHits: 'An unmodified hit roll of 6 wounds automatically.',
  sustainedHits: (x: string) => `An unmodified hit roll of 6 scores ${x} extra hit${x === '1' ? '' : 's'}.`,
  devastatingWounds: 'An unmodified wound roll of 6 cannot be saved.',
  blast: (x: number) => `${attacksPerFive(x)}.`,
  cleave: (x: number) => `${attacksPerFive(x)} (melee only; works the same as Blast here).`,
};

const bonusChoices = (key: 'blast' | 'cleave', label: string): AbilityChoice[] =>
  BONUS_ATTACK_VALUES.map((x) => ({
    value: `${key}-${x}`,
    label: `${label} ${x}`,
    description: DESCRIPTIONS[key](x),
    isActive: (a) => a[key] === x,
    apply: (a) => ({ ...a, [key]: x }),
  }));

export const ABILITY_CHOICES: AbilityChoice[] = [
  {
    value: 'lethal-hits',
    label: 'Lethal Hits',
    description: DESCRIPTIONS.lethalHits,
    isActive: (a) => a.lethalHits,
    apply: (a) => ({ ...a, lethalHits: true }),
  },
  ...SUSTAINED_HITS_VALUES.map(
    (x): AbilityChoice => ({
      value: `sustained-hits-${x}`,
      label: `Sustained Hits ${x}`,
      description: DESCRIPTIONS.sustainedHits(x),
      isActive: (a) => normaliseDice(a.sustainedHits) === x,
      apply: (a) => ({ ...a, sustainedHits: x }),
    }),
  ),
  {
    value: 'devastating-wounds',
    label: 'Devastating Wounds',
    description: DESCRIPTIONS.devastatingWounds,
    isActive: (a) => a.devastatingWounds,
    apply: (a) => ({ ...a, devastatingWounds: true }),
  },
  ...bonusChoices('blast', 'Blast'),
  ...bonusChoices('cleave', 'Cleave'),
];

/** The abilities a weapon has, in a fixed order. */
export function activeAbilities(a: WeaponAbilities): ActiveAbility[] {
  const out: ActiveAbility[] = [];
  if (a.lethalHits) out.push({ key: 'lethalHits', label: 'Lethal Hits', description: DESCRIPTIONS.lethalHits });
  if (a.sustainedHits !== null) {
    const x = normaliseDice(a.sustainedHits);
    out.push({ key: 'sustainedHits', label: `Sustained Hits ${x}`, description: DESCRIPTIONS.sustainedHits(x) });
  }
  if (a.devastatingWounds) out.push({ key: 'devastatingWounds', label: 'Devastating Wounds', description: DESCRIPTIONS.devastatingWounds });
  if (a.blast !== null) out.push({ key: 'blast', label: `Blast ${a.blast}`, description: DESCRIPTIONS.blast(a.blast) });
  if (a.cleave !== null) out.push({ key: 'cleave', label: `Cleave ${a.cleave}`, description: DESCRIPTIONS.cleave(a.cleave) });
  return out;
}

export function withoutAbility(a: WeaponAbilities, key: AbilityKey): WeaponAbilities {
  return { ...a, [key]: typeof a[key] === 'boolean' ? false : null };
}

/** "Lethal Hits, Sustained Hits 1", or '' for none. */
export function abilitiesSummary(a: WeaponAbilities): string {
  return activeAbilities(a)
    .map((x) => x.label)
    .join(', ');
}

export function sameAbilities(a: WeaponAbilities, b: WeaponAbilities): boolean {
  return (
    a.lethalHits === b.lethalHits &&
    a.devastatingWounds === b.devastatingWounds &&
    a.blast === b.blast &&
    a.cleave === b.cleave &&
    (a.sustainedHits === null ? null : normaliseDice(a.sustainedHits)) === (b.sustainedHits === null ? null : normaliseDice(b.sustainedHits))
  );
}

/** Dice are compared and shown case- and space-insensitively: " d3 " → "D3". */
function normaliseDice(expr: string | null): string {
  return (expr ?? '').replace(/\s+/g, '').toUpperCase();
}
