import { describe, expect, it } from "vitest";
import {
  applyOrder,
  moveWithin,
  insertAt,
  compact,
} from "../src/order/orderModel";

describe("applyOrder", () => {
  it("returns live untouched when there is no order (the untouched-folder path)", () => {
    const live = ["a.md", "b.md"];
    expect(applyOrder(undefined, live)).toEqual(live);
    expect(applyOrder([], live)).toEqual(live);
  });

  it("puts listed items first in list order, then unlisted in LIVE order", () => {
    // `live` is Obsidian's own sort; unlisted entries must keep it.
    expect(applyOrder(["c.md", "a.md"], ["a.md", "b.md", "c.md", "d.md"])).toEqual([
      "c.md",
      "a.md",
      "b.md",
      "d.md",
    ]);
  });

  it("skips listed paths that are no longer live, without reordering the rest", () => {
    expect(applyOrder(["gone.md", "b.md"], ["a.md", "b.md"])).toEqual(["b.md", "a.md"]);
  });

  it("returns live when EVERY listed path is gone, rather than an empty tree", () => {
    // An order may never make a row disappear. This is the degenerate
    // case of that invariant and it is the one most likely to be got wrong.
    expect(applyOrder(["gone.md", "also-gone.md"], ["a.md", "b.md"])).toEqual([
      "a.md",
      "b.md",
    ]);
  });

  it("interleaves folders and files, because the list is total", () => {
    expect(applyOrder(["note.md", "Folder"], ["Folder", "note.md"])).toEqual([
      "note.md",
      "Folder",
    ]);
  });

  it("does not invent or drop entries", () => {
    const live = ["a.md", "b.md", "c.md"];
    const out = applyOrder(["b.md"], live);
    expect([...out].sort()).toEqual([...live].sort());
  });

  it("does not mutate either argument", () => {
    const order = ["c.md", "a.md"];
    const live = ["a.md", "b.md", "c.md"];
    applyOrder(order, live);
    expect(order).toEqual(["c.md", "a.md"]);
    expect(live).toEqual(["a.md", "b.md", "c.md"]);
  });
});

describe("moveWithin", () => {
  it("moves to the dropped index, computed after removal", () => {
    expect(moveWithin(["a", "b", "c", "d"], "a", 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves backwards", () => {
    expect(moveWithin(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });

  it("clamps an out-of-range index instead of producing holes", () => {
    expect(moveWithin(["a", "b"], "a", 99)).toEqual(["b", "a"]);
    expect(moveWithin(["a", "b"], "b", -5)).toEqual(["b", "a"]);
  });

  it("returns the list unchanged for a path it does not contain", () => {
    expect(moveWithin(["a", "b"], "zzz", 0)).toEqual(["a", "b"]);
  });
});

describe("insertAt", () => {
  it("inserts a path that was not listed", () => {
    expect(insertAt(["a", "b"], "new", 1)).toEqual(["a", "new", "b"]);
  });

  it("behaves as a move when the path is already listed", () => {
    expect(insertAt(["a", "b", "c"], "c", 0)).toEqual(["c", "a", "b"]);
  });

  it("appends when the index is past the end", () => {
    expect(insertAt(["a"], "new", 99)).toEqual(["a", "new"]);
  });
});

describe("compact", () => {
  it("compact drops paths that no longer resolve", () => {
    expect(compact(["a", "gone", "b"], new Set(["a", "b"]))).toEqual(["a", "b"]);
  });

  it("compact preserves order of survivors", () => {
    expect(compact(["c", "a", "b"], new Set(["a", "b", "c"]))).toEqual(["c", "a", "b"]);
  });
});


