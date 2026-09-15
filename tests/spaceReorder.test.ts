import { describe, expect, it } from "vitest";
import {
  EDGE_ZONE_PX,
  edgeScrollStep,
  gapCenterAt,
  insertionIndexAt,
  isNoOpMove,
  moveTo,
} from "../src/ui/spaceReorder";

/** Four 28px icons with a 4px gap, matching `.spaces-switcher-item`. */
const boxes = [
  { left: 0, width: 28 },
  { left: 32, width: 28 },
  { left: 64, width: 28 },
  { left: 96, width: 28 },
];

describe("insertionIndexAt", () => {
  it("returns 0 anywhere left of the first icon's midpoint", () => {
    expect(insertionIndexAt(-50, boxes)).toBe(0);
    expect(insertionIndexAt(0, boxes)).toBe(0);
    expect(insertionIndexAt(13, boxes)).toBe(0);
  });

  it("returns the count anywhere right of the last icon's midpoint", () => {
    expect(insertionIndexAt(111, boxes)).toBe(4);
    expect(insertionIndexAt(9999, boxes)).toBe(4);
  });

  it("flips at each icon's midpoint", () => {
    // Midpoint of icon 0 is x=14. Left of it inserts before, right of it after.
    expect(insertionIndexAt(13, boxes)).toBe(0);
    expect(insertionIndexAt(15, boxes)).toBe(1);
    // Icon 1 spans 32..60, midpoint 46.
    expect(insertionIndexAt(45, boxes)).toBe(1);
    expect(insertionIndexAt(47, boxes)).toBe(2);
  });

  it("claims the GAP between two icons rather than leaving it dead", () => {
    // Exact hit-testing leaves the inter-item gap unclaimed and
    // the line vanishes as the pointer crosses it. Every x resolves to a gap.
    for (let x = -20; x <= 140; x++) {
      const i = insertionIndexAt(x, boxes);
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThanOrEqual(boxes.length);
    }
    // The 4px gap between icon 0 (ends 28) and icon 1 (starts 32) is past
    // icon 0's midpoint, so it belongs to index 1 throughout.
    expect(insertionIndexAt(29, boxes)).toBe(1);
    expect(insertionIndexAt(31, boxes)).toBe(1);
  });

  it("returns 0 for an empty strip", () => {
    expect(insertionIndexAt(50, [])).toBe(0);
  });
});

describe("moveTo", () => {
  const list = ["a", "b", "c", "d"];

  it("moves an item to the right, accounting for its own removal", () => {
    // The off-by-one that would otherwise ship. Insertion index 3 is measured
    // against the list WITH `a` still in it, so after removing `a` the target
    // slot is 2 — dropping `a` between `b` and `c`, not between `c` and `d`.
    expect(moveTo(list, 0, 3)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item to the left without adjustment", () => {
    expect(moveTo(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("moves an item to the very front", () => {
    expect(moveTo(list, 2, 0)).toEqual(["c", "a", "b", "d"]);
  });

  it("moves an item to the very end", () => {
    expect(moveTo(list, 0, 4)).toEqual(["b", "c", "d", "a"]);
  });

  it("returns an equal list for a no-op move", () => {
    expect(moveTo(list, 1, 1)).toEqual(list);
    expect(moveTo(list, 1, 2)).toEqual(list);
  });

  it("does not mutate the input", () => {
    const original = [...list];
    moveTo(list, 0, 3);
    expect(list).toEqual(original);
  });
});

describe("isNoOpMove", () => {
  it("is true for the gap on either side of the dragged item", () => {
    // Both gaps touching the item leave it exactly where it is: no line,
    // because there is no change to describe.
    expect(isNoOpMove(2, 2)).toBe(true);
    expect(isNoOpMove(2, 3)).toBe(true);
  });

  it("is false for any other gap", () => {
    expect(isNoOpMove(2, 1)).toBe(false);
    expect(isNoOpMove(2, 4)).toBe(false);
    expect(isNoOpMove(2, 0)).toBe(false);
  });
});

describe("edgeScrollStep", () => {
  const rail = { left: 100, width: 200 };

  it("does not scroll while the pointer is away from both edges", () => {
    expect(edgeScrollStep(200, rail)).toBe(0);
  });

  it("scrolls left, negatively, near the left edge", () => {
    expect(edgeScrollStep(rail.left + 2, rail)).toBeLessThan(0);
  });

  it("scrolls right, positively, near the right edge", () => {
    expect(edgeScrollStep(rail.left + rail.width - 2, rail)).toBeGreaterThan(0);
  });

  it("scrolls faster the deeper into the edge zone the pointer is", () => {
    // A flat step makes a long rail tedious and a short one uncontrollable.
    const shallow = Math.abs(edgeScrollStep(rail.left + EDGE_ZONE_PX - 1, rail));
    const deep = Math.abs(edgeScrollStep(rail.left, rail));
    expect(deep).toBeGreaterThan(shallow);
  });

  it("still scrolls when the pointer runs past the rail entirely", () => {
    // Dragging beyond the strip must not stall the scroll — that is exactly
    // when the user is reaching for something off-screen.
    expect(edgeScrollStep(rail.left - 500, rail)).toBeLessThan(0);
    expect(edgeScrollStep(rail.left + rail.width + 500, rail)).toBeGreaterThan(0);
  });

  it("clamps to a maximum step in both directions", () => {
    const farLeft = edgeScrollStep(rail.left - 5000, rail);
    const farRight = edgeScrollStep(rail.left + rail.width + 5000, rail);
    expect(farLeft).toBe(-farRight);
    expect(Math.abs(farLeft)).toBeLessThanOrEqual(24);
  });
});

describe("gapCenterAt", () => {
  it("centres the line in the gap between two icons", () => {
    // Icon 0 ends at 28, icon 1 starts at 32, so the 4px gap centres on 30.
    expect(gapCenterAt(1, boxes)).toBe(30);
    expect(gapCenterAt(2, boxes)).toBe(62);
  });

  it("sits just before the first icon at index 0", () => {
    expect(gapCenterAt(0, boxes)).toBeLessThan(boxes[0].left);
  });

  it("sits just after the last icon at the end index", () => {
    const last = boxes[boxes.length - 1];
    expect(gapCenterAt(boxes.length, boxes)).toBeGreaterThan(last.left + last.width);
  });

  it("returns 0 for an empty strip", () => {
    expect(gapCenterAt(0, [])).toBe(0);
  });
});
