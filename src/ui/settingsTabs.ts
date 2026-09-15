/**
 * The settings tab strip, split out of `SettingsTab.ts` so it can be
 * tested.
 *
 * `SettingsTab.ts` imports `"obsidian"`, and the test stub's `new Setting()`
 * throws on purpose (`tests/helpers/obsidian-stub.ts`: reproducing Obsidian's
 * setting subtree from memory would make every assertion against it
 * worthless). So nothing that calls `display()` can be driven under Vitest —
 * which is why the strip lives here instead, with no `"obsidian"` import and
 * no Obsidian DOM helpers. It builds its elements through the plain DOM API,
 * which the real app and jsdom both provide, so the pattern below is
 * exercised rather than described.
 *
 * **What the external review found here.** The first version of this strip
 * had `role="tab"` and `aria-selected` and nothing else, which is worse than
 * having neither: the roles promise a widget that answers arrow keys and
 * exposes a panel, and a user who takes the promise finds a dead end. Both
 * halves of the WAI-ARIA tabs pattern are implemented below — the roving
 * tabindex and arrow keys here, the focus restore in `activateTab`.
 */

/** One tab. `id` is the caller's, and is what comes back on activation. */
export interface TabDescriptor {
  readonly id: string;
  readonly label: string;
}

interface TabStripSpec {
  readonly tabs: readonly TabDescriptor[];
  /** Which tab is selected. Must be one of `tabs`. */
  readonly activeId: string;
  /**
   * The tablist's accessible name. A tablist with no name is announced as an
   * unlabelled group of tabs, which tells a screen-reader user what the
   * control is but not what it switches.
   */
  readonly label: string;
  /**
   * Namespaces the generated element ids, so a second strip in the same
   * document could never collide with this one's `aria-controls` target.
   */
  readonly idPrefix: string;
  /** Activation is the caller's business: it owns the state and the redraw. */
  onActivate(id: string): void;
}

interface TabStripResult {
  /** The `role="tablist"` element. */
  readonly strip: HTMLElement;
  /**
   * The control for the selected tab. The caller keeps this so it can put
   * focus back after the redraw that activation triggers.
   */
  readonly activeEl: HTMLElement;
  /**
   * The `role="tabpanel"` the selected tab controls. The caller renders the
   * tab's content into this, not into `containerEl` — the panel is what
   * `aria-controls` points at, so it has to be the element the content is in.
   */
  readonly panelEl: HTMLElement;
}

/**
 * Which tab a keystroke moves to, or `null` for a key the strip does not own.
 *
 * Left/Right wrap, and Home/End jump to the ends, as the WAI-ARIA tabs
 * pattern specifies for a horizontal tablist. Up/Down are deliberately NOT
 * claimed: they belong to a vertical tablist, and swallowing them here would
 * break scrolling the settings pane from a focused tab.
 */
