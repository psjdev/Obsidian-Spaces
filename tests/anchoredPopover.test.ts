// @vitest-environment jsdom
/**
 * `AnchoredPopover` imports nothing from `obsidian`, so it can be exercised
 * in jsdom.
 * Layer 1: no `obsidian` import, no computed style.
 *
 * The subject here is `reposition()`'s ARITHMETIC only — the above/below
 * decision, the two edge clamps and the rounding, which a second picker could
 * silently drift away from. The open/close lifecycle and the dismissal
 * rules are deliberately NOT touched here: they belong to
 * `tests/anchoredPopoverLifecycle.test.ts`, so the two files cannot end up
 * disagreeing about the same behaviour.
 *
 * jsdom lays nothing out, so every rect is stubbed per element. That is a
 * limitation, not a fiction: the arithmetic under test consumes two rects and
 * two viewport numbers and nothing else, so supplying them directly tests
 * exactly the function and nothing about layout. Anything about COMPUTED style
 * stays Layer 4.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AnchoredPopover } from "../src/ui/AnchoredPopover";

/** The margin and gap `reposition()` is written around. */
const MARGIN = 8;
const GAP = 6;

function stubRect(el: Element, r: { left: number; top: number; width: number; height: number }): void {
  const rect = {
    left: r.left,
    top: r.top,
    width: r.width,
    height: r.height,
    right: r.left + r.width,
    bottom: r.top + r.height,
    x: r.left,
    y: r.top,
    toJSON: () => r,
  } as DOMRect;
  el.getBoundingClientRect = (): DOMRect => rect;
}

function setViewport(width: number, height: number): void {
  Object.defineProperty(window, "innerWidth", { value: width, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: height, configurable: true });
}

interface Placed {
  popover: AnchoredPopover;
  root: HTMLElement;
  left: number;
  top: number;
}

/**
 * Opens a popover of `size` anchored to a control at `anchor`, and reads back
 * where it was put.
 */
function place(
  anchor: { left: number; top: number; width: number; height: number },
  size: { width: number; height: number }
): Placed {
  const btn = document.createElement("button");
  document.body.appendChild(btn);
  stubRect(btn, anchor);

  let root!: HTMLElement;
  const popover = new AnchoredPopover({
    anchor: btn,
    className: "spaces-test-popover",
    ariaLabel: "Test popover",
    build: (el) => {
      root = el;
      // `build` runs before `reposition()`, which is the contract that lets a
      // picker size itself first.
      stubRect(el, { left: 0, top: 0, ...size });
    },
  });
  popover.open();
  return {
    popover,
    root,
    left: parseFloat(root.style.left),
    top: parseFloat(root.style.top),
  };
}

describe("AnchoredPopover placement", () => {
  let open: AnchoredPopover[];

  beforeEach(() => {
    document.body.innerHTML = "";
    setViewport(1000, 800);
    open = [];
  });

  afterEach(() => {
    for (const p of open) p.close();
  });

  function track(p: Placed): Placed {
    open.push(p.popover);
    return p;
  }

  it("sits above the anchor, left-aligned, with a 6px gap", () => {
    const p = track(place({ left: 300, top: 500, width: 40, height: 24 }, { width: 200, height: 120 }));
    expect(p.left).toBe(300);
    expect(p.top).toBe(500 - 120 - GAP);
  });

  it("clamps to the right edge when the anchor is too far right", () => {
    // 950 + 200 would run off a 1000px viewport.
    const p = track(place({ left: 950, top: 500, width: 40, height: 24 }, { width: 200, height: 120 }));
    expect(p.left).toBe(1000 - 200 - MARGIN);
  });

  it("clamps to the left margin rather than off-screen", () => {
    const p = track(place({ left: 2, top: 500, width: 40, height: 24 }, { width: 200, height: 120 }));
    expect(p.left).toBe(MARGIN);
  });

  it("prefers the left margin over the right clamp when the popover is wider than the viewport", () => {
    // Both clamps fire; the left one is applied second and wins, so an
    // oversized popover starts on-screen rather than off the left edge.
    const p = track(place({ left: 300, top: 500, width: 40, height: 24 }, { width: 2000, height: 120 }));
    expect(p.left).toBe(MARGIN);
  });

  it("falls below the anchor only when there is no room above", () => {
    // top - height - 6 = 20 - 120 - 6 = -106, which is under the margin.
    const p = track(place({ left: 300, top: 20, width: 40, height: 24 }, { width: 200, height: 120 }));
    expect(p.top).toBe(20 + 24 + GAP);
  });

  it("clamps the fallback to the bottom margin when it will not fit below either", () => {
    // Nowhere above (100 - 700 - 6 is far under the margin) and the space
    // below the anchor is smaller than the popover, so it is pinned to the
    // bottom of the viewport rather than hanging past it.
    const p = track(place({ left: 300, top: 100, width: 40, height: 24 }, { width: 200, height: 700 }));
    expect(p.top).toBe(800 - 700 - MARGIN);
  });

  it("rounds to whole pixels", () => {
    const p = track(
      place({ left: 300.4, top: 500.6, width: 40, height: 24 }, { width: 200, height: 120.3 })
    );
    expect(p.root.style.left).toBe("300px");
    expect(p.root.style.top).toBe(`${Math.round(500.6 - 120.3 - GAP)}px`);
  });

  it("carries the caller's className and dialog semantics onto the root", () => {
    const p = track(place({ left: 300, top: 500, width: 40, height: 24 }, { width: 200, height: 120 }));
    expect(p.root.className).toBe("spaces-test-popover");
    expect(p.root.getAttribute("role")).toBe("dialog");
    expect(p.root.getAttribute("aria-label")).toBe("Test popover");
    expect(p.root.parentElement).toBe(document.body);
  });

  it("repositions on demand after the contents change height", () => {
    const p = track(place({ left: 300, top: 500, width: 40, height: 24 }, { width: 200, height: 120 }));
    expect(p.top).toBe(500 - 120 - GAP);
    stubRect(p.root, { left: 0, top: 0, width: 200, height: 60 });
    p.popover.reposition();
    expect(parseFloat(p.root.style.top)).toBe(500 - 60 - GAP);
  });
});
