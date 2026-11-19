import { h } from './dom';

let dialogCounter = 0;

export interface ModalOptions<T> {
  title: string;
  /** Value the promise resolves with on Esc, backdrop click or the ✕ button. */
  cancelValue: T;
  /** Extra class on the <dialog>, e.g. 'modal--wide'. */
  className?: string;
  /** Build the body. Call `close(value)` to resolve and close. */
  content: (close: (value: T) => void, dialog: HTMLDialogElement) => Node | Node[];
  /** Element to focus once open; defaults to the first focusable control in the body. */
  initialFocus?: () => HTMLElement | null | undefined;
}

/**
 * Open a native modal <dialog>. Resolves once it closes. Esc, a backdrop click and the
 * ✕ button resolve with `cancelValue`. The dialog is removed from the DOM on close and
 * focus returns to the element that had it before.
 */
export function openModal<T>(options: ModalOptions<T>): Promise<T> {
  return new Promise<T>((resolve) => {
    dialogCounter += 1;
    const titleId = `modal-title-${dialogCounter}`;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = h('dialog', { class: `modal ${options.className ?? ''}`.trim(), 'aria-labelledby': titleId });
    let settled = false;

    const close = (value: T) => {
      if (settled) return;
      settled = true;
      dialog.close();
      dialog.remove();
      if (previousFocus?.isConnected) previousFocus.focus();
      resolve(value);
    };

    const closeButton = h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close', title: 'Close' }, '✕');
    closeButton.addEventListener('click', () => close(options.cancelValue));

    const body = options.content(close, dialog);
    const inner = h(
      'div',
      { class: 'modal-inner' },
      h('div', { class: 'modal-head' }, h('h2', { id: titleId }, options.title), closeButton),
      ...(Array.isArray(body) ? body : [body]),
    );
    dialog.append(inner);

    // Esc fires 'cancel'; keep the close in our hands so the promise resolves.
    dialog.addEventListener('cancel', (event) => {
      event.preventDefault();
      close(options.cancelValue);
    });
    // The inner wrapper fills the dialog, so a click whose target is the dialog itself
    // landed on the backdrop. Require the press to start there too, so a text selection
    // dragged out of an input doesn't close the dialog.
    let pressedBackdrop = false;
    dialog.addEventListener('pointerdown', (event) => (pressedBackdrop = event.target === dialog));
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog && pressedBackdrop) close(options.cancelValue);
    });

    document.body.append(dialog);
    dialog.showModal();
    const focusTarget =
      options.initialFocus?.() ??
      inner.querySelector<HTMLElement>('.modal-body input, .modal-body select, .modal-body button:not([disabled]), .modal-actions button:not([disabled])');
    focusTarget?.focus();
  });
}

/** Yes / no confirmation. Resolves true when confirmed. */
export function confirmDialog(text: string, { confirmLabel = 'OK', danger = false, title = 'Are you sure?' } = {}): Promise<boolean> {
  let confirmButton: HTMLButtonElement | undefined;
  return openModal<boolean>({
    title,
    cancelValue: false,
    className: 'modal--small',
    initialFocus: () => confirmButton,
    content: (close) => {
      const cancel = h('button', { type: 'button', class: 'button secondary' }, 'Cancel');
      confirmButton = h('button', { type: 'button', class: `button ${danger ? 'danger' : 'primary'}` }, confirmLabel);
      cancel.addEventListener('click', () => close(false));
      confirmButton.addEventListener('click', () => close(true));
      return [h('p', { class: 'modal-text' }, text), h('div', { class: 'modal-actions' }, cancel, confirmButton)];
    },
  });
}

export const MAX_PRESET_NAME = 40;

/** Ask for a name. Resolves the trimmed name, or null when cancelled. */
export function promptName(title: string, initial = '', { label = 'Name', confirmLabel = 'Save' } = {}): Promise<string | null> {
  let input: HTMLInputElement | undefined;
  return openModal<string | null>({
    title,
    cancelValue: null,
    className: 'modal--small',
    initialFocus: () => input,
    content: (close) => {
      dialogCounter += 1;
      const id = `prompt-name-${dialogCounter}`;
      const nameInput = h('input', { id, type: 'text', value: initial, autocomplete: 'off', maxlength: MAX_PRESET_NAME, required: true });
      input = nameInput;
      const cancel = h('button', { type: 'button', class: 'button secondary' }, 'Cancel');
      const save = h('button', { type: 'submit', class: 'button primary' }, confirmLabel);
      const sync = () => (save.disabled = nameInput.value.trim() === '');
      nameInput.addEventListener('input', sync);
      sync();
      cancel.addEventListener('click', () => close(null));
      const form = h(
        'form',
        { class: 'modal-body', novalidate: true },
        h('div', { class: 'field' }, h('label', { for: id }, label), nameInput),
        h('div', { class: 'modal-actions' }, cancel, save),
      );
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const name = nameInput.value.trim();
        if (name) close(name);
      });
      queueMicrotask(() => nameInput.select());
      return form;
    },
  });
}
