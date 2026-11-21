import { h } from './dom';

export type DrawerTab = 'weapons' | 'settings';

export interface DrawerPanel {
  tab: DrawerTab;
  label: string;
  /** The tab's content; it stays in the DOM while the drawer is closed or another tab shows. */
  content: HTMLElement;
  /** Called when the tab is shown (opened on it or switched to), e.g. to refresh a list. */
  onShow?: () => void;
}

/**
 * The configuration drawer: a modal <dialog> that slides in from the right, with a tab per
 * panel. It is created once and kept, so each tab keeps its state between openings.
 * showModal() gives the focus trap and Esc; a backdrop click closes it too. Dialogs opened
 * from inside it (weapon profile, confirmations) stack on top. Focus returns to the element
 * that opened it.
 */
export class Drawer {
  readonly dialog: HTMLDialogElement;
  private readonly tabs = new Map<DrawerTab, HTMLButtonElement>();
  private readonly panels = new Map<DrawerTab, HTMLElement>();
  private current: DrawerTab;
  private opener: HTMLElement | null = null;

  constructor(private readonly config: DrawerPanel[]) {
    this.current = config[0].tab;
    const titleId = 'drawer-title';
    const close = h('button', { type: 'button', class: 'icon-button', 'aria-label': 'Close configuration', title: 'Close' }, '✕');
    close.addEventListener('click', () => this.close());

    const tablist = h('div', { class: 'tabs', role: 'tablist', 'aria-label': 'Configuration sections' });
    const panelHost = h('div', { class: 'drawer-panels' });
    for (const { tab, label, content } of config) {
      const tabId = `drawer-tab-${tab}`;
      const panelId = `drawer-panel-${tab}`;
      const button = h('button', { type: 'button', role: 'tab', id: tabId, class: 'tab', 'aria-controls': panelId, 'aria-selected': 'false', tabindex: -1 }, label);
      button.addEventListener('click', () => this.show(tab));
      const panel = h('div', { role: 'tabpanel', id: panelId, class: 'drawer-panel', 'aria-labelledby': tabId, hidden: true }, content);
      this.tabs.set(tab, button);
      this.panels.set(tab, panel);
      tablist.append(button);
      panelHost.append(panel);
    }
    tablist.addEventListener('keydown', (event) => this.onTabKeydown(event));

    this.dialog = h(
      'dialog',
      { class: 'drawer', 'aria-labelledby': titleId },
      h(
        'div',
        { class: 'drawer-inner' },
        h('div', { class: 'drawer-head' }, h('h2', { id: titleId }, 'Configuration'), close),
        tablist,
        panelHost,
      ),
    );

    // Same as ui/modal.ts: a click whose press started on the backdrop closes the drawer.
    let pressedBackdrop = false;
    this.dialog.addEventListener('pointerdown', (event) => (pressedBackdrop = event.target === this.dialog));
    this.dialog.addEventListener('click', (event) => {
      if (event.target === this.dialog && pressedBackdrop) this.close();
    });
    // Esc closes the dialog natively; restore focus whichever way it closed.
    this.dialog.addEventListener('close', () => {
      if (this.opener?.isConnected) this.opener.focus();
      this.opener = null;
    });
    document.body.append(this.dialog);
    this.select(this.current);
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  /** Open on `tab`, or on the tab shown last. */
  open(tab: DrawerTab = this.current): void {
    if (!this.dialog.open) {
      this.opener = document.activeElement as HTMLElement | null;
      this.dialog.showModal();
    }
    this.show(tab);
    this.tabs.get(tab)?.focus();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  /** Switch to `tab` and run its onShow. */
  show(tab: DrawerTab): void {
    this.select(tab);
    this.config.find((p) => p.tab === tab)?.onShow?.();
  }

  private select(tab: DrawerTab): void {
    this.current = tab;
    for (const [key, button] of this.tabs) {
      const selected = key === tab;
      button.setAttribute('aria-selected', String(selected));
      button.tabIndex = selected ? 0 : -1;
      this.panels.get(key)!.hidden = !selected;
    }
  }

  /** Arrow keys, Home and End move between the tabs and show them (automatic activation). */
  private onTabKeydown(event: KeyboardEvent): void {
    const order = this.config.map((p) => p.tab);
    const index = order.indexOf(this.current);
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % order.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + order.length) % order.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    else return;
    event.preventDefault();
    this.show(order[next]);
    this.tabs.get(order[next])?.focus();
  }
}
