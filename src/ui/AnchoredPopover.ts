/**
 * A small popover anchored to a control, carrying one agreed set of dismissal
 * rules. Shared so a second picker cannot drift from the first.
 *
 * It lives on `body` with `position: fixed` rather than inside the pane,
 * because the sidebar clips its own overflow and these open above the bottom
 * switcher strip — precisely what would be cut off.
 *
 * It imports nothing from `"obsidian"`, so it can be exercised in jsdom.
 *
 * **It does not own its own lifetime.** The four document-level listeners in
 * `open()` are removed by `close()` and by nothing else, so every `open*`
 * helper hands the instance back and the view that opened it — `SwitcherView`,
 * `SpaceHeaderView` — keeps it in a field and closes it from `destroy()`,
 * which is already on `onunload`'s path. The listeners do not go through
 * `registerDomEvent` because neither view is a `Component` and this module
 * imports no Obsidian API by design; the guarantee is instead that `close()`
 * removes everything `open()` added and that an owner always calls it.
 */
interface PopoverOptions {
  anchor: HTMLElement;
  /** Goes on the root element, so each picker can style its own contents. */
  className: string;
  ariaLabel: string;
  /**
   * Which side of the anchor to prefer. Defaults to `"above"`, which is right
   * for the space strip: its pickers hang off a control at the BOTTOM of the
   * window, where below is off-screen.
   *
   * A control near the top of a pane wants the opposite — the create panel's
   * theme button sits ~150px down, and above put the popover between it and
   * the panel title, reading as though it belonged to something else. Either
   * way the other side is used as a fallback when the preferred one does not
   * fit, so this is a preference and never a guarantee.
   */
  placement?: "above" | "below";
  /** Fills the popover. Called once, on open. */
  build(root: HTMLElement, popover: AnchoredPopover): void;
  /**
   * Checked before an Escape keypress closes the popover.
   * Return `true` to let something INSIDE the popover handle that keypress
   * instead — an open `AbstractInputSuggest` dropdown, whose own dismissal
   * (Obsidian's `app.keymap` `Scope` system) is a separate keypress from the
   * one that should close this popover, mirroring the guard
   * `CreateSpacePanel.ts`'s `onDocKeydown` already uses for the same reason
   * (`isPopoverOpen`, not `defaultPrevented` — "there is no guarantee it
   * runs before this one or marks the event the same way").
   *
   * Optional, and checked ONLY here: every existing caller (`RenamePopover`,
   * `ColorPickerPopover`, `IconPickerPopover`, `SpaceSwitcherPopover`) omits
   * it, so `undefined` — treated as "never suppress" — preserves their
   * behaviour exactly.
   */
  suppressEscape?(): boolean;
  /**
   * Called exactly once, on every path that actually closes an OPEN popover
   * — Escape, an outside mousedown, a resize, an outside scroll, or an
   * explicit `close()` call — never on a `close()` that finds nothing open.
   * `build()`'s own
   * `AbstractInputSuggest` (or any other listener-owning thing it
   * constructs) has no other reliable moment to be told to tear itself down:
   * `AnchoredPopover` is the only thing that knows a dismissal has actually
   * happened on every one of those paths, not only the ones `build()`
   * itself triggers a `close()` from.
   */
  onClose?(): void;
}

export class AnchoredPopover {
  private el: HTMLElement | null = null;
  private doc: Document | null = null;

  constructor(private readonly opts: PopoverOptions) {}

  get isOpen(): boolean {
    return this.el !== null;
  }

  get root(): HTMLElement | null {
    return this.el;
  }

  open(): void {
    this.close();
    const doc = this.opts.anchor.ownerDocument;
    this.doc = doc;

    const el = doc.win.createDiv();
    el.className = this.opts.className;
    el.setAttribute("role", "dialog");
    el.setAttribute("aria-label", this.opts.ariaLabel);
    doc.body.appendChild(el);
    this.el = el;

    this.opts.build(el, this);
    this.reposition();

    doc.addEventListener("keydown", this.onKeydown, true);
    // `mousedown`, not `click`: a drag that starts inside and ends outside
    // would otherwise dismiss, and choosing something fires its own click.
    doc.addEventListener("mousedown", this.onDocMouseDown, true);
    doc.defaultView?.addEventListener("resize", this.onResize);
    doc.addEventListener("scroll", this.onOutsideScroll, true);
  }

