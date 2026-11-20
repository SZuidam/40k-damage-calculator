import './style.css';
import { optimiseOrder, type OptimiseResult } from './engine/optimise';
import { simulate } from './engine/simulate';
import { uid } from './state/ids';
import { byName, copyDefender, findWeapon, resolveRows, sameDefender } from './state/presets';
import { loadState, saveState } from './state/storage';
import type { AttackProfile } from './types';
import { AttackEditor } from './ui/attackEditor';
import { AttackRoster } from './ui/attackRoster';
import { renderAttackConditions } from './ui/conditionsForm';
import { renderDefenderForm } from './ui/defenderForm';
import { field, h, numberValue, setFieldError } from './ui/dom';
import { Drawer } from './ui/drawer';
import { PresetBar } from './ui/presetBar';
import { createResultsView } from './ui/results';
import { openExportModal, openImportModal } from './ui/shareModal';
import { hasErrors, validateDefender, validateIterations, validateRow } from './ui/validation';
import { WeaponsPanel } from './ui/weaponsPanel';

const OPTIMISE_DEBOUNCE_MS = 200;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** All app state. Arrays are mutated in place: the views hold references to them. */
const state = loadState();
const form = $<HTMLFormElement>('calculator');
const attackSelect = $<HTMLSelectElement>('attack-select');
const simulateButton = $<HTMLButtonElement>('simulate');
const runStatus = $<HTMLParagraphElement>('run-status');
const optimiseHint = $<HTMLParagraphElement>('optimise-hint');
const results = createResultsView($('results'));

let hasResults = false;
let optimiseTimer: number | undefined;
let lastOptimise: OptimiseResult | null = null;
let reorderNote = '';
let reordering = false;

/** The attack the main page shows and simulates. Storage guarantees there is one. */
function activeAttack(): AttackProfile {
  return state.attacks.find((a) => a.id === state.activeAttackId) ?? state.attacks[0];
}

const rows = () => activeAttack().rows;

function rowsValid(): boolean {
  return rows().length > 0 && rows().every((r) => !hasErrors(validateRow(r, state.library)));
}

function inputsValid(): boolean {
  return rowsValid() && !hasErrors(validateDefender(state.defender)) && validateIterations(state.iterations) === undefined;
}

/** Why Simulate is disabled, or '' when it isn't. */
function blockedReason(): string {
  if (rows().length === 0) return 'Add weapons with ✎ Edit attack to simulate.';
  if (!rowsValid()) return 'Fix the attack with ✎ Edit attack to simulate.';
  if (hasErrors(validateDefender(state.defender))) return 'Fix the highlighted defender fields to simulate.';
  if (validateIterations(state.iterations) !== undefined) return 'Set a valid number of iterations under ☰ → Settings to simulate.';
  return '';
}

/** Anything that feeds the simulation changed: save, refresh the views and re-run the optimiser. */
function onInputsChanged(): void {
  saveState(state);
  // The Blast / Cleave extra attacks on the A chips depend on the defender's model count,
  // the Anti markers on its keywords, Rapid Fire, Melta and Lance on the attack conditions.
  roster.render();
  editor.refreshStats();
  if (!reordering) reorderNote = '';
  const reason = blockedReason();
  simulateButton.disabled = reason !== '';
  runStatus.textContent = reason;
  if (hasResults) results.markStale(true);
  defenderBar.refresh();
  scheduleOptimise();
}

/** A library profile was created, edited or deleted: every view showing library data redraws. */
function onLibraryChanged(): void {
  editor.renderRows();
  weaponsPanel.render();
  onInputsChanged();
}

/** An attack was created, renamed, duplicated or deleted. */
function onAttacksChanged(): void {
  renderAttackSelect();
  editor.renderSelect();
  onInputsChanged();
}

function selectAttack(id: string): void {
  if (!state.attacks.some((a) => a.id === id)) return;
  state.activeAttackId = id;
  renderAttackSelect();
  editor.setAttack();
  onInputsChanged();
}

