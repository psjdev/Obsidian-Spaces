// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnchoredPopover } from "../src/ui/AnchoredPopover";

/**
 * The popovers' LIFECYCLE — who owns one, when it closes, and whether
 * its four document-level listeners are actually gone afterwards. Placement
 * arithmetic (`reposition()`) is a separate concern and is not touched here.
 *
 * Layer 1: `AnchoredPopover` imports nothing from `"obsidian"`, so it
 * runs in jsdom directly. `SwitcherView` and `SpaceHeaderView` — the real
 * owners — cannot be imported at all in Vitest, because the `obsidian` package
 * is types-only (`"main": ""`) and resolving it throws at import time. The
 * `FakeOwner` below therefore stands in for them, mirroring exactly the wiring
 * they carry: one popover field, closed on `destroy()`, and re-checked after
 * the `replaceChildren()` that destroys its anchor.
 */

/**
 * The only way to observe whether the document listeners are still attached
 * WITHOUT spying on `removeEventListener` — which would assert the
 * implementation rather than the behaviour.
 *
 * `onKeydown` calls `preventDefault()` on Escape unconditionally, so a live
 * listener cancels the event and a removed one does not. `dispatchEvent`
 * returns false exactly when something cancelled it.
 */
function escapeReachesAHandler(): boolean {
  const e = new KeyboardEvent("keydown", { key: "Escape", cancelable: true, bubbles: true });
  return !document.dispatchEvent(e);
}

function makeAnchor(parent: HTMLElement = document.body): HTMLElement {
  const a = parent.ownerDocument.createElement("div");
  a.className = "anchor";
  parent.appendChild(a);
  return a;
}

/**
 * Every popover made here is registered for teardown. Without that, a test
 * that fails part-way leaves four listeners on the shared `document` and the
 * NEXT test reads them as its own leak — which is exactly the false signal
 * this suite exists to detect.
 */
const opened: AnchoredPopover[] = [];

function makePopover(anchor: HTMLElement, className = "test-popover"): AnchoredPopover {
  const pop = new AnchoredPopover({
    anchor,
    className,
    ariaLabel: "Test popover",
    build: (root) => {
      root.textContent = "contents";
    },
  });
  opened.push(pop);
  return pop;
}

function dialogCount(): number {
  return document.body.querySelectorAll("[role='dialog']").length;
}

/**
 * What `SwitcherView`/`SpaceHeaderView` now do, and nothing more: hold the one
 * popover they opened, close it on teardown, and — because `render()` is the
 * thing that destroys the anchor — re-check the anchor right after the
 * `replaceChildren()` that removes it.
 */
class FakeOwner {
  readonly el: HTMLElement;
  private popover: AnchoredPopover | null = null;

  constructor() {
    this.el = document.createElement("div");
    document.body.appendChild(this.el);
  }

  open(): AnchoredPopover {
    // One at a time: the popover already open is closed before the next opens.
    this.popover?.close();
    const pop = makePopover(makeAnchor(this.el));
    pop.open();
    this.popover = pop;
    return pop;
  }

  render(): void {
    this.el.replaceChildren();
    this.popover?.closeIfAnchorDetached();
  }

  destroy(): void {
    this.popover?.close();
    this.popover = null;
    this.el.remove();
  }
}

beforeEach(() => {
  document.body.replaceChildren();
});

afterEach(() => {
  for (const pop of opened.splice(0)) pop.close();
  document.body.replaceChildren();
});

describe("AnchoredPopover lifecycle", () => {
  it("opens onto the body and closes back off it", () => {
    const pop = makePopover(makeAnchor());
    pop.open();
    expect(pop.isOpen).toBe(true);
    expect(dialogCount()).toBe(1);

    pop.close();
    expect(pop.isOpen).toBe(false);
    expect(dialogCount()).toBe(0);
  });

  it("stops handling document events once closed", () => {
    const pop = makePopover(makeAnchor());
    pop.open();
    expect(escapeReachesAHandler()).toBe(true);

    pop.close();
    expect(escapeReachesAHandler()).toBe(false);
  });

  it("closes idempotently, and a repeat close cannot reach another popover", () => {
    const a = makePopover(makeAnchor(), "popover-a");
    const b = makePopover(makeAnchor(), "popover-b");
    a.open();
    a.close();
    b.open();

    expect(() => {
      a.close();
      a.close();
    }).not.toThrow();

    // B is untouched: `close()` removes only its own listeners and its own
    // element, so a stale reference to a closed popover is inert rather than
    // destructive.
    expect(b.isOpen).toBe(true);
    expect(dialogCount()).toBe(1);
    expect(escapeReachesAHandler()).toBe(true);
  });

  it("closes when its anchor has left the document", () => {
    const anchor = makeAnchor();
    const pop = makePopover(anchor);
    pop.open();

    anchor.remove();
    pop.closeIfAnchorDetached();

    expect(pop.isOpen).toBe(false);
    expect(dialogCount()).toBe(0);
    expect(escapeReachesAHandler()).toBe(false);
  });

  it("stays open while its anchor is still in the document", () => {
    const pop = makePopover(makeAnchor());
    pop.open();

    pop.closeIfAnchorDetached();

    expect(pop.isOpen).toBe(true);
    expect(dialogCount()).toBe(1);
  });
});

