import './style.css';
import { optimiseOrder, type OptimiseResult } from './engine/optimise';
import { simulate } from './engine/simulate';
import type { DefenderProfile, WeaponProfile } from './types';
import { renderDefenderForm } from './ui/defenderForm';
import { numberValue, setFieldError } from './ui/dom';
import { createResultsView } from './ui/results';
import { hasErrors, validateDefender, validateIterations, validateWeapon } from './ui/validation';
import { WeaponList, newWeapon } from './ui/weaponList';

interface AppState {
  weapons: WeaponProfile[];
  defender: DefenderProfile;
  iterations: number;
}

const STORAGE_KEY = 'damage-calculator:v1';
const OPTIMISE_DEBOUNCE_MS = 200;

function defaultState(): AppState {
  return {
    weapons: [newWeapon({ name: 'Bolt rifles', models: 10, attacks: '2', skill: 3, strength: 4, ap: -1, damage: '1' })],
    defender: { models: 10, toughness: 4, save: 3, invuln: null, wounds: 2 },
    iterations: 10_000,
  };
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    const parsed = JSON.parse(raw) as AppState;
    if (!Array.isArray(parsed.weapons) || parsed.weapons.length === 0 || !parsed.defender) return defaultState();
    return {
      weapons: parsed.weapons.map((w) => newWeapon(w)),
      defender: { ...defaultState().defender, ...parsed.defender },
      iterations: Number.isFinite(parsed.iterations) ? parsed.iterations : 10_000,
    };
  } catch {
    return defaultState();
  }
}

function saveState(state: AppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Storage unavailable (private mode, blocked): the app works without it.
  }
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const state = loadState();
const form = $<HTMLFormElement>('calculator');
const iterationsInput = $<HTMLInputElement>('iterations');
const simulateButton = $<HTMLButtonElement>('simulate');
const runStatus = $<HTMLParagraphElement>('run-status');
const optimiseButton = $<HTMLButtonElement>('optimise');
const optimiseBadge = $<HTMLSpanElement>('optimise-badge');
const optimiseStatus = $<HTMLParagraphElement>('optimise-status');
const results = createResultsView($('results'));

let hasResults = false;
let optimiseTimer: number | undefined;
let lastOptimise: OptimiseResult | null = null;
let reorderNote = '';
let reordering = false;

function inputsValid(): boolean {
  return (
    state.weapons.every((w) => !hasErrors(validateWeapon(w))) &&
    !hasErrors(validateDefender(state.defender)) &&
    validateIterations(state.iterations) === undefined
  );
}

function onInputsChanged(): void {
  saveState(state);
  if (!reordering) reorderNote = '';
  simulateButton.disabled = !inputsValid();
  runStatus.textContent = simulateButton.disabled ? 'Fix the highlighted fields to simulate.' : '';
  if (hasResults) results.markStale(true);
  scheduleOptimise();
}

function scheduleOptimise(): void {
  window.clearTimeout(optimiseTimer);
  lastOptimise = null;
  setOptimiseState('pending');
  optimiseTimer = window.setTimeout(runOptimise, OPTIMISE_DEBOUNCE_MS);
}

function runOptimise(): void {
  if (state.weapons.length < 2) return setOptimiseState('single');
  if (!inputsValid()) return setOptimiseState('invalid');
  lastOptimise = optimiseOrder(state.weapons, state.defender);
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
    const order = result.bestOrder.map((i) => state.weapons[i].name || `Weapon ${i + 1}`).join(' → ');
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

function runSimulation(): void {
  if (!inputsValid()) return;
  simulateButton.disabled = true;
  runStatus.textContent = 'Simulating…';
  // Let the status paint before the (synchronous) simulation blocks the thread.
  window.setTimeout(() => {
    const started = performance.now();
    const result = simulate(state.weapons, state.defender, state.iterations);
    const ms = Math.round(performance.now() - started);
    results.show(result, state.defender.models, state.defender.wounds);
    hasResults = true;
    simulateButton.disabled = false;
    runStatus.textContent = `${state.iterations.toLocaleString()} runs in ${ms.toLocaleString()} ms.`;
  }, 20);
}

const weaponList = new WeaponList($('weapons'), state.weapons, onInputsChanged);
renderDefenderForm($('defender'), state.defender, onInputsChanged);

iterationsInput.value = String(state.iterations);
iterationsInput.addEventListener('input', () => {
  state.iterations = numberValue(iterationsInput);
  setFieldError(iterationsInput, validateIterations(state.iterations));
  onInputsChanged();
});

$('add-weapon').addEventListener('click', () => weaponList.add());

optimiseButton.addEventListener('click', () => {
  if (!lastOptimise) return;
  const { bestOrder, beneficial, gain } = lastOptimise;
  const changed = bestOrder.some((v, i) => v !== i);
  reorderNote = beneficial ? `Reordered: +${gain.toFixed(2)} models destroyed on average.` : '';
  reordering = true;
  if (changed) weaponList.reorder(bestOrder);
  reordering = false;
});

form.addEventListener('submit', (event) => {
  event.preventDefault();
  runSimulation();
});

onInputsChanged();
