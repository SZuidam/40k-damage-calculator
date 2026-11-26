import './style.css';
import { optimiseOrder, type OptimiseResult } from './engine/optimise';
import { simulate } from './engine/simulate';
import { carriedWeapons, defenderOf, newLoadout, reconcileAttacker, reconcileDefender, reorderCarried, resolveLoadout, unitsOfArmy } from './state/loadout';
import { loadState, saveState } from './state/storage';
import type { Unit, WeaponProfile } from './types';
import { renderAttackConditions } from './ui/conditionsForm';
import { renderDefenderPanel } from './ui/defenderPanel';
import { field, h, numberValue, setFieldError } from './ui/dom';
import { Drawer } from './ui/drawer';
import { LoadoutRows } from './ui/loadoutRows';
import { createResultsView } from './ui/results';
import { openExportModal, openImportModal } from './ui/shareModal';
import { UnitPicker } from './ui/unitPicker';
import { UnitsPanel } from './ui/unitsPanel';
import { hasErrors, validateDefender, validateIterations, validateLoadoutRow } from './ui/validation';

const OPTIMISE_DEBOUNCE_MS = 200;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** All app state. Objects and arrays are mutated in place: the views hold references to them. */
const state = loadState();
const form = $<HTMLFormElement>('calculator');
const optimiseButton = $<HTMLButtonElement>('optimise');
const optimiseBadge = $<HTMLSpanElement>('optimise-badge');
const optimiseStatus = $<HTMLParagraphElement>('optimise-status');
const simulateButton = $<HTMLButtonElement>('simulate');
const runStatus = $<HTMLParagraphElement>('run-status');
const results = createResultsView($('results'));

let hasResults = false;
let optimiseTimer: number | undefined;
let lastOptimise: OptimiseResult | null = null;
let reorderNote = '';
let reordering = false;

const findUnit = (id: string | null): Unit | undefined => state.units.find((u) => u.id === id);
const attackingUnit = () => findUnit(state.attacker.unitId);
const defendingUnit = () => findUnit(state.defender.unitId);

/** The carried weapons of the attacking unit, in firing order (empty without a unit). */
function carried() {
  const unit = attackingUnit();
  return unit ? carriedWeapons(unit, state.attacker.rows) : [];
}

/** Engine input for the attacker: its carried weapons (empty without a unit). */
function attackerWeapons(): WeaponProfile[] {
  const unit = attackingUnit();
  return unit ? resolveLoadout(unit, state.attacker.rows, state.conditions) : [];
}

const carriedValid = () => carried().every(({ row, weapon }) => !hasErrors(validateLoadoutRow(row.count, weapon)));

function defenderValid(): boolean {
  const unit = defendingUnit();
  return unit !== undefined && !hasErrors(validateDefender(defenderOf(unit, state.defender.models)));
}

/** Why Simulate is disabled, or '' when it isn't. */
function blockedReason(): string {
  const unit = attackingUnit();
  if (state.units.length === 0) return 'Create units under ☰ → Units to simulate.';
  if (!unit) return 'Pick an attacking unit to simulate.';
  if (unit.weapons.length === 0) return 'Give the attacking unit weapons under ☰ → Units to simulate.';
  if (carried().length === 0) return 'Tick the weapons the attacking unit carries to simulate.';
  if (!carriedValid()) return 'Fix the highlighted weapons to simulate.';
  if (!defendingUnit()) return 'Pick a defending unit to simulate.';
  if (!defenderValid()) return 'Fix the defender to simulate.';
  if (validateIterations(state.iterations) !== undefined) return 'Set a valid number of iterations under ☰ → Settings to simulate.';
  return '';
}

/** Anything that feeds the simulation changed: save, refresh the views and re-run the optimiser. */
function onInputsChanged(): void {
  saveState(state);
  // The Blast / Cleave extra attacks on the A chips depend on the defender's model count,
  // the Anti markers on its keywords, Rapid Fire, Melta and Lance on the attack conditions.
  loadoutRows.refreshStats();
  if (!reordering) reorderNote = '';
  const reason = blockedReason();
  simulateButton.disabled = reason !== '';
  runStatus.textContent = reason;
  if (hasResults) results.markStale(true);
  scheduleOptimise();
}