function renderAttackSelect(): void {
  attackSelect.replaceChildren(...byName(state.attacks).map((a) => h('option', { value: a.id }, a.name)));
  attackSelect.value = activeAttack().id;
}

// ---------- Optimiser ----------

function scheduleOptimise(): void {
  window.clearTimeout(optimiseTimer);
  lastOptimise = null;
  setOptimiseState('pending');
  optimiseTimer = window.setTimeout(runOptimise, OPTIMISE_DEBOUNCE_MS);
}

function runOptimise(): void {
  if (rows().length < 2) return setOptimiseState('single');
  if (!inputsValid()) return setOptimiseState('invalid');
  // Every row is valid here, so resolved index i is row i.
  lastOptimise = optimiseOrder(resolveRows(rows(), state.library, state.conditions), state.defender);
  setOptimiseState('ready');
}

type OptimiseState = 'pending' | 'single' | 'invalid' | 'ready';

/** Update the Optimise order button in the attack editor and the hint on the main page. */
function setOptimiseState(kind: OptimiseState): void {
  const { optimiseButton, optimiseBadge, optimiseStatus } = editor;
  const result = lastOptimise;
  const beneficial = kind === 'ready' && result !== null && result.beneficial;
  optimiseButton.classList.toggle('is-recommended', beneficial);
  optimiseButton.disabled = kind !== 'ready';
  optimiseBadge.hidden = !beneficial;
  // While the optimiser is pending the hint keeps its last state, so it doesn't flicker on every keystroke.
  if (kind !== 'pending') optimiseHint.hidden = !beneficial;

  if (kind === 'single') {
    optimiseStatus.textContent = rows().length === 0 ? '' : 'Add a second weapon to compare orders.';
    optimiseButton.title = '';
  } else if (kind === 'invalid') {
    optimiseStatus.textContent = '';
    optimiseButton.title = '';
  } else if (kind === 'pending' || !result) {
    optimiseButton.title = '';
  } else if (result.beneficial) {
    const gain = `+${result.gain.toFixed(2)}`;
    const order = result.bestOrder.map((i) => rowLabel(i)).join(' → ');
    const range = `${result.current.expectedModelsDestroyed.toFixed(2)} → ${result.best.expectedModelsDestroyed.toFixed(2)}`;
    optimiseBadge.textContent = `${gain} models`;
    optimiseStatus.textContent = `Better order found: ${gain} models destroyed on average (${range}).`;
    optimiseButton.title = `${order}${result.method === 'greedy' ? ' (greedy search)' : ''}`;
    const open = h('button', { type: 'button', class: 'link-button' }, 'Edit attack');
    open.addEventListener('click', () => drawer.open('attacks'));
    optimiseHint.replaceChildren(`A better firing order destroys ${gain} models on average (${range}). `, open);
  } else {
    const verdict = result.method === 'greedy' ? 'No better order found (greedy search).' : 'Current order is already the best.';
    optimiseStatus.textContent = reorderNote ? `${reorderNote} ${verdict}` : verdict;
    reorderNote = '';
    optimiseButton.title = 'Reordering would not destroy more models on average.';
  }
}

function rowLabel(index: number): string {
  const row = rows()[index];
  const weapon = row && findWeapon(state.library, row.weaponId);
  return weapon ? `${row.models}× ${weapon.name}` : `Weapon ${index + 1}`;
}

function applyBestOrder(): void {
  if (!lastOptimise) return;
  const { bestOrder, beneficial, gain } = lastOptimise;
  const changed = bestOrder.some((v, i) => v !== i);
  reorderNote = beneficial ? `Reordered: +${gain.toFixed(2)} models destroyed on average.` : '';
  reordering = true;
  if (changed) editor.reorder(bestOrder);
  reordering = false;
}

// ---------- Simulation ----------

