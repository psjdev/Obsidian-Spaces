import { describe, expect, it } from "vitest";
import { computeDrop, intentFor, movesIntoOwnSubtree } from "../src/order/dropIntent";

describe("intentFor", () => {
  it("treats a folder's middle as the native drop-into", () => {
    expect(intentFor({ offsetY: 12, height: 24, isFolder: true })).toEqual({ kind: "into" });
  });

  it("treats a folder's edges as between-row insertions", () => {
    expect(intentFor({ offsetY: 2, height: 24, isFolder: true })).toEqual({
      kind: "between",
      edge: "before",
    });
    expect(intentFor({ offsetY: 22, height: 24, isFolder: true })).toEqual({
      kind: "between",
      edge: "after",
    });
  });

  it("splits a FILE row at the midpoint, because there is no into", () => {
    expect(intentFor({ offsetY: 11, height: 24, isFolder: false })).toEqual({
      kind: "between",
      edge: "before",
    });
    expect(intentFor({ offsetY: 13, height: 24, isFolder: false })).toEqual({
      kind: "between",
      edge: "after",
    });
  });

  it("returns none for a zero-height row instead of dividing by zero", () => {
    expect(intentFor({ offsetY: 0, height: 0, isFolder: false })).toEqual({ kind: "none" });
    expect(intentFor({ offsetY: 5, height: -1, isFolder: true })).toEqual({ kind: "none" });
  });

  it("honours a custom edge band, and the boundary resolves to after", () => {
    // With the bands meeting exactly at the midpoint, a symmetric pair of
    // comparisons would drop this pixel through to `into` — a dead row that is
    // invisible in use. The trailing comparison is `>=` for that reason, and
    // this assertion fails if it is written as `>`.
    expect(intentFor({ offsetY: 12, height: 24, isFolder: true, edgeBand: 0.5 })).toEqual({
      kind: "between",
      edge: "after",
    });
  });
});

describe("computeDrop", () => {
  const displayed = ["a.md", "b.md", "c.md", "d.md"];

  it("materialises the visible order on the first drag", () => {
    // No stored order yet: the result must be the whole visible sequence
    // rearranged, not a one-item list.
    const out = computeDrop({ displayed, dragged: ["d.md"], targetPath: "a.md", edge: "before" });
    expect(out).toEqual(["d.md", "a.md", "b.md", "c.md"]);
  });

  it("moves within an existing order", () => {
    const out = computeDrop({
      order: ["a.md", "b.md", "c.md", "d.md"],
      displayed,
      dragged: ["a.md"],
      targetPath: "c.md",
      edge: "after",
    });
    expect(out).toEqual(["b.md", "c.md", "a.md", "d.md"]);
  });

  it("inserts before the target", () => {
    const out = computeDrop({ displayed, dragged: ["d.md"], targetPath: "b.md", edge: "before" });
    expect(out).toEqual(["a.md", "d.md", "b.md", "c.md"]);
  });

  it("keeps a multi-drag together, in its dragged order", () => {
    const out = computeDrop({
      displayed,
      dragged: ["d.md", "b.md"],
      targetPath: "a.md",
      edge: "after",
    });
    expect(out).toEqual(["a.md", "d.md", "b.md", "c.md"]);
  });

  it("inserts a path arriving from another folder", () => {
    const out = computeDrop({
      order: ["a.md", "b.md"],
      displayed: ["a.md", "b.md"],
      dragged: ["Other/new.md"],
      targetPath: "a.md",
      edge: "after",
    });
    expect(out).toEqual(["a.md", "Other/new.md", "b.md"]);
  });

  it("is a no-op when the drop changes nothing", () => {
    // b.md already sits immediately after a.md.
    expect(
      computeDrop({
        order: ["a.md", "b.md", "c.md"],
        displayed,
        dragged: ["b.md"],
        targetPath: "a.md",
        edge: "after",
      })
    ).toBeNull();
  });

  it("is a no-op when a row is dropped onto its own edge", () => {
    expect(
      computeDrop({
        order: ["a.md", "b.md"],
        displayed,
        dragged: ["a.md"],
        targetPath: "a.md",
        edge: "before",
      })
    ).toBeNull();
  });

  it("returns null for an unknown target rather than guessing", () => {
    expect(
      computeDrop({ displayed, dragged: ["a.md"], targetPath: "nope.md", edge: "before" })
    ).toBeNull();
  });

  it("never mutates its arguments", () => {
    const order = ["a.md", "b.md"];
    const disp = ["a.md", "b.md"];
    const dragged = ["b.md"];
    computeDrop({ order, displayed: disp, dragged, targetPath: "a.md", edge: "before" });
    expect(order).toEqual(["a.md", "b.md"]);
    expect(disp).toEqual(["a.md", "b.md"]);
    expect(dragged).toEqual(["b.md"]);
  });

  it("loses and invents nothing", () => {
    const out = computeDrop({ displayed, dragged: ["c.md"], targetPath: "a.md", edge: "before" });
    expect(out && [...out].sort()).toEqual([...displayed].sort());
  });

  it("compares against the stored order, not the render, when they disagree", () => {
    // An ordered folder whose stored order differs from `displayed` — which is
    // normal, since `displayed` is what the space is currently showing. The
    // no-op check must use the stored order, or every drop here would write.
    const out = computeDrop({
      order: ["d.md", "c.md", "b.md", "a.md"],
      displayed,
      dragged: ["c.md"],
      targetPath: "d.md",
      edge: "before",
    });
    expect(out).toEqual(["c.md", "d.md", "b.md", "a.md"]);
  });
});