export function tabForKey(key: string, current: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowRight":
      return (current + 1) % count;
    case "ArrowLeft":
      return (current - 1 + count) % count;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * Draws the strip and its panel, and returns the parts the caller needs.
 *
 * Real `<button>`s rather than styled divs, so they are reachable and
 * operable from the keyboard for free, with `aria-selected` carrying the
 * state a sighted user reads from the underline.
 */
export function renderTabStrip(containerEl: HTMLElement, spec: TabStripSpec): TabStripResult {
  const doc = containerEl.ownerDocument;
  const panelId = `${spec.idPrefix}-panel-${spec.activeId}`;

  const strip = doc.win.createDiv();
  strip.className = "spaces-tabs";
  strip.setAttribute("role", "tablist");
  strip.setAttribute("aria-label", spec.label);
  containerEl.appendChild(strip);

  let activeEl: HTMLElement | null = null;

  spec.tabs.forEach((tab, index) => {
    const active = tab.id === spec.activeId;
    const btn = doc.win.createEl("button");
    btn.id = `${spec.idPrefix}-tab-${tab.id}`;
    btn.className = active ? "spaces-tab is-active" : "spaces-tab";
    btn.textContent = tab.label;
    btn.setAttribute("role", "tab");
    btn.setAttribute("aria-selected", active ? "true" : "false");
    // The roving tabindex: Tab reaches the strip once and lands on the
    // selected tab, and the arrow keys move within it. Without this, Tab
    // stops on every tab in turn, which is the browser default for buttons
    // and the wrong model for a tablist.
    btn.tabIndex = active ? 0 : -1;
    // Only the selected tab gets `aria-controls`, because only its panel is
    // in the document — the others are not rendered at all, and pointing at
    // an id that does not exist is a worse answer than not pointing.
    if (active) btn.setAttribute("aria-controls", panelId);

    btn.addEventListener("click", () => {
      spec.onActivate(tab.id);
    });

    btn.addEventListener("keydown", (ev) => {
      const target = tabForKey(ev.key, index, spec.tabs.length);
      if (target === null) return;
      // Claimed, so Home/End do not also scroll the settings pane out from
      // under the tab that just took focus.
      ev.preventDefault();
      const next = spec.tabs[target];
      if (!next || next.id === spec.activeId) {
        // End on the last tab, Home on the first: nothing to activate, and a
        // redraw would rebuild every control for no change. Focus is already
        // here; keep it here rather than doing nothing at all, so the key is
        // not silently swallowed.
        btn.focus();
        return;
      }
      spec.onActivate(next.id);
    });

    strip.appendChild(btn);
    if (active) activeEl = btn;
  });

  // The caller guarantees `activeId` names one of `tabs`; a strip with no
  // selected tab would be a programming error, not a state to render.
  if (!activeEl) throw new Error(`spaces: no tab matches "${spec.activeId}"`);
  const selected: HTMLElement = activeEl;

  const panelEl = doc.win.createDiv();
  panelEl.id = panelId;
  panelEl.setAttribute("role", "tabpanel");
  // Named by its own tab, so a screen reader entering the panel says which
  // one it belongs to without the user having to go back up to the strip.
  panelEl.setAttribute("aria-labelledby", selected.id);
  containerEl.appendChild(panelEl);

  return { strip, activeEl: selected, panelEl };
}

/**
 * What a tab switch has to do, in order, expressed against the pane rather
 * than against Obsidian.
 *
 * The order is the whole content of `activateTab`, and each step's position
 * is load-bearing — see the comments there.
 */
export interface TabPaneHost {
  /**
   * Persist anything a control is holding that only `blur` would have
   * written.
   */
  flushEdits(): void;
  /** Record which tab is now selected. Read by the next `render()`. */
  setActiveTab(id: string): void;
  /** Redraw the pane for the currently-selected tab. */
  render(): void;
  /** Put focus on the tab control the redraw has just built. */
  focusActiveTab(): void;
}

/**
 * Switch to `next`, or do nothing if it is already selected.
 *
 * Re-selecting the open tab is deliberately inert: `render()` would rebuild
 * every control under the user's cursor for no change at all.
 *
 * The three steps around `render()` are each there for a measured reason.
 *
 * **`flushEdits()` first.** A tab switch empties `containerEl` exactly as
 * `hide()` does, and removing a focused element does NOT fire `blur` (the
 * HTML standard's focus fixup; run in `tests/settingsBlurFlush.test.ts`). So
 * an edit typed into the Ignored-paths box and then abandoned by clicking
 * "Spaces" went nowhere. It must run BEFORE the redraw, because `display()`
 * clears the ledger — flushing afterwards would flush an empty one.
 *
 * **`focusActiveTab()` last.** `render()` destroys the button the click or
 * the arrow key landed on, and focus falls to `BODY` silently — a keyboard
 * user is dumped at the top of the document, with no way back to the strip
 * except Tab-ing through the whole page. It must run AFTER the redraw,
 * because the element to focus does not exist until then.
 */
export function activateTab(host: TabPaneHost, current: string, next: string): void {
  if (next === current) return;
  host.flushEdits();
  host.setActiveTab(next);
  host.render();
  host.focusActiveTab();
}