/** The Units tab changed armies or units: follow them on the main page (a deleted unit is unpicked, weapons sync). */
function onUnitsChanged(): void {
  reconcileAttacker(state.attacker, state.armies, state.units);
  reconcileDefender(state.defender, state.armies, state.units);
  attackerPicker.render();
  defenderPicker.render();
  loadoutRows.render();
  defenderPanel.render();
  onInputsChanged();
}

// ---------- Optimiser ----------

function scheduleOptimise(): void {
  window.clearTimeout(optimiseTimer);
  lastOptimise = null;
  setOptimiseState('pending');
  optimiseTimer = window.setTimeout(runOptimise, OPTIMISE_DEBOUNCE_MS);
}

function runOptimise(): void {
  if (carried().length < 2) return setOptimiseState('single');
  if (blockedReason() !== '') return setOptimiseState('invalid');
  // Resolved index i is carried row i.
  lastOptimise = optimiseOrder(attackerWeapons(), defenderOf(defendingUnit()!, state.defender.models));
  setOptimiseState('ready');
}

type OptimiseState = 'pending' | 'single' | 'invalid' | 'ready';

/** Update the Optimise order button, its badge and its status line under the rows. */
function setOptimiseState(kind: OptimiseState): void {
  const result = lastOptimise;
  const beneficial = kind === 'ready' && result !== null && result.beneficial;
  optimiseButton.classList.toggle('is-recommended', beneficial);
  optimiseButton.disabled = kind !== 'ready';
  optimiseBadge.hidden = !beneficial;

  if (kind === 'single') {
    optimiseStatus.textContent = carried().length === 0 ? '' : 'Tick a second weapon to compare orders.';
    optimiseButton.title = '';
  } else if (kind === 'invalid') {
    optimiseStatus.textContent = '';
    optimiseButton.title = '';
  } else if (kind === 'pending' || !result) {
    optimiseButton.title = '';
  } else if (result.beneficial) {
    const gain = `+${result.gain.toFixed(2)}`;
    const weapons = attackerWeapons();
    const order = result.bestOrder.map((i) => weaponLabel(weapons, i)).join(' → ');
    const range = `${result.current.expectedModelsDestroyed.toFixed(2)} → ${result.best.expectedModelsDestroyed.toFixed(2)}`;
    optimiseBadge.textContent = `${gain} models`;
    optimiseStatus.textContent = `Better order found: ${gain} models destroyed on average (${range}).`;
    optimiseButton.title = `${order}${result.method === 'greedy' ? ' (greedy search)' : ''}`;
  } else {
    const verdict = result.method === 'greedy' ? 'No better order found (greedy search).' : 'Current order is already the best.';
    optimiseStatus.textContent = reorderNote ? `${reorderNote} ${verdict}` : verdict;
    reorderNote = '';
    optimiseButton.title = 'Reordering would not destroy more models on average.';
  }
}

function weaponLabel(weapons: WeaponProfile[], index: number): string {
  const weapon = weapons[index];
  return weapon ? `${weapon.models}× ${weapon.name}` : `Weapon ${index + 1}`;
}

function applyBestOrder(): void {
  if (!lastOptimise) return;
  const { bestOrder, beneficial, gain } = lastOptimise;
  const changed = bestOrder.some((v, i) => v !== i);
  reorderNote = beneficial ? `Reordered: +${gain.toFixed(2)} models destroyed on average.` : '';
  if (!changed) return;
  const rows = state.attacker.rows;
  rows.splice(0, rows.length, ...reorderCarried(rows, bestOrder));
  reordering = true;
  loadoutRows.render();
  onInputsChanged();
  reordering = false;
}

optimiseButton.addEventListener('click', applyBestOrder);

// ---------- Simulation ----------

function runSimulation(): void {
  if (blockedReason() !== '') return;
  simulateButton.disabled = true;
  runStatus.textContent = 'Simulating…';
  // Let the status paint before the (synchronous) simulation blocks the thread.
  window.setTimeout(() => {
    const weapons = attackerWeapons();
    const defender = defenderOf(defendingUnit()!, state.defender.models);
    const started = performance.now();
    const result = simulate(weapons, defender, state.iterations);
    const ms = Math.round(performance.now() - started);
    results.show(result, weapons, defender.models, defender.wounds);
    hasResults = true;
    simulateButton.disabled = false;
    runStatus.textContent = `${state.iterations.toLocaleString()} runs in ${ms.toLocaleString()} ms.`;
  }, 20);
}

// ---------- Attacker ----------