describe("movesIntoOwnSubtree", () => {
  it("rejects a folder dropped into itself", () => {
    // The reported bug: dragging Archive and hovering between rows INSIDE it
    // made targetFolder "Archive", and the move became Archive -> Archive/Archive,
    // which the filesystem rejects with EINVAL.
    expect(movesIntoOwnSubtree(["Archive"], "Archive")).toBe(true);
  });

  it("rejects a folder dropped into a deep descendant", () => {
    expect(movesIntoOwnSubtree(["Projects"], "Projects/Console 2030/Hardware")).toBe(true);
  });

  it("ALLOWS a sibling whose name merely shares a prefix", () => {
    // A bare `startsWith` without the separator would reject this, blocking a
    // perfectly legal move.
    expect(movesIntoOwnSubtree(["Archive"], "Archive2")).toBe(false);
    expect(movesIntoOwnSubtree(["Archive"], "Archived/Sub")).toBe(false);
  });

  it("allows the vault root as a target", () => {
    // "" is the root in storage terms; no folder contains it.
    expect(movesIntoOwnSubtree(["Archive"], "")).toBe(false);
  });

  it("allows a folder dropped into an unrelated folder", () => {
    expect(movesIntoOwnSubtree(["Archive"], "Bulk")).toBe(false);
  });

  it("allows a folder dropped into its own parent", () => {
    // A no-op as a move, but legal — and it is how a cross-folder drag is
    // cancelled by dropping back where it came from.
    expect(movesIntoOwnSubtree(["Projects/Sub"], "Projects")).toBe(false);
  });

  it("rejects when ANY of several dragged folders is an ancestor", () => {
    // A multi-selection is one gesture; if part of it is impossible the whole
    // drop is, because a partial move is worse than none.
    expect(movesIntoOwnSubtree(["Bulk", "Archive"], "Archive/Deep")).toBe(true);
  });

  it("is always legal for a drag containing no folders", () => {
    // Files cannot contain anything, so the caller passes an empty list.
    expect(movesIntoOwnSubtree([], "Archive")).toBe(false);
  });
});

describe("computeDrop with a PARTIAL stored order (spec 20.2)", () => {
  // The reported bug: in the fixture's All, the root's stored order listed 7
  // paths while the root had 14 children. The 7 rendered first and could be
  // targeted; the other 7 rendered below and could not be targeted at all,
  // because the baseline `computeDrop` measured against was the stored list
  // rather than the effective one.
  const stored = ["Archive", "Delta.md", "Projects"];
  const displayed = ["Archive", "Delta.md", "Projects", "Hello World.md", "blobs.md"];

  it("can target a path that is NOT in the stored order", () => {
    const next = computeDrop({
      order: stored,
      displayed,
      dragged: ["Delta.md"],
      targetPath: "Hello World.md",
      edge: "after",
    });
    expect(next).not.toBeNull();
    expect(next).toEqual(["Archive", "Projects", "Hello World.md", "Delta.md", "blobs.md"]);
  });

  it("produces a TOTAL order, so the next drag is not confined to the old list", () => {
    // Writing back a partial order is what made the bug persist: each drop
    // stored only what it knew about, and the next drag inherited that.
    const next = computeDrop({
      order: stored,
      displayed,
      dragged: ["blobs.md"],
      targetPath: "Archive",
      edge: "before",
    });
    expect(next).toHaveLength(displayed.length);
    expect([...(next ?? [])].sort()).toEqual([...displayed].sort());
  });

  it("still reports no change when the drop is a genuine no-op", () => {
    // The distinction that matters: "unchanged" must survive the fix, or
    // The no-op line suppression would stop working.
    const next = computeDrop({
      order: stored,
      displayed,
      dragged: ["Delta.md"],
      targetPath: "Projects",
      edge: "before",
    });
    expect(next).toBeNull();
  });

  it("drops a stored entry that is no longer live", () => {
    // `applyOrder` intersects with what is displayed, so a stale path cannot
    // reappear in the written order.
    const next = computeDrop({
      order: ["Gone.md", "Archive", "Delta.md"],
      displayed: ["Archive", "Delta.md", "blobs.md"],
      dragged: ["blobs.md"],
      targetPath: "Archive",
      edge: "before",
    });
    expect(next).toEqual(["blobs.md", "Archive", "Delta.md"]);
  });
});
