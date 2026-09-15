import { Menu, Platform, setIcon } from "obsidian";
import type { AnchoredPopover } from "./AnchoredPopover";
import { openIconPicker } from "./IconPickerPopover";
import { openColorPicker } from "./ColorPickerPopover";
import { openRenamePopover } from "./RenamePopover";
import { knownIconIds } from "./knownIcons";
import { spaceEntries, splitPinnedEntry, type SpaceEntry } from "./spaceEntries";
import { railScrollLeft } from "./railScroll";
import {
  edgeScrollStep,
  gapCenterAt,
  insertionIndexAt,
  isNoOpMove,
  moveTo,
  type ItemBox,
} from "./spaceReorder";
import { CLS_SPACE_DRAGGING, CLS_SPACE_DROP_LINE } from "../explorer/selectors";
import { renameSpace, setSpaceIcon, setSpaceColor } from "../actions/spaceLifecycle";
import type { DefinitionStore } from "../definitions/DefinitionStore";
import type { RuntimeStateStore } from "../runtime/RuntimeStateStore";
import type { SpaceController } from "../controller/SpaceController";
import type { ActiveSelection } from "../types";

export class SwitcherView {
  private el: HTMLElement | null = null;
  /** Index in `spaces` of the icon being dragged, or null. */
  private dragFrom: number | null = null;
  /** Last pointer x in CLIENT coordinates, re-read every auto-scroll frame. */
  private dragClientX = 0;
  private dragRaf = 0;
  /**
   * The one popover this view has open, or null.
   *
   * Held because `AnchoredPopover` adds four listeners to `document` that only
   * its own `close()` removes — nothing in Obsidian's component tree owns
   * them. `destroy()` is on `onunload`'s path (and on `mount()`'s, which runs
   * again on every rebind), so this field is what makes the popovers reachable
   * at teardown at all.
   */
  private popover: AnchoredPopover | null = null;

  constructor(
    private defs: DefinitionStore,
    private runtime: RuntimeStateStore,
    private controller: SpaceController,
    private onCreateClicked: () => void,
    /** Shown only while that space renders with Obsidian's sort. */
    private isSortOverridden: (key: ActiveSelection) => boolean,
    private onRestoreOrdering: (key: ActiveSelection) => void
  ) {}

  mount(parent: HTMLElement): void {
    this.destroy();
    const el = parent.ownerDocument.createElement("div");
    el.className = "spaces-switcher";
    parent.appendChild(el);
    this.el = el;
    this.render();
  }

  destroy(): void {
    // A drag in flight owns a requestAnimationFrame loop that re-arms
    // itself while `dragFrom` is set. Dropping the element without clearing
    // both would leave that loop running forever against a detached rail.
    this.dragFrom = null;
    this.stopDragScrolling?.();
    this.stopDragScrolling = null;
    // A picker anchored to one of these icons outlives the element it points
    // at otherwise, listeners and all.
    this.popover?.close();
    this.popover = null;
    this.el?.remove();
    this.el = null;
  }

  /**
   * One popover at a time. The capture-phase `mousedown` in `AnchoredPopover`
   * already dismisses the open one on the click that opens the next, so this
   * mostly restates an existing guarantee — but it holds it without depending
   * on a pointer event, which the keyboard routes into these menus do not
   * produce.
   */
  private show(popover: AnchoredPopover): void {
    this.popover?.close();
    this.popover = popover;
  }

