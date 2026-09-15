import { CLS_DROP_LINE, SEL } from "../explorer/selectors";
import { computeDrop, intentFor, movesIntoOwnSubtree, type DropEdge } from "./dropIntent";

/**
 * The drag half of ordering. Renders and dispatches; decides nothing —
 * every rule lives in `dropIntent.ts`, where it is tested. A reviewer finding a
 * decision in this file has found a real defect.
 *
 * It rides Obsidian's own HTML5 drag and NEVER `preventDefault`s a `dragstart`:
 * suppressing that breaks dragging a note into the editor to make a link, onto
 * a tab, and out to another application — the widest blast radius in this
 * feature, which is why the tests assert it directly. It also rides ON TOP of
 * Obsidian's own drag feedback rather than suppressing it: the tint says which
 * folder, our line says where within it. Clearing the native highlight at the
 * row EDGES only flashes it on and off as the pointer crosses bands within a
 * single row, so every `dragover` must propagate.
 *
 * **The phases are split, and deliberately.** `dragover` listens in the BUBBLE
 * phase so Obsidian's row handler — on the row, so it runs first — sees a
 * pristine event and establishes its own hover before we touch anything; in
 * capture our `preventDefault` lands first and the tint never appears at the
 * edges. `drop` stays in CAPTURE for the opposite reason: it must preempt
 * Obsidian's drop handler, which would otherwise move the file a second time
 * and fail on its own collision.
 *
 * **`dragover`, `drop` and `dragend` listen on the DOCUMENT, not the explorer
 * container.** Obsidian's drag ghost — the floating "Move into <folder>" chip —
 * is `position: fixed` with no `pointer-events: none` (read from its live
 * stylesheet), follows the cursor and is attached to `body`, so a
 * container-scoped `dragover` never fires while the pointer is over it and the
 * insertion line freezes where it was last drawn. On the document the events
 * always arrive; the row is resolved by hit-testing the pointer, and a
 * `pointerInside` guard keeps a document-wide listener off drags in the editor
 * or the tab bar.
 *
 * **The insertion line is created once at `bind` and never inserted or removed
 * during a drag** — only moved and shown. Appending it mid-drag is a childList
 * mutation inside the drag target's own subtree, which provokes
 * `dragenter`/`dragleave` churn and flickers the native highlight; it is also
 * observed by `ExplorerAdapter`'s MutationObserver, so every pointer move
 * schedules an apply pass for nothing.
 */
export interface DragOrderingDeps {
  /** The folder a row lives in, and whether the row is itself a folder. */
  describeRow(path: string): { parent: string; isFolder: boolean } | null;
  /** The folder's children in the order currently on screen. */
  displayedOrder(folderPath: string): string[];
  /** The stored order for that folder in the ACTIVE space, if any. */
  storedOrder(folderPath: string): string[] | undefined;
  /** Persist a new order. Rejects on failure; the caller reports it. */
  writeOrder(folderPath: string, order: string[]): Promise<void>;
  /**
   * Move paths into another folder and give them a position there. Must move
   * FIRST and order only on success — ordering a file into a folder it never
   * reached must never happen.
   */
  moveInto(paths: string[], targetFolder: string, edge: DropEdge, targetPath: string): Promise<void>;
  enabled(): boolean;
  /**
   * Called once per dragstart that `enabled()` refuses. The controller
   * says nothing itself — whether a blocked drag is worth explaining depends
   * on WHY it is blocked, and only the caller knows that.
   */
  onBlockedDrag?(): void;
  /**
   * Called once per drop declined because the collected selection may continue
   * past the explorer's render window (see `collectDragged`). Same division of
   * labour as `onBlockedDrag`: the controller declines, the caller explains,
   * because only the caller can raise a Notice. Optional, and the decline
   * stands whether or not it is supplied.
   */
  onSelectionOutsideWindow?(): void;
}

export class DragOrdering {
  private container: HTMLElement | null = null;
  private doc: Document | null = null;
  private line: HTMLElement | null = null;
  private dragged: string[] = [];
  /**
   * Whether `dragged` may be only part of the user's selection, because
   * the rest of it is not rendered. Set once per `dragstart` and read on drop.
   */
  private draggedTruncated = false;
  /** The row the drag started on, so its teardown can be triggered (see onDrop). */
  private sourceEl: HTMLElement | null = null;
  private warned = false;