const attackerPicker = new UnitPicker({
  idPrefix: 'attacker',
  armies: state.armies,
  units: state.units,
  selection: () => state.attacker,
  onArmyChange: (armyId) => {
    state.attacker.armyId = armyId;
    // The picked unit stays only when it belongs to the new army.
    if (!unitsOfArmy(state.units, state.armies, armyId).some((u) => u.id === state.attacker.unitId)) pickAttacker(null);
    attackerPicker.render();
    onInputsChanged();
  },
  onUnitChange: (unitId) => {
    pickAttacker(unitId);
    attackerPicker.render();
    onInputsChanged();
  },
});
$('attacker-picker').append(attackerPicker.element);

/** Pick the attacking unit: its weapons start unticked, DEFAULT_WEAPON_COUNT each. */
function pickAttacker(unitId: string | null): void {
  const unit = findUnit(unitId);
  state.attacker.unitId = unit?.id ?? null;
  state.attacker.rows = unit ? newLoadout(unit) : [];
  loadoutRows.render();
}

// Situational: saved with the page state, but not part of a unit.
renderAttackConditions($('attack-conditions'), state.conditions, onInputsChanged);

const loadoutRows = new LoadoutRows($('loadout'), state.attacker, {
  onChange: onInputsChanged,
  unit: attackingUnit,
  defender: () => {
    const unit = defendingUnit();
    return unit ? { models: state.defender.models, keywords: unit.keywords } : undefined;
  },
  conditions: () => state.conditions,
});

// ---------- Defender ----------

const defenderPicker = new UnitPicker({
  idPrefix: 'defender',
  armies: state.armies,
  units: state.units,
  selection: () => state.defender,
  onArmyChange: (armyId) => {
    state.defender.armyId = armyId;
    if (!unitsOfArmy(state.units, state.armies, armyId).some((u) => u.id === state.defender.unitId)) state.defender.unitId = null;
    defenderPicker.render();
    defenderPanel.render();
    onInputsChanged();
  },
  onUnitChange: (unitId) => {
    // The number of models stays: it is the size of whatever unit is picked.
    state.defender.unitId = findUnit(unitId)?.id ?? null;
    defenderPicker.render();
    defenderPanel.render();
    onInputsChanged();
  },
});
$('defender-picker').append(defenderPicker.element);

const defenderPanel = renderDefenderPanel($('defender'), state.defender, defendingUnit, onInputsChanged);

// ---------- Configuration drawer ----------

const unitsPanel = new UnitsPanel({ armies: state.armies, units: state.units, onChange: onUnitsChanged });

function settingsPanel(): HTMLElement {
  const iterations = h('input', { id: 'iterations', type: 'number', inputmode: 'numeric', min: 100, max: 1_000_000, step: 1000, value: state.iterations });
  const sync = () => setFieldError(iterations, validateIterations(state.iterations));
  iterations.addEventListener('input', () => {
    state.iterations = numberValue(iterations);
    sync();
    onInputsChanged();
  });
  sync();

  const importButton = h('button', { type: 'button', class: 'button secondary' }, 'Import…');
  const exportButton = h('button', { type: 'button', class: 'button secondary' }, 'Export…');
  exportButton.addEventListener('click', () => openExportModal(state));
  importButton.addEventListener('click', () =>
    openImportModal({
      state,
      // Units and armies may have been added or replaced: the Units tab and the main page follow.
      onImported: () => {
        unitsPanel.render();
        onUnitsChanged();
      },
    }),
  );

  return h(
    'div',
    { class: 'settings-panel' },
    h(
      'section',
      { class: 'settings-section' },
      h('h3', {}, 'Simulation'),
      field('Iterations', iterations, 'field--iterations'),
      h('p', { class: 'panel-hint' }, 'Simulated runs per press of Simulate, from 100 to 1,000,000. More runs give smoother results but take longer.'),
    ),
    h(
      'section',
      { class: 'settings-section' },
      h('h3', {}, 'Import and export'),
      h('p', { class: 'panel-hint' }, 'Share units, with their weapons and army, with another browser or device as a JSON file.'),
      h('div', { class: 'panel-actions-group' }, importButton, exportButton),
    ),
  );
}

const drawer = new Drawer([
  { tab: 'units', label: 'Units', content: unitsPanel.element, onShow: () => unitsPanel.render() },
  { tab: 'settings', label: 'Settings', content: settingsPanel() },
]);

$('open-config').addEventListener('click', () => drawer.open());

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSimulation();
});

onInputsChanged();
