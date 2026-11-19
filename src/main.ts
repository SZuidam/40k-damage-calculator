import './style.css';
import { optimiseOrder, type OptimiseResult } from './engine/optimise';
import { simulate } from './engine/simulate';
import { uid } from './state/ids';
import { copyDefender, findWeapon, materialiseRows, resolveRows, sameDefender, sameSnapshot, snapshotRows } from './state/presets';
import { loadState, saveState } from './state/storage';
import { AttackList } from './ui/attackList';
import { renderDefenderForm } from './ui/defenderForm';
import { h, numberValue, setFieldError } from './ui/dom';
import { openLibraryModal } from './ui/libraryModal';
import { openExportModal, openImportModal } from './ui/shareModal';
import { PresetBar } from './ui/presetBar';
import { createResultsView } from './ui/results';
import { openUnitModal } from './ui/unitModal';
import { hasErrors, validateDefender, validateIterations, validateRow } from './ui/validation';

const OPTIMISE_DEBOUNCE_MS = 200;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** All app state. Arrays are mutated in place: the views hold references to them. */
const state = loadState();
const form = $<HTMLFormElement>('calculator');
const iterationsInput = $<HTMLInputElement>('iterations');
const simulateButton = $<HTMLButtonElement>('simulate');
const runStatus = $<HTMLParagraphElement>('run-status');
const optimiseButton = $<HTMLButtonElement>('optimise');
const optimiseBadge = $<HTMLSpanElement>('optimise-badge');
const optimiseStatus = $<HTMLParagraphElement>('optimise-status');
const addUnitSelect = $<HTMLSelectElement>('add-unit');
const results = createResultsView($('results'));

let hasResults = false;
let optimiseTimer: number | undefined;
let lastOptimise: OptimiseResult | null = null;
let reorderNote = '';
let reordering = false;

function rowsValid(): boolean {
  return state.rows.length > 0 && state.rows.every((r) => !hasErrors(validateRow(r, state.library)));
}

function inputsValid(): boolean {
  return rowsValid() && !hasErrors(validateDefender(state.defender)) && validateIterations(state.iterations) === undefined;
}

function onInputsChanged(): void {
  saveState(state);
  // The Blast / Cleave extra attacks on the A chips depend on the defender's model count,
  // the Anti markers on its keywords.
  attackList.refreshStats();
  if (!reordering) reorderNote = '';
  simulateButton.disabled = !inputsValid();
  runStatus.textContent = simulateButton.disabled ? 'Fix the highlighted fields to simulate.' : '';
  if (hasResults) results.markStale(true);
  attackBar.refresh();
  defenderBar.refresh();
  scheduleOptimise();
}

/** A library profile was created, edited or deleted: every row view shows library data. */
function onLibraryChanged(): void {
  attackList.render();
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
  if (state.rows.length < 2) return setOptimiseState('single');
  if (!inputsValid()) return setOptimiseState('invalid');
  // Every row is valid here, so resolved index i is row i.
  lastOptimise = optimiseOrder(resolveRows(state.rows, state.library), state.defender);
  setOptimiseState('ready');
}

type OptimiseState = 'pending' | 'single' | 'invalid' | 'ready';

function setOptimiseState(kind: OptimiseState): void {
  const result = lastOptimise;
  const beneficial = kind === 'ready' && result !== null && result.beneficial;
  optimiseButton.classList.toggle('is-recommended', beneficial);
  optimiseButton.disabled = kind !== 'ready';
  optimiseBadge.hidden = !beneficial;

  if (kind === 'single') {
    optimiseStatus.textContent = 'Add a second weapon to compare orders.';
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
  } else {
    const verdict = result.method === 'greedy' ? 'No better order found (greedy search).' : 'Current order is already the best.';
    optimiseStatus.textContent = reorderNote ? `${reorderNote} ${verdict}` : verdict;
    reorderNote = '';
    optimiseButton.title = 'Reordering would not destroy more models on average.';
  }
}

function rowLabel(index: number): string {
  const row = state.rows[index];
  const weapon = row && findWeapon(state.library, row.weaponId);
  return weapon ? `${row.models}× ${weapon.name}` : `Weapon ${index + 1}`;
}

// ---------- Simulation ----------