  constructor(private readonly deps: DragOrderingDeps) {}

  bind(container: HTMLElement): void {
    this.unbind();
    // `enabled()` is asked fresh on every `dragstart` instead (see
    // `onDragStart`): a sort override can turn on or off without a rebind ever
    // happening (`observeSortOrder` and `restoreSavedOrdering` do not call
    // `bind()` again), so a gate here would answer with whatever was true at
    // the last rebind. Listeners are therefore always attached; a blocked
    // `dragstart` never populates `this.dragged`, and both handlers bail on it.
    this.container = container;
    this.ensureLine(container);
    this.doc = container.ownerDocument;
    // dragstart originates on a row, so the container is the right scope.
    container.addEventListener("dragstart", this.onDragStart, true);
    // The rest go on the document: the drag ghost steals these from the
    // container whenever it is under the cursor (see the class comment).
    // Bubble for dragover, so Obsidian's row handler runs first and keeps its
    // highlight; capture for drop, so we preempt its move.
    this.doc.addEventListener("dragover", this.onDragOver, false);
    this.doc.addEventListener("drop", this.onDrop, true);
    this.doc.addEventListener("dragend", this.onDragEnd, true);
  }

  unbind(): void {
    const c = this.container;
    if (!c) return;
    c.removeEventListener("dragstart", this.onDragStart, true);
    this.doc?.removeEventListener("dragover", this.onDragOver, false);
    this.doc?.removeEventListener("drop", this.onDrop, true);
    this.doc?.removeEventListener("dragend", this.onDragEnd, true);
    this.doc = null;
    // The element itself goes, not just its visibility.
    this.line?.remove();
    this.line = null;
    this.dragged = [];
    this.draggedTruncated = false;
    this.container = null;
  }

