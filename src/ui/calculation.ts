import type { Breakdown, DiceTerm, RollBreakdown, WeaponBreakdown } from '../engine/breakdown';
import { KEYWORD_NAMES, type DefenderProfile } from '../types';
import { h } from './dom';

/** One line of the worked-out calculation: `Hits   20 × 4/6   = 13.33`, plus notes on where the numbers come from. */
export interface CalcLine {
  step: string;
  formula: string;
  value: string;
  notes: string[];
}

export interface WeaponCalc {
  title: string;
  statLine: string;
  lines: CalcLine[];
}

const fixed = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** An operand in a formula: whole numbers without decimals, others with at most 2. */
export function num(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return rounded.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/** A chance on a d6 as k/6 when it is one (0 and 1 as is), else as a decimal. */
export function chance(p: number): string {
  const sixths = p * 6;
  const k = Math.round(sixths);
  if (Math.abs(sixths - k) < 1e-9) return k === 0 ? '0' : k === 6 ? '1' : `${k}/6`;
  return p.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

/** P(pass) as a formula: `4/6`, or `(4/6 + 2/6 × 4/6)` with a re-roll. */
function rollFormula(first: number, rerolled: number): string {
  if (rerolled === 0 || first === 0) return chance(first);
  return `(${chance(first)} + ${chance(rerolled)} × ${chance(first)})`;
}

const signed = (n: number) => (n > 0 ? `+${n}` : String(n));

function rerollNote(roll: RollBreakdown, what: string): string | null {
  if (roll.reroll === 'none' || roll.rerolled === 0) return null;
  const which = roll.reroll === 'ones' ? `${what} rolls of 1` : `failed ${what} rolls`;
  return `Re-roll ${which} (${chance(roll.rerolled)} of the dice): a re-rolled die passes ${chance(roll.first)} again, so P = ${rollFormula(roll.first, roll.rerolled)} = ${chance(roll.chance)}.`;
}

function passText(roll: RollBreakdown): string {
  return roll.passOn === null ? 'never passes' : `passes on ${roll.passOn}+`;
}

function termsFormula(terms: DiceTerm[]): string {
  const means = terms.map((t) => num(t.mean));
  return means.length === 1 ? means[0] : `(${means.join(' + ')})`;
}

/** "D6 averages 3.5" notes for the dice terms; nothing when every term is a plain number. */
function termsNote(terms: DiceTerm[], per: string): string | null {
  if (terms.length === 1 && terms[0].expr === num(terms[0].mean)) return null;
  const parts = terms.map((t) => (t.expr === num(t.mean) ? `${t.label} ${t.expr}` : `${t.label} ${t.expr} averages ${num(t.mean)}`));
  return `${per}: ${parts.join(' + ')}.`;
}

/** How a damage re-roll changes the average of D. */
function damageRerollNote(b: WeaponBreakdown): string | null {
  const r = b.damageReroll;
  if (r === null) return null;
  const head = `Re-roll damage below ${r.below} (Settings): `;
  if (r.rerolled === 0) return `${head}the dice of D ${b.weapon.damage} never show less than ${r.below}, so nothing is re-rolled.`;
  return `${head}a D ${b.weapon.damage} roll whose dice show less than ${r.below} (${chance(r.rerolled)} of the rolls) is rolled again and the re-roll stands, which raises its average from ${num(r.plainMean)} to ${num(r.mean)}.`;
}

/** BS / WS as shown: "BS 3+", or "BS N/A" for a Torrent weapon (it makes no hit roll). */
function skillText(b: WeaponBreakdown): string {
  const skill = b.weapon.type === 'melee' ? 'WS' : 'BS';
  return b.torrent ? `${skill} N/A` : `${skill} ${b.weapon.skill}+`;
}

/** The note on the hit roll: what it passes on, or that Torrent skips it. */
function hitNote(b: WeaponBreakdown): string {
  if (b.torrent) {
    const lost = [b.weapon.abilities.lethalHits ? 'Lethal Hits' : '', b.weapon.abilities.sustainedHits !== null ? 'Sustained Hits' : ''].filter(Boolean);
    const without = lost.length === 0 ? '' : `, so there are no critical hits and ${lost.join(' and ')} can't trigger`;
    return `Torrent: every attack hits automatically. No hit roll is made${without}.`;
  }
  const why = [skillText(b)];
  if (b.hitModifier !== 0) why.push(`${signed(b.hitModifier)} to hit`);
  return `The hit roll ${passText(b.hit)} (${why.join(', ')}); an unmodified 1 always fails.`;
}

function weaponTitle(b: WeaponBreakdown, index: number): string {
  const name = b.weapon.name || `Weapon ${index + 1}`;
  return `${index + 1}. ${b.weapon.models}× ${name}`;
}

function weaponStatLine(b: WeaponBreakdown): string {
  const w = b.weapon;
  return `A ${w.attacks} · ${skillText(b)} · S ${w.strength} · AP ${w.ap} · D ${w.damage}`;
}

export function defenderLine(defender: DefenderProfile): string {
  const parts = [`${defender.models} model${defender.models === 1 ? '' : 's'}`, `T ${defender.toughness}`, defender.save > 6 ? 'no armour save' : `Sv ${defender.save}+`];
  if (defender.invuln !== null) parts.push(`${defender.invuln}++ invulnerable`);
  parts.push(`${defender.wounds} W each`);
  if (defender.keywords.length > 0) parts.push(defender.keywords.map((k) => KEYWORD_NAMES[k]).join(', '));
  return parts.join(' · ');
}

export function weaponCalc(b: WeaponBreakdown, index: number, defender: DefenderProfile): WeaponCalc {
  const w = b.weapon;
  const lines: CalcLine[] = [];
  const notes = (...items: (string | null)[]) => items.filter((n): n is string => n !== null);

  // Attacks
  lines.push({
    step: 'Attacks',
    formula: `${w.models} model${w.models === 1 ? '' : 's'} × ${termsFormula(b.attackTerms)}`,
    value: fixed(b.attacks),
    notes: notes(termsNote(b.attackTerms, 'Attacks per model')),
  });

  // Hits
  const hitFormula = `${num(b.attacks)} × ${rollFormula(b.hit.first, b.hit.rerolled)}`;
  const critHitFormula = rollFormula(b.hit.criticalFirst, b.hit.rerolled);
  lines.push({
    step: 'Hits',
    formula: b.sustained === null || b.torrent ? hitFormula : `${hitFormula} + ${num(b.attacks)} × ${critHitFormula} × ${num(b.sustained.mean)}`,
    value: fixed(b.hits),
    notes: notes(
      hitNote(b),
      rerollNote(b.hit, 'hit'),
      b.sustained === null || b.torrent
        ? null
        : `${b.sustained.label}: critical hits (unmodified ${b.hit.criticalOn}+) are ${num(b.attacks)} × ${critHitFormula} = ${num(b.criticalHits)}, each scoring ${b.sustained.expr}${b.sustained.expr === num(b.sustained.mean) ? '' : ` (avg ${num(b.sustained.mean)})`} extra hits = ${num(b.extraHits)}.`,
    ),
  });

  // Wounds
  const woundWhy = [`S ${w.strength} vs T ${defender.toughness} needs ${b.strengthVsToughness}+`];
  if (b.woundModifier !== 0) woundWhy.push(`${signed(b.woundModifier)} to wound`);
  if (b.wound.criticalOn < 6) woundWhy.push(`a critical wound on an unmodified ${b.wound.criticalOn}+ always wounds`);
  const woundFormula = rollFormula(b.wound.first, b.wound.rerolled);
  lines.push({
    step: 'Wounds',
    formula: b.lethal > 0 ? `(${num(b.hits)} − ${num(b.lethal)}) × ${woundFormula} + ${num(b.lethal)}` : `${num(b.hits)} × ${woundFormula}`,
    value: fixed(b.wounds),
    notes: notes(
      b.lethal > 0 ? `Lethal Hits: the ${num(b.lethal)} critical hits (unmodified ${b.hit.criticalOn}+) wound automatically; the other ${num(b.woundRolls)} hits roll to wound.` : null,
      `The wound roll ${passText(b.wound)} (${woundWhy.join('; ')}); an unmodified 1 always fails.`,
      rerollNote(b.wound, 'wound'),
    ),
  });

  // Unsaved
  const armour = defender.save > 6 ? 'no armour save' : `Sv ${defender.save}+ with AP ${w.ap} is ${b.armourOn > 6 ? `${b.armourOn}+, which can't pass` : `${b.armourOn}+`}`;
  const saveWhy =
    b.save === null
      ? `No save can pass (${armour}${defender.invuln === null ? '' : `, ${defender.invuln}++ invulnerable can't pass either`}), so every wound goes through.`
      : b.save.invulnerable
        ? `Saved with the ${b.save.on}++ invulnerable save (better than ${armour}); it fails ${chance(b.failSave)}.`
        : `Saved on ${b.save.on}+ (${armour}); it fails ${chance(b.failSave)} (an unmodified 1 always fails).`;
  lines.push({
    step: 'Unsaved',
    formula: b.devastating > 0 ? `(${num(b.wounds)} − ${num(b.devastating)}) × ${chance(b.failSave)} + ${num(b.devastating)}` : `${num(b.wounds)} × ${chance(b.failSave)}`,
    value: fixed(b.unsaved),
    notes: notes(
      b.devastating > 0
        ? `Devastating Wounds: critical wounds (unmodified ${b.wound.criticalOn}+) skip the save: ${num(b.woundRolls)} wound rolls × ${rollFormula(b.wound.criticalFirst, b.wound.rerolled)} = ${num(b.devastating)}.`
        : null,
      saveWhy,
    ),
  });

  // Damage
  lines.push({
    step: 'Damage',
    formula: `${num(b.unsaved)} × ${termsFormula(b.damageTerms)}`,
    value: fixed(b.damage),
    notes: notes(damageRerollNote(b), termsNote(b.damageTerms, 'Damage per unsaved wound')),
  });

  lines.push({
    step: 'Applied',
    formula: `${num(b.damage)} − ${num(Math.max(0, b.damage - b.applied))} lost`,
    value: fixed(b.applied),
    notes: [
      `Damage beyond a model's remaining wounds (${defender.wounds} W each) is lost, as is damage after the whole unit is destroyed. Worked out exactly over every possible roll${index > 0 ? ', starting from what the weapons before left behind (a partly wounded model carries over)' : ''}.`,
    ],
  });
  lines.push({
    step: 'Destroyed',
    formula: 'exact',
    value: fixed(b.destroyed),
    notes: ['Models destroyed on average, over every possible roll. Not simply damage ÷ wounds, because excess damage is lost.'],
  });

  return { title: weaponTitle(b, index), statLine: weaponStatLine(b), lines };
}

/** The whole calculation as plain text, for copying. */
export function calculationText(calc: Breakdown, defender: DefenderProfile): string {
  const out = [`Against ${defenderLine(defender)}`, ''];
  calc.weapons.forEach((b, i) => {
    const wc = weaponCalc(b, i, defender);
    out.push(`${wc.title} (${wc.statLine})`);
    for (const line of wc.lines) {
      out.push(`  ${line.step.padEnd(10)}${line.formula} = ${line.value}`);
      for (const note of line.notes) out.push(`  ${''.padEnd(10)}${note}`);
    }
    out.push('');
  });
  out.push(`Total: ${fixed(calc.appliedTotal)} damage applied, ${fixed(calc.destroyedTotal)} models destroyed (exact).`);
  return out.join('\n');
}

/** The "Show the calculation" content: one block per weapon, then the exact totals. */
export function renderCalculation(calc: Breakdown, defender: DefenderProfile): HTMLElement {
  const blocks = calc.weapons.map((b, i) => {
    const wc = weaponCalc(b, i, defender);
    const rows = wc.lines.flatMap((line) => [
      h('span', { class: 'calc-step' }, line.step),
      h('span', { class: 'calc-formula' }, line.formula),
      h('span', { class: 'calc-value num' }, `= ${line.value}`),
      ...line.notes.map((note) => h('span', { class: 'calc-note' }, note)),
    ]);
    return h(
      'div',
      { class: 'calc-weapon' },
      h('p', { class: 'calc-title' }, h('strong', {}, wc.title), ' ', h('span', { class: 'calc-stats' }, wc.statLine)),
      h('div', { class: 'calc-grid' }, ...rows),
    );
  });

  const copy = h('button', { type: 'button', class: 'button secondary calc-copy' }, 'Copy as text');
  copy.addEventListener('click', () => {
    void navigator.clipboard.writeText(calculationText(calc, defender)).then(
      () => (copy.textContent = 'Copied'),
      () => (copy.textContent = 'Copy failed'),
    );
    window.setTimeout(() => (copy.textContent = 'Copy as text'), 1500);
  });

  return h(
    'div',
    { class: 'calc' },
    h(
      'p',
      { class: 'calc-intro' },
      `Against ${defenderLine(defender)}. These are the exact averages, worked out step by step; the simulated table above differs from them by a little random noise.`,
    ),
    ...blocks,
    h(
      'p',
      { class: 'calc-total' },
      h('strong', {}, 'Total'),
      ` ${fixed(calc.appliedTotal)} damage applied, ${fixed(calc.destroyedTotal)} models destroyed.`,
    ),
    copy,
  );
}
