import { h } from './dom';

export interface MenuItem {
  label: string;
  /** Red text, for destructive actions. */
  danger?: boolean;
  /** Checked when the menu opens: a reason (shown as the tooltip) disables the item. */
  disabledReason?: () => string | null;
  onSelect: () => void;
}

export interface MenuOptions {
  /** Accessible name of the ⋯ button, e.g. "Profile actions". */
  label: string;
  items: MenuItem[];
}

let menuCounter = 0;

/**
 * A ⋯ button that opens a small menu of actions. Arrow keys, Home and End move between the
 * items, Enter / Space picks one, Esc and Tab close the menu (Esc without closing a dialog
 * around it), and so does a click outside. Disabled items stay focusable so their reason
 * can be read, but do nothing.
 */
export class Menu {
  readonly element: HTMLDivElement;
  readonly button: HTMLButtonElement;
  private readonly menu: HTMLDivElement;
  private buttons: HTMLButtonElement[] = [];

  constructor(private readonly options: MenuOptions) {
    menuCounter += 1;
    const menuId = `menu-${menuCounter}`;
    this.button = h(
      'button',
      { type: 'button', class: 'icon-button menu-button', 'aria-label': options.label, title: options.label, 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-controls': menuId },
      '⋯',
    );
    this.menu = h('div', { class: 'menu', id: menuId, role: 'menu', 'aria-label': options.label, hidden: true });
    this.element = h('div', { class: 'menu-host' }, this.button, this.menu);

    this.button.addEventListener('click', () => (this.isOpen ? this.close(true) : this.open(0)));
    this.button.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        this.open(event.key === 'ArrowDown' ? 0 : -1);
      }
    });
    this.menu.addEventListener('keydown', (event) => this.onKeydown(event));
    this.menu.addEventListener('focusout', (event) => {
      // Tab (or a click elsewhere) moved focus out of the menu.
      if (this.isOpen && !this.element.contains(event.relatedTarget as Node | null)) this.close(false);
    });
  }

  get isOpen(): boolean {
    return !this.menu.hidden;
  }

  /** Open with focus on item `index` (-1 = last). */
  open(index: number): void {
    this.buttons = this.options.items.map((item) => {
      const reason = item.disabledReason?.() ?? null;
      const el = h(
        'button',
        { type: 'button', role: 'menuitem', tabindex: -1, class: `menu-item${item.danger ? ' menu-item--danger' : ''}`, 'aria-disabled': reason ? 'true' : undefined, title: reason ?? undefined },
        item.label,
      );
      el.addEventListener('click', () => {
        if (reason) return;
        this.close(true);
        item.onSelect();
      });
      return el;
    });
    this.menu.replaceChildren(...this.buttons);
    this.menu.hidden = false;
    this.button.setAttribute('aria-expanded', 'true');
    document.addEventListener('pointerdown', this.onPointerDown, true);
    this.focusItem(index < 0 ? this.buttons.length - 1 : index);
  }

  close(focusButton: boolean): void {
    if (!this.isOpen) return;
    this.menu.hidden = true;
    this.button.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', this.onPointerDown, true);
    if (focusButton) this.button.focus();
  }

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (!this.element.contains(event.target as Node)) this.close(false);
  };

  private focusItem(index: number): void {
    const count = this.buttons.length;
    this.buttons[((index % count) + count) % count]?.focus();
  }

  private onKeydown(event: KeyboardEvent): void {
    const current = this.buttons.indexOf(document.activeElement as HTMLButtonElement);
    switch (event.key) {
      case 'ArrowDown':
        this.focusItem(current + 1);
        break;
      case 'ArrowUp':
        this.focusItem(current - 1);
        break;
      case 'Home':
        this.focusItem(0);
        break;
      case 'End':
        this.focusItem(-1);
        break;
      case 'Escape':
        // Close only the menu, not the drawer or dialog it sits in.
        event.stopPropagation();
        this.close(true);
        break;
      case 'Tab':
        this.close(false);
        return;
      default:
        return;
    }
    event.preventDefault();
  }
}