function runSimulation(): void {
  if (!inputsValid()) return;
  simulateButton.disabled = true;
  runStatus.textContent = 'Simulating…';
  // Let the status paint before the (synchronous) simulation blocks the thread.
  window.setTimeout(() => {
    const weapons = resolveRows(rows(), state.library, state.conditions);
    const defender = copyDefender(state.defender);
    const started = performance.now();
    const result = simulate(weapons, defender, state.iterations);
    const ms = Math.round(performance.now() - started);
    results.show(result, weapons, defender.models, defender.wounds);
    hasResults = true;
    simulateButton.disabled = false;
    runStatus.textContent = `${state.iterations.toLocaleString()} runs in ${ms.toLocaleString()} ms.`;
  }, 20);
}

// ---------- Main page ----------

const roster = new AttackRoster($('attack-roster'), {
  rows,
  library: state.library,
  defender: () => state.defender,
  conditions: () => state.conditions,
});
// Situational: saved with the page state, but not part of attacks or exports.
renderAttackConditions($('attack-conditions'), state.conditions, onInputsChanged);
const defenderForm = renderDefenderForm($('defender'), state.defender, onInputsChanged);
attackSelect.addEventListener('change', () => selectAttack(attackSelect.value));

const defenderBar = new PresetBar({
  label: 'Defender preset',
  idPrefix: 'defender-preset',
  items: () => state.defenderPresets,
  activeId: () => state.activeDefenderPresetId,
  isDirty: () => {
    const preset = state.defenderPresets.find((p) => p.id === state.activeDefenderPresetId);
    return preset !== undefined && !sameDefender(state.defender, preset.defender);
  },
  canSave: () => !hasErrors(validateDefender(state.defender)),
  onLoad: (id) => {
    state.activeDefenderPresetId = id;
    const preset = state.defenderPresets.find((p) => p.id === id);
    if (preset) {
      Object.assign(state.defender, copyDefender(preset.defender));
      defenderForm.setValues();
    }
    onInputsChanged();
  },
  onSave: (id) => {
    const preset = state.defenderPresets.find((p) => p.id === id);
    if (!preset) return;
    preset.defender = copyDefender(state.defender);
    state.activeDefenderPresetId = id;
    onInputsChanged();
  },
  onSaveAs: (name) => {
    const preset = { id: uid('defender'), name, defender: copyDefender(state.defender) };
    state.defenderPresets.push(preset);
    state.activeDefenderPresetId = preset.id;
    onInputsChanged();
  },
  onDelete: (id) => {
    state.defenderPresets.splice(
      state.defenderPresets.findIndex((p) => p.id === id),
      1,
    );
    if (state.activeDefenderPresetId === id) state.activeDefenderPresetId = null;
    onInputsChanged();
  },
});
$('defender-presets').append(defenderBar.element);

// ---------- Configuration drawer ----------

const editor = new AttackEditor({
  library: state.library,
  attacks: state.attacks,
  activeAttack,
  onSelectAttack: selectAttack,
  onAttacksChanged,
  onChange: onInputsChanged,
  onLibraryChange: onLibraryChanged,
  onOptimise: applyBestOrder,
  defender: () => state.defender,
  conditions: () => state.conditions,
});

const weaponsPanel = new WeaponsPanel({ library: state.library, attacks: state.attacks, onChange: onLibraryChanged });

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
      onImported: () => {
        // Weapons may have been added or replaced, attacks and presets added or
        // overwritten (a replaced attack gets a new rows array, so the editor re-links).
        editor.setAttack();
        renderAttackSelect();
        onLibraryChanged();
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
      h('p', { class: 'panel-hint' }, 'Share attacks, defender presets and weapon profiles with another browser or device as a JSON file.'),
      h('div', { class: 'panel-actions-group' }, importButton, exportButton),
    ),
  );
}

const drawer = new Drawer([
  { tab: 'attacks', label: 'Attacks', content: editor.element },
  { tab: 'weapons', label: 'Weapons', content: weaponsPanel.element, onShow: () => weaponsPanel.render() },
  { tab: 'settings', label: 'Settings', content: settingsPanel() },
]);

$('open-config').addEventListener('click', () => drawer.open());
$('edit-attack').addEventListener('click', () => drawer.open('attacks'));

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSimulation();
});

renderAttackSelect();
onInputsChanged();
