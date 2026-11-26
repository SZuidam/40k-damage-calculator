import { breakdown } from '../engine/breakdown';
import type { DefenderProfile, SimulationResult, StepStats, WeaponProfile } from '../types';
import { renderCalculation } from './calculation';
import { h } from './dom';

const SVG_NS = 'http://www.w3.org/2000/svg';

const STEPS: { key: keyof StepStats; label: string }[] = [
  { key: 'attacks', label: 'Attacks' },
  { key: 'hits', label: 'Hits' },
  { key: 'wounds', label: 'Wounds' },
  { key: 'unsaved', label: 'Unsaved' },
  { key: 'damage', label: 'Damage applied' },
  { key: 'modelsDestroyed', label: 'Models destroyed' },
];

const fmt = (n: number, digits = 2) =>
  n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
const pct = (p: number) => {
  if (p > 0 && p < 0.001) return '<0.1%';
  if (p < 1 && p > 0.999) return '>99.9%';
  return `${(p * 100).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
};

export interface ResultsView {
  /** `weapons` are the profiles that were simulated, used to label rows `10× Bolt rifle`. */
  show(result: SimulationResult, weapons: WeaponProfile[], defender: DefenderProfile): void;
  markStale(stale: boolean): void;
}

export function createResultsView(container: HTMLElement): ResultsView {
  let resizeObserver: ResizeObserver | null = null;

  return {
    show(result, weapons, defender) {
      resizeObserver?.disconnect();
      container.replaceChildren();
      container.classList.remove('is-stale');

      const stale = h('p', { class: 'stale-notice', role: 'status' }, 'Inputs changed since this run. Simulate again to update.');
      container.append(stale, summary(result, defender.models, defender.wounds), stepTable(result, weapons, defender));

      const chartHost = h('div', { class: 'chart-host' });
      container.append(chartSection(result, chartHost));

      let lastWidth = 0;
      const draw = () => {
        const width = Math.floor(chartHost.clientWidth);
        if (width === 0 || width === lastWidth) return;
        lastWidth = width;
        chartHost.replaceChildren(killChart(result.killAtLeast, result.killDistribution, width));
      };
      resizeObserver = new ResizeObserver(draw);
      resizeObserver.observe(chartHost);
      draw();
    },
    markStale(isStale) {
      container.classList.toggle('is-stale', isStale);
    },
  };
}

function summary(result: SimulationResult, models: number, wounds: number): HTMLElement {
  const wipe = result.killAtLeast[models] ?? 0;
  return h(
    'div',
    { class: 'summary' },
    h(
      'div',
      { class: 'hero' },
      h('span', { class: 'hero-label' }, 'Models destroyed, average'),
      h('span', { class: 'hero-value' }, fmt(result.total.modelsDestroyed)),
      h('span', { class: 'hero-context' }, `of ${models} model${models === 1 ? '' : 's'}`),
    ),
    h(
      'dl',
      { class: 'stat-tiles' },
      tile('Damage applied', fmt(result.total.damage), `of ${models * wounds} wounds`),
      tile('Unsaved wounds', fmt(result.total.unsaved), 'before overflow is lost'),
      tile('Unit wiped out', pct(wipe), `${result.iterations.toLocaleString()} runs`),
    ),
  );
}

function tile(label: string, value: string, context: string): HTMLElement {
  return h('div', { class: 'tile' }, h('dt', {}, label), h('dd', {}, h('span', { class: 'tile-value' }, value), h('span', { class: 'tile-context' }, context)));
}

function stepTable(result: SimulationResult, weapons: WeaponProfile[], defender: DefenderProfile): HTMLElement {
  const headRow = h('tr', {}, h('th', { scope: 'col' }, 'Weapon'), ...STEPS.map((s) => h('th', { scope: 'col', class: 'num' }, s.label)));
  const bodyRows = result.perWeapon.map((p, i) => {
    const models = weapons.find((w) => w.id === p.id)?.models;
    const name = p.name || `Weapon ${i + 1}`;
    return h(
      'tr',
      {},
      h('th', { scope: 'row' }, h('span', { class: 'order' }, `${i + 1}.`), ' ', models === undefined ? name : `${models}× ${name}`),
      ...STEPS.map((s) => h('td', { class: 'num' }, fmt(p.stats[s.key]))),
    );
  });
  const totalRow = h('tr', {}, h('th', { scope: 'row' }, 'Total'), ...STEPS.map((s) => h('td', { class: 'num' }, fmt(result.total[s.key]))));

  return h(
    'section',
    { class: 'result-block', 'aria-labelledby': 'steps-title' },
    h('h3', { id: 'steps-title' }, 'Average per step'),
    h(
      'div',
      { class: 'table-scroll' },
      h('table', { class: 'step-table' }, h('thead', {}, headRow), h('tbody', {}, ...bodyRows), h('tfoot', {}, totalRow)),
    ),
    calculationView(weapons, defender),
  );
}

/**
 * "Show the calculation": the averages worked out step by step as formulas. The exact damage
 * per weapon takes a moment for large units, so it is only worked out when first opened.
 */
function calculationView(weapons: WeaponProfile[], defender: DefenderProfile): HTMLElement {
  const details = h('details', { class: 'table-view' }, h('summary', {}, 'Show the calculation'));
  details.addEventListener('toggle', () => {
    if (!details.open || details.childElementCount > 1) return;
    details.append(renderCalculation(breakdown(weapons, defender), defender));
  });
  return details;
}

function chartSection(result: SimulationResult, chartHost: HTMLElement): HTMLElement {
  const rows = result.killAtLeast.map((p, k) =>
    h('tr', {}, h('th', { scope: 'row', class: 'num' }, String(k)), h('td', { class: 'num' }, pct(result.killDistribution[k])), h('td', { class: 'num' }, pct(p))),
  );
  const table = h(
    'details',
    { class: 'table-view' },
    h('summary', {}, 'Show as table'),
    h(
      'div',
      { class: 'table-scroll' },
      h(
        'table',
        { class: 'dist-table' },
        h(
          'thead',
          {},
          h('tr', {}, h('th', { scope: 'col', class: 'num' }, 'Models destroyed'), h('th', { scope: 'col', class: 'num' }, 'Exactly'), h('th', { scope: 'col', class: 'num' }, 'At least')),
        ),
        h('tbody', {}, ...rows),
      ),
    ),
  );

  return h(
    'section',
    { class: 'result-block', 'aria-labelledby': 'chart-title' },
    h('h3', { id: 'chart-title' }, 'Chance to destroy at least k models'),
    chartHost,
    table,
  );
}

function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number> = {}): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value));
  return el;
}

/** Column with a 4px rounded top and a square base, from (x, yTop) down to baseline. */
function columnPath(x: number, yTop: number, width: number, baseline: number): string {
  const r = Math.min(4, width / 2, baseline - yTop);
  if (r <= 0) return '';
  return [
    `M${x},${baseline}`,
    `V${yTop + r}`,
    `Q${x},${yTop} ${x + r},${yTop}`,
    `H${x + width - r}`,
    `Q${x + width},${yTop} ${x + width},${yTop + r}`,
    `V${baseline}`,
    'Z',
  ].join(' ');
}

/** Column chart of P(at least k destroyed) for k = 1..models, with hover/focus tooltips. */
function killChart(atLeast: number[], exactly: number[], width: number): HTMLElement {
  const height = 240;
  const margin = { top: 16, right: 8, bottom: 40, left: 44 };
  const plotW = Math.max(40, width - margin.left - margin.right);
  const plotH = height - margin.top - margin.bottom;
  const baseline = margin.top + plotH;
  const ks = atLeast.map((_, k) => k).slice(1);
  const band = plotW / ks.length;
  const barW = Math.max(2, Math.min(24, band * 0.6));
  const y = (p: number) => margin.top + plotH * (1 - p);

  const root = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', class: 'kill-chart' });
  root.setAttribute(
    'aria-label',
    `Column chart. ${ks.map((k) => `At least ${k} destroyed: ${pct(atLeast[k])}`).join('. ')}.`,
  );

  // Gridlines + y ticks.
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    root.append(svg('line', { x1: margin.left, x2: margin.left + plotW, y1: y(t), y2: y(t), class: t === 0 ? 'axis' : 'grid' }));
    const label = svg('text', { x: margin.left - 8, y: y(t), class: 'tick', 'text-anchor': 'end', 'dominant-baseline': 'middle' });
    label.textContent = `${t * 100}%`;
    root.append(label);
  }

  // X ticks: thin out labels when the unit is large.
  const labelEvery = Math.max(1, Math.ceil(28 / band));
  const xTitle = svg('text', { x: margin.left + plotW / 2, y: height - 4, class: 'axis-title', 'text-anchor': 'middle' });
  xTitle.textContent = 'Models destroyed (at least)';
  root.append(xTitle);

  const wrapper = h('div', { class: 'chart-wrap' });
  const tooltip = h('div', { class: 'chart-tooltip', role: 'tooltip', hidden: true });

  const showTip = (k: number, cx: number) => {
    tooltip.replaceChildren(
      h('div', { class: 'tip-title' }, `At least ${k} destroyed`),
      h('div', { class: 'tip-row' }, h('span', { class: 'tip-key' }), h('span', {}, pct(atLeast[k]))),
      h('div', { class: 'tip-sub' }, `Exactly ${k}: ${pct(exactly[k])}`),
    );
    tooltip.hidden = false;
    const tipW = tooltip.offsetWidth;
    const left = Math.min(Math.max(cx - tipW / 2, 0), width - tipW);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${Math.max(0, y(atLeast[k]) - tooltip.offsetHeight - 10)}px`;
  };
  const hideTip = () => (tooltip.hidden = true);

  ks.forEach((k, i) => {
    const cx = margin.left + band * i + band / 2;
    const p = atLeast[k];
    const group = svg('g', { class: 'col', tabindex: 0 });
    group.setAttribute('aria-label', `At least ${k} destroyed: ${pct(p)}; exactly ${k}: ${pct(exactly[k])}`);

    // Hit target: the whole band, taller than the mark.
    group.append(svg('rect', { x: margin.left + band * i, y: margin.top, width: band, height: plotH, class: 'hit' }));
    const d = columnPath(cx - barW / 2, y(p), barW, baseline);
    if (d) group.append(svg('path', { d, class: 'bar' }));

    if (i % labelEvery === 0 || k === ks[ks.length - 1]) {
      const label = svg('text', { x: cx, y: baseline + 16, class: 'tick', 'text-anchor': 'middle' });
      label.textContent = String(k);
      root.append(label);
    }

    group.addEventListener('pointerenter', () => {
      group.classList.add('active');
      showTip(k, cx);
    });
    group.addEventListener('pointerleave', () => {
      group.classList.remove('active');
      hideTip();
    });
    group.addEventListener('focus', () => {
      group.classList.add('active');
      showTip(k, cx);
    });
    group.addEventListener('blur', () => {
      group.classList.remove('active');
      hideTip();
    });
    root.append(group);
  });

  wrapper.append(root, tooltip);
  return wrapper;
}
