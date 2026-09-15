import { describe, expect, it } from "vitest";
import {
  filterVisibleItems,
  type FilterableItem,
  type VisibilityLookup,
} from "../src/visibility/visibleItems";

/** Visible unless the path starts with `Hidden`. */
const lookup: VisibilityLookup = {
  decisionFor: (path) => ({ visible: !path.startsWith("Hidden") }),
};

const item = (path: string): FilterableItem => ({ file: { path } });

describe("filterVisibleItems", () => {
  it("keeps every item when there is no snapshot", () => {
    // A null snapshot is All mode: nothing is filtered there, and the
    // adapter already expresses All as a null snapshot.
    const items = [item("Hidden/a.md"), item("Notes/b.md")];
    expect(filterVisibleItems(items, null)).toEqual(items);
  });

  it("drops items the snapshot marks not visible", () => {
    const out = filterVisibleItems([item("Hidden/a.md"), item("Notes/b.md")], lookup);
    expect(out.map((i) => i.file?.path)).toEqual(["Notes/b.md"]);
  });

  it("keeps items the snapshot marks visible, whatever the reason", () => {
    // Scaffolds and visitors are `visible: true` in the snapshot, so
    // they need no separate rule here — this pins that they are not dropped.
    const out = filterVisibleItems([item("Projects"), item("Notes/b.md")], lookup);
    expect(out).toHaveLength(2);
  });

  it("KEEPS an item with no usable path, because it cannot be judged", () => {
    // Filtering fails open. An item we cannot key is not evidence that it should
    // disappear, and dropping it would remove a row for no stated reason.
    const out = filterVisibleItems([{}, { file: {} }, item("Notes/b.md")], lookup);
    expect(out).toHaveLength(3);
  });

  it("keeps an item whose path is not a string", () => {
    const weird = { file: { path: 42 } } as unknown as FilterableItem;
    expect(filterVisibleItems([weird], lookup)).toEqual([weird]);
  });

  it("returns a new array and does not mutate the input", () => {
    const items = [item("Hidden/a.md"), item("Notes/b.md")];
    const copy = [...items];
    const out = filterVisibleItems(items, lookup);
    expect(items).toEqual(copy);
    expect(out).not.toBe(items);
  });

  it("returns an empty array for empty input", () => {
    expect(filterVisibleItems([], lookup)).toEqual([]);
  });

  it("returns an empty array when nothing in the folder is visible", () => {
    // Legitimate: a folder full of non-members. The row for the folder itself
    // is decided by ITS parent's filter, not here.
    expect(filterVisibleItems([item("Hidden/a.md"), item("Hidden/b.md")], lookup)).toEqual([]);
  });
});