  /**
   * Above the anchor, left-aligned, clamped into the viewport, falling below
   * only when there is no room above. Call again whenever the contents change
   * height, or a shorter list leaves the popover floating away from its anchor.
   */
  reposition(): void {
    const el = this.el;
    const view = this.doc?.defaultView;
    if (!el || !view) return;
    const a = this.opts.anchor.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const margin = 8;

    let left = a.left;
    const maxLeft = view.innerWidth - rect.width - margin;
    if (left > maxLeft) left = maxLeft;
    if (left < margin) left = margin;

    const above = a.top - rect.height - 6;
    const below = a.bottom + 6;
    const fitsAbove = above >= margin;
    const fitsBelow = below + rect.height <= view.innerHeight - margin;

    let top: number;
    if (this.opts.placement === "below") {
      // Preferred side first, the other as a fallback, and if neither fits,
      // clamp into view rather than hanging off an edge.
      top = fitsBelow ? below : fitsAbove ? above : margin;
    } else {
      top = fitsAbove ? above : Math.min(below, view.innerHeight - rect.height - margin);
    }

    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }

  private readonly onKeydown = (e: KeyboardEvent): void => {
    if (e.key !== "Escape") return;
    if (this.opts.suppressEscape?.()) return;
    e.preventDefault();
    this.close();
  };

  private readonly onDocMouseDown = (e: MouseEvent): void => {
    const t = e.target;
    if (t instanceof Node && this.el?.contains(t)) return;
    this.close();
  };

  private readonly onResize = (): void => this.close();

  /**
   * A scroll ELSEWHERE moves the anchor out from under a fixed element, so the
   * popover would point at nothing and closing beats drifting. A scroll INSIDE
   * is the user reading the contents — the listener is on the document in
   * capture, so without this check the popover dismissed itself the moment
   * anyone scrolled its own list.
   */
  private readonly onOutsideScroll = (e: Event): void => {
    const t = e.target;
    if (t instanceof Node && this.el?.contains(t)) return;
    this.close();
  };

  /**
   * Closes if the anchor has left the document, and does nothing otherwise.
   *
   * An anchor can be destroyed with no event a popover could listen for:
   * `SwitcherView.render()` and `SpaceHeaderView.render()` both rebuild their
   * row with `replaceChildren()`, and a space switch replaces the left split's
   * DOM wholesale. Left alone, the popover floats over a detached anchor and
   * the next `reposition()` measures an all-zero rect.
   *
   * `isConnected`, checked by the owner at the one moment it destroys the
   * anchor, rather than a `MutationObserver`: the observer would have to watch
   * `body`'s whole subtree for the life of every popover to learn what a
   * property read tells us for free, and it would answer a microtask late.
   */
  closeIfAnchorDetached(): void {
    if (!this.el) return;
    if (this.opts.anchor.isConnected) return;
    this.close();
  }

  /**
   * Idempotent, and scoped to this instance: it removes only the listeners
   * this popover added and only the element it created, so a stale reference
   * held by an owner after a self-dismissal is inert rather than destructive.
   */
  close(): void {
    const wasOpen = this.el !== null;
    const doc = this.doc;
    if (doc) {
      doc.removeEventListener("keydown", this.onKeydown, true);
      doc.removeEventListener("mousedown", this.onDocMouseDown, true);
      doc.defaultView?.removeEventListener("resize", this.onResize);
      doc.removeEventListener("scroll", this.onOutsideScroll, true);
    }
    this.el?.remove();
    this.el = null;
    this.doc = null;
    // Only on an actual open→closed transition — a `close()` on an already-
    // closed instance (harmless and common: `open()` calls it defensively,
    // and an owner's own teardown often calls it unconditionally) must not
    // ask `build()`'s cleanup to tear down something it already has.
    if (wasOpen) this.opts.onClose?.();
  }
}
