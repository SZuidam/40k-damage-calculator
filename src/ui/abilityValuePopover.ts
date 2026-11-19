import { h } from './dom';

export interface AbilityValuePopoverOptions {
  /** Positioned ancestor the panel is appended to (inside the weapon dialog, so it stays in its top layer). */
  container: HTMLElement;
  /** Control that opened the panel; it gets focus back on close. */
  anchor: HTMLElement;
  /** Element the panel is placed next to, when that isn't the anchor itself (a whole chip). */
  placeBy?: HTMLElement;
  /** "Blast X": the input's label and the panel's accessible name. */
  title: string;
  initial: string;
  /** Example shown in the empty input. Default "e.g. D6+2". */
  placeholder?: string;
  /** An error message for the typed value, or undefined when it is valid. */
  validate: (value: string) => string | undefined;
}

const GAP = 6;

let popoverCounter = 0;
/** Cancels the open pop-up, if any: only one is open at a time. */
let cancelOpen: (() => void) | null = null;

/**
 * Ask for the X of an ability (or Y of Anti-X Y+) in a small pop-up next to `anchor`. Resolves the typed
 * value once confirmed (OK / Enter), or null when cancelled (Cancel, Esc, a click outside).
 */
export function openAbilityValuePopover(options: AbilityValuePopoverOptions): Promise<string | null> {
  cancelOpen?.();
  const { container, anchor, title, initial, validate, placeBy = anchor, placeholder = 'e.g. D6+2' } = options;

  return new Promise<string | null>((resolve) => {
    popoverCounter += 1;
    const inputId = `ability-popover-${popoverCounter}-input`;
    const errorId = `ability-popover-${popoverCounter}-error`;

    const input = h('input', { id: inputId, type: 'text', value: initial, autocomplete: 'off', spellcheck: 'false', class: 'dice', placeholder });
    const error = h('p', { id: errorId, class: 'ability-popover-error', 'aria-live': 'polite' });
    const ok = h('button', { type: 'button', class: 'button primary' }, 'OK');
    const cancel = h('button', { type: 'button', class: 'button secondary' }, 'Cancel');
    const panel = h(
      'div',
      { class: 'ability-popover', role: 'dialog', 'aria-label': title },
      h('div', { class: 'field' }, h('label', { for: inputId }, title), input),
      error,
      h('div', { class: 'ability-popover-actions' }, cancel, ok),
    );

    // An empty new value isn't flagged until the user has typed something.
    let touched = initial.trim() !== '';
    const check = (): boolean => {
      const message = validate(input.value);
      const shown = touched ? message : undefined;
      // The error line always takes up its space (see .ability-popover-error), so the
      // panel keeps the size and place it opened with.
      error.textContent = shown ?? '';
      if (shown) {
        input.setAttribute('aria-invalid', 'true');
        input.setAttribute('aria-describedby', errorId);
      } else {
        input.removeAttribute('aria-invalid');
        input.removeAttribute('aria-describedby');
      }
      ok.disabled = message !== undefined;
      return message === undefined;
    };

    let settled = false;
    const close = (value: string | null) => {
      if (settled) return;
      settled = true;
      cancelOpen = null;
      document.removeEventListener('pointerdown', onPointerDown, true);
      panel.remove();
      if (anchor.isConnected) anchor.focus();
      resolve(value);
    };
    const confirm = () => {
      touched = true;
      if (check()) close(input.value);
    };

    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !panel.contains(event.target)) close(null);
    };

    input.addEventListener('input', () => {
      touched = true;
      check();
    });
    panel.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        // Keep the Esc from also closing the weapon dialog.
        event.preventDefault();
        event.stopPropagation();
        close(null);
      } else if (event.key === 'Enter' && event.target === input) {
        // Don't submit the weapon form.
        event.preventDefault();
        confirm();
      }
    });
    ok.addEventListener('click', confirm);
    cancel.addEventListener('click', () => close(null));

    container.append(panel);
    check();
    // Placed once: the panel stays where it opened while the user types.
    place(panel, placeBy, container);
    document.addEventListener('pointerdown', onPointerDown, true);
    cancelOpen = () => close(null);
    input.focus();
    input.select();
  });
}

/**
 * Put the panel to the right of `target` when it fits inside the container, otherwise (and
 * always on narrow screens) directly below it. When that would run past the bottom of the
 * dialog (or window), the panel moves up so it doesn't make the dialog scroll.
 */
function place(panel: HTMLElement, target: HTMLElement, container: HTMLElement): void {
  const box = container.getBoundingClientRect();
  const at = target.getBoundingClientRect();
  const width = panel.offsetWidth;
  const height = panel.offsetHeight;
  const narrow = window.matchMedia('(max-width: 480px)').matches;
  const bottomLimit = Math.min(container.closest('dialog')?.getBoundingClientRect().bottom ?? Infinity, window.innerHeight) - GAP;

  const right = at.right - box.left + GAP;
  if (!narrow && right + width <= container.clientWidth) {
    // Beside the target, slid up when needed (never above the top of the window).
    const top = Math.max(GAP, Math.min(at.top, bottomLimit - height));
    panel.style.left = `${right}px`;
    panel.style.top = `${top - box.top}px`;
    return;
  }
  // Below the target, or above it when there is no room below.
  const below = at.bottom + GAP;
  const top = below + height <= bottomLimit ? below : Math.max(GAP, at.top - GAP - height);
  const left = Math.max(0, Math.min(at.left - box.left, container.clientWidth - width));
  panel.style.left = `${left}px`;
  panel.style.top = `${top - box.top}px`;
}