function runSimulation(): void {
  if (!inputsValid()) return;
  simulateButton.disabled = true;
  runStatus.textContent = 'Simulating…';
  // Let the status paint before the (synchronous) simulation blocks the thread.
  window.setTimeout(() => {
    const weapons = resolveRows(state.rows, state.library);
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

// ---------- Views ----------

const attackList = new AttackList($('weapons'), state.rows, {
  library: state.library,
  onChange: onInputsChanged,
  onLibraryChange: onLibraryChanged,
  defender: () => state.defender,
});
const defenderForm = renderDefenderForm($('defender'), state.defender, onInputsChanged);

/** Replace the live rows (and library, which may have gained restored weapons). */
function setRows(rows: typeof state.rows, library: typeof state.library): void {
  state.library.splice(0, state.library.length, ...library);
  state.rows.splice(0, state.rows.length, ...rows);
  attackList.render();
}

const attackBar = new PresetBar({
  label: 'Attack profile',
  idPrefix: 'attack-preset',
  items: () => state.attackPresets,
  activeId: () => state.activeAttackPresetId,
  isDirty: () => {
    const preset = state.attackPresets.find((p) => p.id === state.activeAttackPresetId);
    if (!preset) return false;
    const unlinked = state.rows.some((r) => !findWeapon(state.library, r.weaponId));
    return unlinked || !sameSnapshot(snapshotRows(state.rows, state.library), preset.rows);
  },
  canSave: rowsValid,
  onLoad: (id) => {
    state.activeAttackPresetId = id;
    const preset = state.attackPresets.find((p) => p.id === id);
    if (preset) {
      const loaded = materialiseRows(preset.rows, state.library, preset.name);
      setRows(loaded.rows, loaded.library);
    }
    onInputsChanged();
  },
  onSave: (id) => {
    const preset = state.attackPresets.find((p) => p.id === id);
    if (!preset) return;
    preset.rows = snapshotRows(state.rows, state.library);
    state.activeAttackPresetId = id;
    onInputsChanged();
  },
  onSaveAs: (name) => {
    const preset = { id: uid('attack'), name, rows: snapshotRows(state.rows, state.library) };
    state.attackPresets.push(preset);
    state.activeAttackPresetId = preset.id;
    onInputsChanged();
  },
  onDelete: (id) => {
    state.attackPresets.splice(
      state.attackPresets.findIndex((p) => p.id === id),
      1,
    );
    if (state.activeAttackPresetId === id) state.activeAttackPresetId = null;
    onInputsChanged();
  },
});
$('attack-presets').append(attackBar.element);

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

// ---------- Units ----------

function renderAddUnitSelect(): void {
  const units = [...state.unitPresets].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }));
  addUnitSelect.replaceChildren(
    h('option', { value: '' }, '+ Add unit'),
    ...units.map((u) => h('option', { value: u.id }, u.name)),
  );
  addUnitSelect.value = '';
  addUnitSelect.disabled = units.length === 0;
  addUnitSelect.title = units.length === 0 ? 'Save a unit with “Units…” first' : 'Append a saved unit to the attack';
}

addUnitSelect.addEventListener('change', () => {
  const unit = state.unitPresets.find((u) => u.id === addUnitSelect.value);
  addUnitSelect.value = '';
  if (!unit) return;
  const loaded = materialiseRows(unit.rows, state.library, unit.name);
  setRows([...state.rows, ...loaded.rows], loaded.library);
  onInputsChanged();
});

$('open-units').addEventListener('click', async () => {
  await openUnitModal({
    library: state.library,
    rows: state.rows,
    units: state.unitPresets,
    onUnitsChange: () => {
      renderAddUnitSelect();
      saveState(state);
    },
    onLibraryChange: onLibraryChanged,
  });
  renderAddUnitSelect();
});

$('open-library').addEventListener('click', () =>
  openLibraryModal({ library: state.library, rows: state.rows, onChange: onLibraryChanged }),
);

// ---------- Import / export ----------

$('open-export').addEventListener('click', () => openExportModal(state));

$('open-import').addEventListener('click', () =>
  openImportModal({
    state,
    onImported: () => {
      // Weapons may have been added or replaced, presets added or overwritten.
      renderAddUnitSelect();
      onLibraryChanged();
    },
  }),
);

// ---------- Run bar ----------

iterationsInput.value = String(state.iterations);
iterationsInput.addEventListener('input', () => {
  state.iterations = numberValue(iterationsInput);
  setFieldError(iterationsInput, validateIterations(state.iterations));
  onInputsChanged();
});

$('add-weapon').addEventListener('click', () => attackList.add());

optimiseButton.addEventListener('click', () => {
  if (!lastOptimise) return;
  const { bestOrder, beneficial, gain } = lastOptimise;
  const changed = bestOrder.some((v, i) => v !== i);
  reorderNote = beneficial ? `Reordered: +${gain.toFixed(2)} models destroyed on average.` : '';
  reordering = true;
  if (changed) attackList.reorder(bestOrder);
  reordering = false;
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSimulation();
});

renderAddUnitSelect();
onInputsChanged();