describe("AnchoredPopover under an owner", () => {
  it("takes the popover down with the owner, listeners included", () => {
    const owner = new FakeOwner();
    const pop = owner.open();
    expect(dialogCount()).toBe(1);

    owner.destroy();

    expect(pop.isOpen).toBe(false);
    expect(dialogCount()).toBe(0);
    expect(escapeReachesAHandler()).toBe(false);
  });

  it("closes the popover when a re-render destroys its anchor", () => {
    const owner = new FakeOwner();
    const pop = owner.open();

    // Exactly what `SwitcherView.render()` does to the row a picker is
    // anchored to, and what no DOM event would report.
    owner.render();

    expect(pop.isOpen).toBe(false);
    expect(dialogCount()).toBe(0);
    expect(escapeReachesAHandler()).toBe(false);
  });

  it("keeps at most one popover open", () => {
    const owner = new FakeOwner();
    const first = owner.open();
    const second = owner.open();

    expect(first.isOpen).toBe(false);
    expect(second.isOpen).toBe(true);
    expect(dialogCount()).toBe(1);
  });
});

/**
 * `onClose`/`suppressEscape`, added for `FolderPickerPopover`
 * (`src/ui/FolderPickerPopover.ts`) so it can retain and tear down its own
 * `FolderSuggest` on every dismissal path, and so Escape can close a
 * suggester's own dropdown without also closing the whole popover.
 *
 * `FolderSuggest` itself cannot be constructed under this stub at all —
 * `AbstractInputSuggest`'s stub constructor unconditionally throws (it
 * "requires a real App... constructing one is out of reach here",
 * obsidian-stub.ts) — so the SPECIFIC integration (a real suggester's
 * `isPopoverOpen` suppressing a real popover's Escape) cannot be exercised
 * here or anywhere else in this suite. What IS tested is the generic
 * mechanism `AnchoredPopover` now offers; `FolderPickerPopover`'s own
 * `suppressEscape`/`onClose` callbacks are thin, untestable-under-this-stub
 * wiring on top of it (same limitation as `CreateSpacePanel.ts`, which has
 * no test file at all for the same reason).
 */
describe("AnchoredPopover — onClose / suppressEscape", () => {
  function makeGuardedPopover(
    anchor: HTMLElement,
    opts: { suppressEscape?(): boolean; onClose?(): void }
  ): AnchoredPopover {
    const pop = new AnchoredPopover({
      anchor,
      className: "test-guarded-popover",
      ariaLabel: "Test guarded popover",
      build: (root) => {
        root.textContent = "contents";
      },
      ...opts,
    });
    opened.push(pop);
    return pop;
  }

  it("calls onClose exactly once for an Escape dismissal", () => {
    let closes = 0;
    const pop = makeGuardedPopover(makeAnchor(), { onClose: () => closes++ });
    pop.open();

    // `true`: the popover's own handler ran, called preventDefault(), and
    // closed as a result (same polarity as the existing "stops handling
    // document events once closed" test above, WHILE still open).
    expect(escapeReachesAHandler()).toBe(true);
    expect(pop.isOpen).toBe(false);
    expect(closes).toBe(1);
  });

  it("calls onClose exactly once for an outside mousedown", () => {
    let closes = 0;
    const pop = makeGuardedPopover(makeAnchor(), { onClose: () => closes++ });
    pop.open();

    document.body.dispatchEvent(
      new MouseEvent("mousedown", { bubbles: true, cancelable: true })
    );

    expect(pop.isOpen).toBe(false);
    expect(closes).toBe(1);
  });

  it("calls onClose exactly once for an explicit close(), and not again on a repeat close()", () => {
    let closes = 0;
    const pop = makeGuardedPopover(makeAnchor(), { onClose: () => closes++ });
    pop.open();

    pop.close();
    pop.close(); // idempotent: already closed, must not fire onClose again

    expect(closes).toBe(1);
  });

  it("does not call onClose for a close() on a popover that was never open", () => {
    let closes = 0;
    const pop = makeGuardedPopover(makeAnchor(), { onClose: () => closes++ });

    pop.close();

    expect(closes).toBe(0);
  });

  it("suppressEscape prevents the Escape-triggered close (and onClose does not fire)", () => {
    let closes = 0;
    let suppressed = true;
    const pop = makeGuardedPopover(makeAnchor(), {
      suppressEscape: () => suppressed,
      onClose: () => closes++,
    });
    pop.open();

    // `false`: `suppressEscape` returning true makes the popover's handler
    // return BEFORE calling preventDefault() — nothing here consumed the
    // key, mirroring how an open suggester's own keymap handling would.
    expect(escapeReachesAHandler()).toBe(false);
    expect(pop.isOpen).toBe(true);
    expect(closes).toBe(0);

    // Once whatever was suppressing it (e.g. a suggester's own dropdown)
    // closes, the SAME Escape key now reaches the popover.
    suppressed = false;
    expect(escapeReachesAHandler()).toBe(true);
    expect(pop.isOpen).toBe(false);
    expect(closes).toBe(1);
  });

  it("omitting suppressEscape preserves every existing caller's behaviour (closes on Escape)", () => {
    // RenamePopover, ColorPickerPopover, IconPickerPopover and
    // SpaceSwitcherPopover all omit this option; `undefined` must keep
    // meaning "never suppress", exactly as before this option existed.
    const pop = makePopover(makeAnchor());
    pop.open();

    expect(escapeReachesAHandler()).toBe(true);
    expect(pop.isOpen).toBe(false);
  });
});
