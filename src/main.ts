import './style.css';
import { optimiseOrder, type OptimiseResult } from './engine/optimise';
import { simulate } from './engine/simulate';
import { uid } from './state/ids';
import { copyDefender, copyRows, resolveRows, sameDefender, sameRows, sortedLibrary, uniqueName } from './state/presets';
import { loadState, saveState } from './state/storage';
import type { Profile } from './types';
import { renderAttackConditions } from './ui/conditionsForm';
import { renderDefenderForm } from './ui/defenderForm';
import { field, h, numberValue, setFieldError } from './ui/dom';
import { Drawer } from './ui/drawer';
import { PresetBar } from './ui/presetBar';
import { ProfileRows } from './ui/profileRows';
import { createResultsView } from './ui/results';
import { openExportModal, openImportModal } from './ui/shareModal';
import { hasErrors, validateDefender, validateIterations, validateRow } from './ui/validation';
import { WeaponsPanel } from './ui/weaponsPanel';

const OPTIMISE_DEBOUNCE_MS = 200;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** All app state. Arrays are mutated in place: the views hold references to them. */
const state = loadState();
const form = $<HTMLFormElement>('calculator');
const addWeapon = $<HTMLSelectElement>('add-weapon');
const addWeaponHint = $<HTMLParagraphElement>('add-weapon-hint');
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

/** The working area: the rows on the main page, which the simulation fires. */
const rows = () => state.rows;

/** The profile the working area was loaded from or saved to, if any. */
function activeProfile(): Profile | undefined {
  return state.profiles.find((p) => p.id === state.activeProfileId);
}

function rowsValid(): boolean {
  return rows().length > 0 && rows().every((r) => !hasErrors(validateRow(r)));
}

function inputsValid(): boolean {
  return rowsValid() && !hasErrors(validateDefender(state.defender)) && validateIterations(state.iterations) === undefined;
}

/** Why Simulate is disabled, or '' when it isn't. */
function blockedReason(): string {
  if (rows().length === 0) return 'Add weapons to simulate.';
  if (!rowsValid()) return 'Fix the highlighted rows to simulate.';
  if (hasErrors(validateDefender(state.defender))) return 'Fix the highlighted defender fields to simulate.';
  if (validateIterations(state.iterations) !== undefined) return 'Set a valid number of iterations under ☰ → Settings to simulate.';
  return '';
}

/** Anything that feeds the simulation changed: save, refresh the views and re-run the optimiser. */
function onInputsChanged(): void {
  saveState(state);
  // The Blast / Cleave extra attacks on the A chips depend on the defender's model count,
  // the Anti markers on its keywords, Rapid Fire, Melta and Lance on the attack conditions.
  profileRows.refreshStats();
  if (!reordering) reorderNote = '';
  const reason = blockedReason();
  simulateButton.disabled = reason !== '';
  runStatus.textContent = reason;
  if (hasResults) results.markStale(true);
  profileBar.refresh();
  defenderBar.refresh();
  scheduleOptimise();
}

/**
 * A library profile was created, edited or deleted. Rows and profiles hold their own copies,
 * so only the views listing the library change.
 */
function onLibraryChanged(): void {
  saveState(state);
  renderAddWeapon();
  weaponsPanel.render();
}

// ---------- Add weapon ----------

function renderAddWeapon(): void {
  const library = sortedLibrary(state.library);
  addWeapon.replaceChildren(h('option', { value: '' }, 'Add weapon…'), ...library.map((w) => h('option', { value: w.id }, w.name)));
  addWeapon.value = '';
  addWeapon.disabled = library.length === 0;
  addWeaponHint.hidden = library.length > 0;
}

addWeapon.addEventListener('change', () => {
  const weapon = state.library.find((w) => w.id === addWeapon.value);
  addWeapon.value = '';
  if (weapon) profileRows.add(weapon);
});

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
  // Resolved index i is row i.
  lastOptimise = optimiseOrder(resolveRows(rows(), state.conditions), state.defender);
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
  } else {
    const verdict = result.method === 'greedy' ? 'No better order found (greedy search).' : 'Current order is already the best.';
    optimiseStatus.textContent = reorderNote ? `${reorderNote} ${verdict}` : verdict;
    reorderNote = '';
    optimiseButton.title = 'Reordering would not destroy more models on average.';
  }
}

function rowLabel(index: number): string {
  const row = rows()[index];
  return row ? `${row.models}× ${row.weapon.name}` : `Weapon ${index + 1}`;
}