  /** Wraps every handler: a broken drag must never leave a stray line. */
  private guard(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.clearLine();
      if (!this.warned) {
        this.warned = true;
        console.error("Spaces: reordering drag failed; leaving the drag to Obsidian", e);
      }
    }
  }

  /**
   * The row under the pointer.
   *
   * NOT `target.closest(SEL.rowWrapper)`: the vertical gap between two rows
   * belongs to their parent's `.tree-item-children`, so from there `closest`
   * walks up to the ENCLOSING FOLDER's wrapper, whose rect spans its entire
   * subtree (measured: 133px tall against a 25px row). Offset arithmetic
   * against that is meaningless — "before" resolves to the folder's top edge,
   * so the line jumps to the folder heading above and alternates with the
   * correct position, reading as a flickering, thickening line.
   *
   * So: prefer the row box the pointer is genuinely inside, and otherwise hit
   * test `clientY` against the rendered rows. That removes the dead zones too —
   * the left-hand indent strip belongs to the children container, not any row.
   */
  /**
   * Is the pointer over the tree at all? Required because the listeners are on
   * the document: without it, a drag in the editor at a y that happened to line
   * up with a tree row would resolve a row and draw a line.
   */
  private pointerInside(clientX: number, clientY: number): boolean {
    const c = this.container;
    if (!c) return false;
    const r = c.getBoundingClientRect();
    return clientX >= r.left && clientX <= r.right && clientY >= r.top && clientY <= r.bottom;
  }

  /**
   * Is the event's target the tree itself, rather than something drawn
   * ON TOP of it?
   *
   * `pointerInside` is geometry alone, and geometry cannot tell the tree apart
   * from a surface covering the tree's rect. spaces draws one itself — the
   * create panel is `position: absolute; inset: 0` and a SIBLING of
   * `.nav-files-container` inside the explorer pane — and a capture-phase
   * `stopPropagation` on the document cuts every handler below it.
   *
   * The middle case is the whole reason this is not `container.contains()`:
   *
   *  - inside the container: the tree. Ours.
   *  - outside the explorer PANE altogether: Obsidian's drag ghost, which is
   *    `position: fixed` with no `pointer-events: none`, lives in `body`, and
   *    is usually the node under the pointer. A real tree drop, and the reason
   *    these listeners are on the document at all. Ours.
   *  - inside the pane but outside the tree: something the pane stacked over
   *    the tree. NOT ours; it owns its own drops.
   */
  private targetIsOurs(target: EventTarget | null): boolean {
    const c = this.container;
    if (!c) return false;
    const node = target instanceof Node ? target : null;
    // No target to reason about (a synthetic event); fall back to geometry.
    if (!node) return true;
    if (c.contains(node)) return true;
    const pane = c.closest(SEL.fileExplorerPane);
    return pane === null || !pane.contains(node);
  }

  private rowAt(target: EventTarget | null, clientY: number): { el: HTMLElement; path: string } | null {
    const c = this.container;
    if (!c) return null;

    const node = target instanceof HTMLElement ? target : null;
    const direct = node?.closest(SEL.titleWithPath);
    if (direct instanceof HTMLElement) {
      const path = direct.getAttribute("data-path");
      const el = direct.closest(SEL.rowWrapper);
      if (path && el instanceof HTMLElement) return { el, path };
    }

    // Hit test, then nearest-row fallback, bounded by the render window (~49
    // rows). The fallback is not defensive padding: rows are separated by a real
    // 2px gap (`.tree-item-self` has `margin-bottom: 2px`), so without it those
    // pixels are dead zones where the line vanishes mid-drag. A pointer in the
    // gap goes to the nearer row; only one further than half a row from
    // everything resolves to nothing.
    let best: { el: HTMLElement; path: string } | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const titled of Array.from(c.querySelectorAll(SEL.titleWithPath))) {
      if (!(titled instanceof HTMLElement)) continue;
      const r = titled.getBoundingClientRect();
      if (r.height <= 0) continue;
      const path = titled.getAttribute("data-path");
      const el = titled.closest(SEL.rowWrapper);
      if (!path || !(el instanceof HTMLElement)) continue;
      if (clientY >= r.top && clientY < r.bottom) return { el, path };
      const dist = clientY < r.top ? r.top - clientY : clientY - r.bottom;
      if (dist < bestDist) {
        bestDist = dist;
        best = { el, path };
        // Half a row is the threshold: past that the pointer is genuinely
        // nearer some other row, or outside the tree altogether.
        if (bestDist > r.height / 2) best = null;
      }
    }
    return best;
  }

  private readonly onDragStart = (e: Event): void =>
    this.guard(() => {
      // Checked per gesture rather than once at bind time — see `bind()`. A
      // blocked attempt is reported once and left inert: `dragover`/`drop` stay
      // silent because `this.dragged` is never populated below.
      if (!this.deps.enabled()) {
        this.deps.onBlockedDrag?.();
        return;
      }
      // Deliberately no preventDefault and no stopPropagation: Obsidian owns
      // the drag, we only observe what is being dragged.
      const row = this.rowAt(e.target, (e as MouseEvent).clientY ?? 0);
      if (!row) {
        this.dragged = [];
        return;
      }
      this.sourceEl = row.el;
      const collected = this.collectDragged(row);
      this.dragged = collected.paths;
      this.draggedTruncated = collected.truncated;
    });

  /**
   * Multi-selection is OPPORTUNISTIC. The explorer tracks its selection in a
   * private field this file may not touch, and `SEL.selectedRow` matches a
   * class Obsidian also uses elsewhere (the name is deliberately not repeated
   * here, so `grep` for it keeps answering "selectors.ts only" — the same
   * hygiene the quarantined private-API names require), so it is not
   * authoritative: selected siblings are collected only when the dragged row
   * itself carries the class, and otherwise the drag is the one row. That
   * fallback is the correct single-row behaviour, so no guess here can produce
   * a wrong result, only a less capable one.
   *
   * **And the DOM does not necessarily hold all of it.** The explorer detaches
   * rows when they scroll out of view: a 400-row tree rendered SIX of one
   * folder's 153 children behind a virtual spacer. Because spaces claims the
   * drop and performs the move itself, rows it never saw were simply not moved,
   * silently. Collecting more is not available — the real selection lives in a
   * private field the quarantine forbids, with no public API — so this reports
   * whether the set might be SHORT and `onDrop` declines rather than
   * half-moving: declining leaves the gesture with Obsidian, so the whole
   * selection still moves and only spaces's ordering precision is lost.
   *
   * The tell is geometric and needs nothing private: a selection that reaches
   * the first or last RENDERED row may continue past it — unless the scroller
   * is already at that end of its range.
   */
  private collectDragged(
    row: { el: HTMLElement; path: string }
  ): { paths: string[]; truncated: boolean } {
    const whole = (paths: string[]): { paths: string[]; truncated: boolean } => ({
      paths,
      truncated: false,
    });
    const c = this.container;
    if (!c) return whole([row.path]);
    const self = row.el.querySelector(SEL.titleWithPath);
    if (!(self instanceof HTMLElement) || !self.matches(SEL.selectedRow)) {
      return whole([row.path]);
    }
    // DOM order, which after Slice A's sort is also the visual order. Rendered
    // rows are read WHOLE rather than filtered by the query, because the
    // unselected ones are what say whether the selection is bounded.
    const rendered = Array.from(c.querySelectorAll(SEL.titleWithPath));
    const paths: string[] = [];
    for (const el of rendered) {
      if (!el.matches(SEL.selectedRow)) continue;
      const p = el.getAttribute("data-path");
      if (p) paths.push(p);
    }
    if (paths.length === 0) return whole([row.path]);
    return { paths, truncated: this.selectionMayBeClipped(rendered) };
  }

  /**
   * Could the selection continue past the rendered window?
   *
   * Only if it touches an end of that window AND the scroller has more tree in
   * that direction. One pixel of slack at each end, because a scroll offset can
   * be fractional on a HiDPI display.
   *
   * Known blind spot, recorded rather than papered over: a selected row inside
   * a folder the user has since COLLAPSED is not rendered and is not adjacent
   * to the window's edges either, so this cannot see it. Nothing in the public
   * DOM can.
   */
  private selectionMayBeClipped(rendered: readonly Element[]): boolean {
    const c = this.container;
    const first = rendered[0];
    const last = rendered[rendered.length - 1];
    if (!c || !first || !last) return false;
    const atTop = c.scrollTop <= 1;
    const atBottom = c.scrollTop + c.clientHeight >= c.scrollHeight - 1;
    return (
      (!atTop && first.matches(SEL.selectedRow)) ||
      (!atBottom && last.matches(SEL.selectedRow))
    );
  }

  private readonly onDragOver = (e: Event): void =>
    this.guard(() => {
      if (this.dragged.length === 0) return;
      const clientY = (e as MouseEvent).clientY ?? 0;
      if (!this.pointerInside((e as MouseEvent).clientX ?? 0, clientY)) {
        // The pointer left the tree — over the editor, a tab, or off-window.
        // The line must go with it, which a container-scoped listener could
        // never notice.
        this.clearLine();
        return;
      }
      // The pointer is over the tree's box, but something else may be
      // drawn there. See `targetIsOurs`.
      if (!this.targetIsOurs(e.target)) {
        this.clearLine();
        return;
      }
      // No line for a drop that cannot happen: this drop is going to be
      // declined, and promising a position and then refusing it is the
      // silent-partial-move defect wearing a hint.
      if (this.draggedTruncated) {
        this.clearLine();
        return;
      }
      const row = this.rowAt(e.target, clientY);
      if (!row) {
        this.clearLine();
        return;
      }
      const info = this.deps.describeRow(row.path);
      if (!info) {
        this.clearLine();
        return;
      }
      // Geometry from the row's own box, for the same reason `rowAt` exists:
      // the wrapper's rect includes a folder's whole subtree.
      const rect = this.rowBox(row.el);
      const intent = intentFor({
        offsetY: clientY - rect.top,
        height: rect.height,
        isFolder: info.isFolder,
      });

      if (intent.kind !== "between") {
        // Let Obsidian have it — this is drop-into-folder, and not stopping
        // propagation is exactly what keeps that working.
        this.clearLine();
        return;
      }

      // No line for a drop that cannot happen: the user must never be offered a
      // target inside the folder being dragged.
      if (this.illegalTarget(this.dragged, info.parent)) {
        this.clearLine();
        return;
      }

      // And no line where a drop would change nothing. `computeDrop` already
      // declines these — "the target is itself being dragged" and "the sequence
      // is unchanged" — but consulted only on DROP, so the line promised a move
      // the drop then silently refused. The case that surfaced it: dragging an
      // expanded folder over its own row put a line between the folder and its
      // first child, which reads as INSIDE the folder while actually being its
      // own trailing edge in its parent.
      //
      // Same-parent only, because that is the only case `computeDrop` describes;
      // a cross-folder drop always changes something by definition.
      if (this.isNoOpReorder(this.dragged, info.parent, row.path, intent.edge)) {
        this.clearLine();
        return;
      }

      // Neither preventDefault nor stopPropagation. Obsidian's own handler has
      // already run (bubble phase) and calls preventDefault itself — measured:
      // with spaces's listeners detached entirely, a dragover over the tree
      // still comes back `defaultPrevented`. So the drop is permitted without us
      // touching the event, and the tint and its label survive.
      this.showLine(row.el, intent.edge);
    });

  /**
   * Would this drop move one of the dragged paths inside itself?
   *
   * Dragging a folder over its own row opens it, and the rows inside are then
   * ordinary between-row targets — so without this the drop was claimed and
   * `Archive` was moved to `Archive/Archive`, which the filesystem rejects
   * with EINVAL.
   *
   * The dragged paths are passed WHOLE, not filtered to folders: such a filter
   * guards nothing. For a target to be under a dragged path that path must have
   * descendants, which only a folder has, and `targetFolder` always comes from
   * a row's `parent`, which is always a folder path — so a dragged file matches
   * neither branch of the rule.
   */
  private illegalTarget(dragged: string[], targetFolder: string): boolean {
    return movesIntoOwnSubtree(dragged, targetFolder);
  }

  /**
   * Would this same-parent drop leave the order exactly as it is?
   *
   * Asks `computeDrop` the same question the drop handler asks, so the line and
   * the drop can never disagree about whether a position does anything.
   * Returns false for a cross-folder drop, which always changes something.
   */
  private isNoOpReorder(
    dragged: string[],
    targetFolder: string,
    targetPath: string,
    edge: DropEdge
  ): boolean {
    const sameParent = dragged.every(
      (p) => this.deps.describeRow(p)?.parent === targetFolder
    );
    if (!sameParent) return false;
    return (
      computeDrop({
        order: this.deps.storedOrder(targetFolder),
        displayed: this.deps.displayedOrder(targetFolder),
        dragged,
        targetPath,
        edge,
      }) === null
    );
  }

  private readonly onDragEnd = (): void =>
    this.guard(() => {
      this.clearLine();
      this.dragged = [];
      this.draggedTruncated = false;
      this.sourceEl = null;
    });

  private readonly onDrop = (e: Event): void =>
    this.guard(() => {
      const dragged = this.dragged;
      const truncated = this.draggedTruncated;
      this.dragged = [];
      this.draggedTruncated = false;
      if (dragged.length === 0) return;
      const clientY = (e as MouseEvent).clientY ?? 0;
      this.clearLine();
      // A document-wide listener must not touch a drop anywhere but the tree.
      if (!this.pointerInside((e as MouseEvent).clientX ?? 0, clientY)) return;
      // Nor one that landed on a surface stacked over the tree, whose
      // own drop handler the `stopPropagation` below would otherwise cut.
      if (!this.targetIsOurs(e.target)) return;
      const row = this.rowAt(e.target, clientY);
      if (!row) return;

      const info = this.deps.describeRow(row.path);
      if (!info) return;
      const rect = this.rowBox(row.el);
      const intent = intentFor({
        offsetY: clientY - rect.top,
        height: rect.height,
        isFolder: info.isFolder,
      });
      // Not our drop: Obsidian's own handler moves the file into the folder.
      if (intent.kind !== "between") return;

      // An impossible move is not ours to claim. Returning without
      // preventDefault leaves the gesture with the core explorer, which owns
      // moves — better than swallowing it silently or raising an EINVAL Notice.
      if (this.illegalTarget(dragged, info.parent)) return;

      // And neither is a drop whose selection we can only see part of.
      // Declining without `preventDefault` hands the gesture to Obsidian, which
      // DOES know the whole selection: all of it moves, and only the position
      // within the destination folder is lost. Checked here rather than earlier
      // so it fires only for a drop spaces would otherwise have claimed.
      if (truncated) {
        this.reportUnclaimableSelection();
        return;
      }

      // On DROP, stopping propagation is required: Obsidian's own handler
      // would also move the file into the hovered folder, so leaving it to run
      // means two moves for one drop and a spurious collision failure.
      e.preventDefault();
      e.stopPropagation();
      // ...but that same handler is where Obsidian tears its drag state down,
      // so suppressing it leaves `is-grabbing` on the body (a stuck grab
      // cursor), the drop target still tinted, the source row still marked and
      // the ghost still attached until the next drag. Measured: dispatching a
      // plain `dragend` clears all four, and the browser's own dragend
      // afterwards is harmless because the teardown is idempotent.
      this.endNativeDrag();

      const targetFolder = info.parent;
      const sameParent = dragged.every(
        (p) => this.deps.describeRow(p)?.parent === targetFolder
      );

      if (!sameParent) {
        // A cross-folder drop is a filesystem move AND a position in the
        // new parent. The move has to land first.
        void this.deps
          .moveInto(dragged, targetFolder, intent.edge, row.path)
          .catch((err) => this.reportFailure(err));
        return;
      }

      const next = computeDrop({
        order: this.deps.storedOrder(targetFolder),
        displayed: this.deps.displayedOrder(targetFolder),
        dragged,
        targetPath: row.path,
        edge: intent.edge,
      });
      // A drop that changes nothing must not touch data.json.
      if (!next) return;
      void this.deps.writeOrder(targetFolder, next).catch((err) => this.reportFailure(err));
    });

  /**
   * Ask Obsidian to end its own drag. Called after we claim a drop, because
   * claiming it means its drop handler — which does this teardown — never runs.
   */
  private endNativeDrag(): void {
    const el = this.sourceEl;
    this.sourceEl = null;
    if (!el || !el.isConnected) return;
    // Constructed from the document's own window, and feature-detected: jsdom
    // has `Event` but not always `DragEvent`, and Obsidian's teardown does not
    // read the dataTransfer, so a plain Event is enough where it is missing.
    const view = this.doc?.defaultView as unknown as
      | { DragEvent?: typeof Event; Event?: typeof Event }
      | undefined;
    const Ctor = view?.DragEvent ?? view?.Event;
    if (!Ctor) return;
    el.dispatchEvent(new Ctor("dragend", { bubbles: true }));
  }

  /**
   * A drop declined because the selection outruns the render window.
   *
   * The console line is unconditional so the decline is never invisible to a
   * support question; the Notice, if any, is the caller's — this file has no
   * `"obsidian"` import and is not going to grow one.
   */
  private reportUnclaimableSelection(): void {
    console.warn(
      "Spaces: part of this selection is scrolled out of the explorer's " +
        "render window, so the drop was left to Obsidian rather than " +
        "moving only the rows spaces can see"
    );
    this.deps.onSelectionOutsideWindow?.();
  }

  private reportFailure(err: unknown): void {
    // The stored order is the truth and the render follows it, so there
    // is nothing to roll back — the tree simply keeps the arrangement it had.
    console.error("Spaces: could not save the new order", err);
  }

  private ensureLine(container: HTMLElement): void {
    if (this.line) return;
    const el = container.ownerDocument.createElement("div");
    el.className = CLS_DROP_LINE;
    // Created hidden, and it stays in the DOM for the life of the binding: see
    // the class comment on why inserting it mid-drag caused the flicker.
    el.hidden = true;
    container.appendChild(el);
    this.line = el;
  }

  /**
   * A row's own clickable box — `.tree-item-self` — falling back to the wrapper.
   *
   * **VERTICAL geometry only, and that restriction is load-bearing.** A FOLDER's
   * wrapper contains its entire subtree, so its box runs from the folder row to
   * the bottom of its last descendant; hit-testing and `boundaryY` both depend
   * on this being the row strip and nothing more. It is equally wrong to measure
   * HORIZONTALLY, in the opposite direction — see `showLine`, which is why that
   * one caller does not use this.
   */
  private rowBox(row: HTMLElement): DOMRect {
    const box = row.querySelector(SEL.titleWithPath);
    return (box instanceof HTMLElement ? box : row).getBoundingClientRect();
  }

  /**
   * The y of the boundary between two rows, in container space.
   *
   * ONE boundary must have ONE position. Rows are separated by a real gap —
   * `.tree-item-self` carries `margin-bottom: 2px` — so "after A" (A's bottom)
   * and "before B" (B's top) are two values 2px apart for what the user sees as
   * a single line. The line is itself 2px tall, so crossing that boundary
   * alternated between two adjacent, non-overlapping bands: a 4px flicker that
   * reads as the line thickening, with subpixel offsets rendering one at half
   * intensity — the "thin" state in the report.
   *
   * Taking the midpoint of the gap collapses both into the same pixel, derived
   * from the neighbouring row's geometry rather than a hardcoded 2px, so a theme
   * with different spacing needs no constant kept in sync.
   */
  private boundaryY(row: HTMLElement, edge: DropEdge): number {
    const rect = this.rowBox(row);
    const neighbour =
      edge === "after" ? row.nextElementSibling : row.previousElementSibling;
    const nRect =
      neighbour instanceof HTMLElement && neighbour.matches(SEL.rowWrapper)
        ? this.rowBox(neighbour)
        : null;
    if (!nRect || nRect.height <= 0) return edge === "after" ? rect.bottom : rect.top;

    // The sibling must actually be ADJACENT before its rect is trusted: in a
    // windowed container a `.tree-item` sibling can still be in the DOM while
    // scrolled far out of view, and averaging against it threw the line hundreds
    // of pixels away (measured mid-drag: a boundary at clientY -167 against a
    // correct value near 1220). A real inter-row gap is ~2px, so anything beyond
    // one row's height is not a neighbour worth averaging with.
    const gap = edge === "after" ? nRect.top - rect.bottom : rect.top - nRect.bottom;
    if (!(gap >= 0) || gap > rect.height) {
      return edge === "after" ? rect.bottom : rect.top;
    }

    return edge === "after"
      ? (rect.bottom + nRect.top) / 2
      : (nRect.bottom + rect.top) / 2;
  }

  private showLine(row: HTMLElement, edge: DropEdge): void {
    const c = this.container;
    if (!c) return;
    this.ensureLine(c);
    if (!this.line) return;
    // The WRAPPER, not `rowBox`'s `.tree-item-self`, and only for the
    // horizontal span — `top` comes from `boundaryY` below.
    //
    // Measured against 1.13.7: Obsidian indents a row by indenting the
    // `.tree-item` WRAPPER while stretching `.tree-item-self` back to the pane's
    // edge (`margin-inline-start: 0`, the indent applied as
    // `padding-inline-start`) so hover and selection backgrounds run full width.
    // At depth 0 both boxes read l=12 w=305; at depth 1 the wrapper reads l=29
    // w=288 while the self is still l=12 w=305, so taking the self produced a
    // pane-wide line at every depth. The wrapper is also what Obsidian's own
    // drop highlight paints (`.nav-folder.is-being-dragged-over`), so matching
    // it makes our line agree with the bubble the user is aiming at.
    const rowRect = row.getBoundingClientRect();
    const cRect = c.getBoundingClientRect();
    // The container is the scroller and is already `position: relative`
    // (measured), so an absolute child is positioned against its padding box and
    // scrolls with the content — hence the scroll terms. Rounded to a whole
    // pixel: a 2px line at a fractional offset straddles two device rows and
    // renders at half intensity, the dim "thin" state in the report.
    const top = Math.round(this.boundaryY(row, edge) - cRect.top + c.scrollTop);
    this.line.style.top = `${top}px`;
    this.line.style.left = `${Math.round(rowRect.left - cRect.left + c.scrollLeft)}px`;
    this.line.style.width = `${Math.round(rowRect.width)}px`;
    this.line.hidden = false;
  }

  /** Hides, never removes — removal during a drag is what caused the flicker. */
  private clearLine(): void {
    if (this.line) this.line.hidden = true;
  }
}
