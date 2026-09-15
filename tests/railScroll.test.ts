import { describe, expect, it } from "vitest";
import { PAD, railScrollLeft } from "../src/ui/railScroll";

/** A 100px-wide viewport scrolled to 0, with a 28px item at `itemOffset`. */
const at = (itemOffset: number, over: Partial<Parameters<typeof railScrollLeft>[0]> = {}) =>
  railScrollLeft({ scrollLeft: 0, clientWidth: 100, itemOffset, itemWidth: 28, ...over });

describe("railScrollLeft", () => {
  it("leaves scrollLeft untouched when the item is fully visible", () => {
    // Load-bearing: `render()` runs on every switch and every definitions
    // change, so returning anything but the input here would nudge the rail
    // continuously.
    expect(at(10)).toBe(0);
    expect(at(40, { scrollLeft: 20, clientWidth: 100 })).toBe(20);
  });

  it("scrolls right just far enough to reveal an item past the edge", () => {
    // item spans 200..228 in a viewport showing 0..100.
    expect(at(200)).toBe(200 + 28 + PAD - 100);
  });

  it("scrolls left to reveal an item before the viewport", () => {
    expect(at(30, { scrollLeft: 120 })).toBe(30 - PAD);
  });

  it("never scrolls past zero", () => {
    // An item at the very start must not produce a negative scrollLeft.
    expect(at(0, { scrollLeft: 50 })).toBe(0);
    expect(at(2, { scrollLeft: 50 })).toBe(0);
  });

  it("reveals an item only partially clipped at the right edge", () => {
    // spans 90..118, viewport 0..100 — visible but not wholly.
    expect(at(90)).toBe(90 + 28 + PAD - 100);
  });

  it("reveals an item only partially clipped at the left edge", () => {
    // scrolled to 100, item spans 90..118: its start is cut off.
    expect(at(90, { scrollLeft: 100 })).toBe(90 - PAD);
  });

  it("aligns the start of an item wider than the viewport", () => {
    // Showing the end and hiding the start would be the wrong half: the icon
    // is at the start.
    expect(at(300, { itemWidth: 400 })).toBe(300 - PAD);
  });

  it("is stable for an item nearly as wide as the rail", () => {
    // The hazard this guards: without the oversize branch such an item
    // satisfies "starts too early" and "ends too late" on alternate calls, so
    // `render()` flips scrollLeft between two values forever. Idempotence is
    // the property that matters, so it is asserted across two calls.
    // The offset must be away from the left edge: near zero the left-edge
    // branch clamps to 0 and hides the oscillation. An earlier version of this
    // test used offset 5 and passed with the guard REMOVED, pinning nothing.
    const args = { scrollLeft: 0, clientWidth: 100, itemOffset: 200, itemWidth: 90 };
    const once = railScrollLeft(args);
    const twice = railScrollLeft({ ...args, scrollLeft: once });
    const thrice = railScrollLeft({ ...args, scrollLeft: twice });
    expect(twice).toBe(once);
    expect(thrice).toBe(once);
  });

  it("returns the current scrollLeft for a zero-width rail", () => {
    // A collapsed sidebar reports clientWidth 0; anything else would fabricate
    // a scroll position for an element nobody can see.
    expect(at(200, { clientWidth: 0, scrollLeft: 7 })).toBe(7);
  });

  it("survives a non-finite measurement", () => {
    expect(at(Number.NaN, { scrollLeft: 5 })).toBe(5);
  });
});