function applyBestOrder(): void {
  if (!lastOptimise) return;
  const { bestOrder, beneficial, gain } = lastOptimise;
  const changed = bestOrder.some((v, i) => v !== i);
  reorderNote = beneficial ? `Reordered: +${gain.toFixed(2)} models destroyed on average.` : '';
  reordering = true;
  if (changed) profileRows.reorder(bestOrder);
  reordering = false;
}

optimiseButton.addEventListener('click', applyBestOrder);

// ---------- Simulation ----------

function runSimulation(): void {
  if (!inputsValid()) return;
  simulateButton.disabled = true;
  runStatus.textContent = 'Simulating…';
  // Let the status paint before the (synchronous) simulation blocks the thread.
  window.setTimeout(() => {
    const weapons = resolveRows(rows(), state.conditions);
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

// ---------- Attacker ----------

const profileRows = new ProfileRows($('profile-rows'), state.rows, {
  onChange: onInputsChanged,
  defender: () => state.defender,
  conditions: () => state.conditions,
  focusWhenEmpty: () => (addWeapon.disabled ? profileBar.element.querySelector('select') : addWeapon)?.focus(),
});
// Situational: saved with the page state, but not part of profiles or exports.
renderAttackConditions($('attack-conditions'), state.conditions, onInputsChanged);

const profileBar = new PresetBar({
  label: 'Profile',
  idPrefix: 'profile',
  noun: 'profile',
  markModified: false,
  deleteNote: 'The weapons on the page stay as they are.',
  items: () => state.profiles,
  activeId: () => state.activeProfileId,
  isDirty: () => {
    const profile = activeProfile();
    return profile !== undefined && !sameRows(state.rows, profile.rows);
  },
  // Unsaved rows that no profile holds would be lost by loading one.
  hasUnsavedWork: () => state.rows.length > 0 && !state.profiles.some((p) => sameRows(p.rows, state.rows)),
  saveBlockedReason: () => {
    if (rows().length === 0) return 'Add weapons first';
    return rowsValid() ? null : 'Fix the highlighted rows first';
  },
  onLoad: (id) => {
    state.activeProfileId = id;
    const profile = activeProfile();
    if (profile) {
      state.rows.splice(0, state.rows.length, ...copyRows(profile.rows));
      profileRows.render();
    }
    onInputsChanged();
  },
  onSave: (id) => {
    const profile = state.profiles.find((p) => p.id === id);
    if (!profile) return;
    profile.rows = copyRows(state.rows);
    state.activeProfileId = id;
    onInputsChanged();
  },
  onSaveAs: (name) => {
    const profile: Profile = { id: uid('profile'), name, rows: copyRows(state.rows) };
    state.profiles.push(profile);
    state.activeProfileId = profile.id;
    onInputsChanged();
  },
  onRename: (id, name) => {
    const profile = state.profiles.find((p) => p.id === id);
    if (!profile) return;
    profile.name = uniqueName(
      state.profiles.filter((p) => p !== profile).map((p) => p.name),
      name,
    );
    onInputsChanged();
  },
  onDelete: (id) => {
    state.profiles.splice(
      state.profiles.findIndex((p) => p.id === id),
      1,
    );
    if (state.activeProfileId === id) state.activeProfileId = null;
    onInputsChanged();
  },
});
$('profile-bar').append(profileBar.element);

// ---------- Defender ----------

const defenderForm = renderDefenderForm($('defender'), state.defender, onInputsChanged);

const defenderBar = new PresetBar({
  label: 'Defender preset',
  idPrefix: 'defender-preset',
  items: () => state.defenderPresets,
  activeId: () => state.activeDefenderPresetId,
  isDirty: () => {
    const preset = state.defenderPresets.find((p) => p.id === state.activeDefenderPresetId);
    return preset !== undefined && !sameDefender(state.defender, preset.defender);
  },
  saveBlockedReason: () => (hasErrors(validateDefender(state.defender)) ? 'Fix the highlighted fields first' : null),
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

const weaponsPanel = new WeaponsPanel({ library: state.library, onChange: onLibraryChanged });

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
        // Weapons, profiles and defender presets may have been added or replaced. The working
        // area is not touched; a replaced active profile may now differ from it.
        onLibraryChanged();
        onInputsChanged();
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
      h('p', { class: 'panel-hint' }, 'Share profiles, defender presets and weapon profiles with another browser or device as a JSON file.'),
      h('div', { class: 'panel-actions-group' }, importButton, exportButton),
    ),
  );
}

const drawer = new Drawer([
  { tab: 'weapons', label: 'Weapons', content: weaponsPanel.element, onShow: () => weaponsPanel.render() },
  { tab: 'settings', label: 'Settings', content: settingsPanel() },
]);

$('open-config').addEventListener('click', () => drawer.open());

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSimulation();
});

renderAddWeapon();
onInputsChanged();