  render(): void {
    const el = this.el;
    if (!el) return;
    el.replaceChildren();
    // That line just destroyed every icon a picker could be anchored to, and
    // destroying a node fires nothing. This is the moment to notice: deleting
    // a custom colour chip re-renders the strip from the definitions
    // subscription, which would otherwise leave the colour picker floating
    // over an anchor that is no longer in the document.
    this.popover?.closeIfAnchorDetached();

    // One list, read by the strip, the header and the header's
    // dropdown. Inline copies of it drifted the moment a third reader existed.
    const entries = spaceEntries(
      this.defs.get().spaces,
      this.runtime.getSelection(),
      knownIconIds()
    );

    // Layout only. `pinned` is mounted OUTSIDE the rail, so the other
    // icons scroll past it instead of taking it with them.
    const { pinned, railed } = splitPinnedEntry(entries, this.defs.get().settings.pinAllSpace);

    if (pinned) {
      el.appendChild(this.buildItem(pinned));
      // Rendered only while something is pinned. A permanent rule that
      // sometimes separates nothing is worse than no rule — and without one,
      // icons scrolling under the pinned control look like they are vanishing
      // at an invisible edge.
      const divider = el.ownerDocument.createElement("div");
      divider.className = "spaces-switcher-divider";
      el.appendChild(divider);
    }

    // The icons scroll, the + does not. A `margin-left: auto` child of
    // an `overflow-x: auto` flex row scrolls away with the icons, which is
    // precisely when a create control is most wanted.
    const rail = el.ownerDocument.createElement("div");
    rail.className = "spaces-switcher-rail";
    el.appendChild(rail);

    for (const entry of railed) {
      rail.appendChild(this.buildItem(entry));
    }
    // Space reordering is HTML5 drag, which a touch pointer never starts. Building
    // the insertion line and three listeners for a gesture that cannot happen
    // is not merely wasted — the line is a child of the rail that `spaceEls()`
    // has to keep excluding, and `destroy()` has to keep unwinding. Gated on
    // `Platform`, Obsidian's own answer, rather than on a media query: the
    // question is what the device can DO, not how wide it is.
    if (!Platform.isMobile) this.wireReorder(rail);

    const add = el.ownerDocument.createElement("div");
    add.className = "spaces-switcher-add";
    add.setAttribute("role", "button");
    add.setAttribute("tabindex", "0");
    add.setAttribute("aria-label", "Create a space");
    setIcon(add, "plus");
    add.addEventListener("click", () => this.onCreateClicked());
    add.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        this.onCreateClicked();
      }
    });
    el.appendChild(add);

    this.revealActive(rail);
  }

  /**
   * Drag a space icon to reorder it.
   *
   * Every rule lives in `spaceReorder.ts`; this measures, renders and writes.
   *
   * Rebuilt with the rail on each render, which is safe because a render cannot
   * happen mid-drag — the only render a drop causes runs after the write, from
   * the definitions subscription.
   */
  private wireReorder(rail: HTMLElement): void {
    const line = rail.ownerDocument.createElement("div");
    line.className = CLS_SPACE_DROP_LINE;
    line.hidden = true;
    rail.appendChild(line);

    /** The draggable icons, in `spaces` order, with the line excluded. */
    const spaceEls = (): HTMLElement[] =>
      Array.from(rail.querySelectorAll<HTMLElement>("[data-space-id]"));

    /** Boxes in the rail's CONTENT coordinates, so they survive scrolling. */
    const boxesOf = (els: readonly HTMLElement[], railRect: DOMRect): ItemBox[] =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        return { left: r.left - railRect.left + rail.scrollLeft, width: r.width };
      });

    const update = (): void => {
      if (this.dragFrom === null) return;
      const railRect = rail.getBoundingClientRect();
      const boxes = boxesOf(spaceEls(), railRect);
      const contentX = this.dragClientX - railRect.left + rail.scrollLeft;
      const index = insertionIndexAt(contentX, boxes);
      // A drop that changes nothing draws no line.
      if (isNoOpMove(this.dragFrom, index)) {
        line.hidden = true;
        return;
      }
      line.style.left = `${Math.round(gapCenterAt(index, boxes)) - 1}px`;
      line.hidden = false;
    };

    const stopScrolling = (): void => {
      if (this.dragRaf) rail.ownerDocument.defaultView?.cancelAnimationFrame(this.dragRaf);
      this.dragRaf = 0;
    };

    const tick = (): void => {
      this.dragRaf = 0;
      if (this.dragFrom === null) return;
      const railRect = rail.getBoundingClientRect();
      const step = edgeScrollStep(this.dragClientX, {
        left: railRect.left,
        width: railRect.width,
      });
      if (step !== 0) rail.scrollLeft += step;
      // Recomputed every frame, not only on pointer movement: the pointer can
      // be perfectly still while the rail moves under it, and the gap it points
      // at changes anyway.
      update();
      if (step !== 0) startScrolling();
    };

    const startScrolling = (): void => {
      if (this.dragRaf) return;
      const view = rail.ownerDocument.defaultView;
      if (view) this.dragRaf = view.requestAnimationFrame(tick);
    };

    rail.addEventListener("dragover", (e) => {
      if (this.dragFrom === null) return;
      // Calling `preventDefault()` here must not happen for the FILE TREE,
      // where Obsidian's own handler already permits the drop. Nothing
      // permits a drop in our own strip, though, and without cancelling here
      // the `drop` event never fires at all. Scoped to a space drag we
      // started: `dragFrom` is null for every other drag crossing this
      // element, including a note dragged out of the explorer.
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
      this.dragClientX = e.clientX;
      update();
      startScrolling();
    });

    rail.addEventListener("drop", (e) => {
      const from = this.dragFrom;
      if (from === null) return;
      e.preventDefault();
      const railRect = rail.getBoundingClientRect();
      const boxes = boxesOf(spaceEls(), railRect);
      const index = insertionIndexAt(e.clientX - railRect.left + rail.scrollLeft, boxes);
      this.endDrag(rail, line);
      if (isNoOpMove(from, index)) return;
      void this.defs
        .mutate((d) => {
          d.spaces = moveTo(d.spaces, from, index);
        })
        .catch((err) => {
          console.error("Spaces: reordering spaces failed", err);
        });
    });

    // Fires whether the drag ended in a drop, outside the strip, or on Escape,
    // so it is the only teardown that is guaranteed to run.
    rail.addEventListener("dragend", () => this.endDrag(rail, line));
    this.stopDragScrolling = stopScrolling;
  }

  /** Set by `wireReorder`; torn down with the view. */
  private stopDragScrolling: (() => void) | null = null;

  private endDrag(rail: HTMLElement, line: HTMLElement): void {
    this.dragFrom = null;
    line.hidden = true;
    this.stopDragScrolling?.();
    rail
      .querySelectorAll(`.${CLS_SPACE_DRAGGING}`)
      .forEach((e) => e.classList.remove(CLS_SPACE_DRAGGING));
  }

  /**
   * One control, whether it ends up in the rail or pinned beside it.
   *
   * Shared deliberately. A second hand-rolled copy of the *All* item is exactly
   * how the strip and the dropdown drifted apart before `spaceEntries.ts`
   * existed, and a pinned control that quietly lost `is-active`, its
   * `aria-label` or its pending state would be that mistake again in miniature.
   * The rule that *All* has no context menu survives for free: the gate is
   * on `entry.key.kind`, not on where the element is mounted.
   */
  private buildItem(entry: SpaceEntry): HTMLElement {
    const el = this.el as HTMLElement;
    const item = el.ownerDocument.createElement("div");
    item.className = "spaces-switcher-item";
    item.setAttribute("role", "button");
    item.setAttribute("tabindex", "0");
    // Name in the label, never colour alone (spec section 9.6).
    // `aria-label` and NOTHING ELSE. Obsidian renders its own tooltip
    // from this attribute — its nav buttons and ribbon actions carry an
    // aria-label and no `title` at all — so adding `title` too produced a
    // second, OS-drawn tooltip stacked on the first.
    item.setAttribute("aria-label", entry.label);
    if (entry.color) item.style.color = entry.color;

    if (entry.active) {
      item.classList.add("is-active");
      item.setAttribute("aria-current", "true");
    }

    // The fallback is already applied by `spaceEntries`, so an id this
    // build cannot draw arrives here as `box` rather than rendering a BLANK
    // button with no clue why.
    setIcon(item, entry.icon);

    // No in-flight dedupe flag is needed here: `SpaceController.switchTo`'s
    // "already active" check runs INSIDE the queue, against the selection as
    // it is when the work actually starts, so two fire-and-forget clicks on
    // the same new target still only enqueue one real recompute — the second
    // resolves to "already there" and returns without doing anything. A local
    // flag would only restate a guarantee the controller already makes for
    // every caller, not only this one.
    const activate = async (): Promise<void> => {
      item.classList.add("is-pending");
      try {
        await this.controller.switchTo(entry.key);
      } catch (e) {
        console.error("Spaces: switching space failed", e);
      } finally {
        this.render();
      }
    };
    item.addEventListener("click", () => void activate());
    item.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        void activate();
      }
    });

    // Right-click a space to change its icon. Only a space — All has no
    // icon of its own to change, and offering the menu there would imply it
    // did. The rows come from `iconMenuItems`, which owns the rule that
    // exactly one is checked; this loop renders them and nothing more.
    //
    // No teardown needed: `render()` rebuilds these elements wholesale, so
    // the listener dies with the node it is on.
    if (entry.key.kind === "space") {
      const spaceId = entry.key.id;

      // Only a SPACE is draggable. *All* is not in the `spaces` array
      // and has no position to move; the `+` is a control, not a space.
      //
      // And only on a pointer that can drag. `draggable` is worse than
      // inert on touch — a long press on it hands the gesture to the browser's
      // own drag/selection machinery instead of opening the context menu this
      // item wants, so an attribute that does nothing useful would take away
      // something that works. The reorder itself stays desktop-only; a touch
      // equivalent is a feature, not a fix.
      if (!Platform.isMobile) {
        item.dataset.spaceId = spaceId;
        item.draggable = true;
      }
      item.addEventListener("dragstart", (e) => {
        const from = this.defs.get().spaces.findIndex((sp) => sp.id === spaceId);
        if (from < 0) return;
        this.dragFrom = from;
        this.dragClientX = e.clientX;
        item.classList.add(CLS_SPACE_DRAGGING);
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
          // Some browsers fire no `drop` at all unless the drag carries data.
          // The payload is never read back — `dragFrom` is the source of truth,
          // and trusting a string from the event would let any outside drag
          // claiming this type reorder the strip.
          e.dataTransfer.setData("text/plain", spaceId);
        }
      });
      const currentIcon = entry.icon;
      item.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        const menu = new Menu();
        // First, because renaming is the commonest of the three. Its
        // own popover rather than the header's inline editor — this menu is
        // offered on EVERY icon, but the header shows only the active space,
        // so routing through it would rename the wrong one.
        menu.addItem((mi) =>
          mi
            .setIcon("pencil")
            .setTitle("Rename space…")
            .onClick(() => {
              this.show(
                openRenamePopover({
                  anchor: item,
                  current: entry.label,
                  apply: (name) => renameSpace(this.defs, spaceId, name),
                })
              );
            })
        );
        menu.addItem((mi) =>
          mi
            .setIcon("image")
            .setTitle("Change space icon…")
            .onClick(() => {
              // Anchored to the switcher item itself, so the popover opens
              // where the space lives rather than in the middle of the app.
              this.show(
                openIconPicker(item, currentIcon, (icon) =>
                  setSpaceIcon(this.defs, spaceId, icon)
                )
              );
            })
        );
        menu.addItem((mi) =>
          mi
            .setIcon("palette")
            .setTitle("Change space colour…")
            .onClick(() => {
              this.show(
                openColorPicker({
                  anchor: item,
                  current: entry.color ?? "",
                  customs: this.defs.get().settings.customColors,
                  apply: (color) => setSpaceColor(this.defs, spaceId, color),
                  saveCustoms: (customs) =>
                    this.defs.mutate((d) => {
                      d.settings.customColors = customs;
                    }),
                })
              );
            })
        );
        // Only while this space is actually overridden. A permanently
        // present row that usually does nothing teaches nothing.
        if (this.isSortOverridden(entry.key)) {
          menu.addItem((mi) =>
            mi
              .setIcon("rotate-ccw")
              .setTitle("Restore saved ordering")
              .onClick(() => this.onRestoreOrdering(entry.key))
          );
        }
        menu.showAtMouseEvent(e);
      });
    }

    return item;
  }

  /**
   * Brings the active control into view when the rail overflows.
   *
   * Without this, the promise that "a space is never unreachable because it
   * does not fit" held only for reaching a space by scrolling to it, and not
   * for the space you are already IN: switching by command, by the header's
   * dropdown, or by creating a space lit up a control outside the visible
   * range with nothing bringing it back.
   *
   * `railScrollLeft` returns the current offset unchanged when the control is
   * already wholly visible, so this is a no-op on the common path — which
   * matters, because `render()` runs on every switch and every definitions
   * change.
   */
  private revealActive(rail: HTMLElement): void {
    // Scoped to the RAIL, which is also why pinning needed no change
    // here. With *All* pinned and active, the element is not in the rail, this
    // finds nothing and returns — correct, because a pinned control is always
    // visible and there is nothing to scroll it into. Do not "fix" this by
    // widening the query to the whole strip: it would then measure a control
    // outside the scroller against the scroller's own box.
    const active = rail.querySelector<HTMLElement>(".spaces-switcher-item.is-active");
    if (!active) return;
    const railRect = rail.getBoundingClientRect();
    const itemRect = active.getBoundingClientRect();
    // Content coordinates from rects plus the live scroll offset, never
    // `offsetLeft`: that is relative to the nearest POSITIONED ancestor, which
    // nothing guarantees is the rail.
    const next = railScrollLeft({
      scrollLeft: rail.scrollLeft,
      clientWidth: rail.clientWidth,
      itemOffset: itemRect.left - railRect.left + rail.scrollLeft,
      itemWidth: itemRect.width,
    });
    // Assigning an unchanged value would still be a write; skipping it keeps
    // this provably inert when nothing needs to move.
    if (next !== rail.scrollLeft) rail.scrollLeft = next;
  }
}
