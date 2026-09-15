import { describe, expect, it, vi } from "vitest";
import {
  isPatched,
  patch,
  probe,
  readSortOrder,
  requestResort,
  unpatch,
  type FolderItemLike,
} from "../src/layout/nativeExplorerSort";

/**
 * A stand-in for `FileExplorerView`, built the way Obsidian builds it: the
 * methods live on a PROTOTYPE, because the whole patch strategy depends on an
 * own property being able to shadow them and `delete` restoring inheritance.
 * A fake with own-property methods would let a broken unpatch pass.
 */
function makeView(items: FolderItemLike[] = [{ file: { path: "F/a.md" } }, { file: { path: "F/b.md" } }]) {
  const calls = { getSorted: 0, sort: 0, requestSort: 0 };
  const proto = {
    getSortedFolderItems(this: unknown, _folder: unknown): FolderItemLike[] {
      calls.getSorted++;
      return items;
    },
    sort(): void {
      calls.sort++;
    },
    requestSort(): void {
      calls.requestSort++;
    },
  };
  const view = Object.create(proto) as Record<string, unknown>;
  return { view, calls, proto, items };
}

const folder = { path: "F" };

describe("probe", () => {
  it("is unknown for anything that is not an object", () => {
    for (const bad of [undefined, null, 42, "view", true]) {
      expect(probe(bad)).toBe("unknown");
    }
  });

  it("is unknown when the seam is missing", () => {
    expect(probe({})).toBe("unknown");
  });

  it("is unknown when getSortedFolderItems is not a function", () => {
    expect(probe({ getSortedFolderItems: "nope", sort() {} })).toBe("unknown");
  });

  it("is unknown when sort is missing, because teardown needs it", () => {
    // unpatch MUST be able to force a re-sort; without `sort` we could install
    // an order we cannot take off, so the seam counts as unusable.
    expect(probe({ getSortedFolderItems() {} })).toBe("unknown");
  });

  it("is ok for a complete view", () => {
    const { view } = makeView();
    expect(probe(view)).toBe("ok");
  });
});

describe("patch", () => {
  it("refuses a view without the seam", () => {
    expect(patch({}, (_p, i) => i)).toBe(false);
  });

  it("installs an OWN property, leaving the prototype method intact", () => {
    const { view, proto } = makeView();
    const before = proto.getSortedFolderItems;
    expect(patch(view, (_p, i) => i)).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(view, "getSortedFolderItems")).toBe(true);
    expect(proto.getSortedFolderItems).toBe(before);
    expect(isPatched(view)).toBe(true);
  });

  it("passes the folder path and the original items, and returns the reorder's result", () => {
    const { view, items } = makeView();
    const seen: Array<[string, FolderItemLike[]]> = [];
    patch(view, (p, i) => {
      seen.push([p, i]);
      return [...i].reverse();
    });
    const out = (view.getSortedFolderItems as (f: unknown) => FolderItemLike[])(folder);
    expect(seen[0][0]).toBe("F");
    expect(seen[0][1]).toEqual(items);
    expect(out.map((x) => x.file?.path)).toEqual(["F/b.md", "F/a.md"]);
  });

  it("falls back to the original order when the reorder throws", () => {
    const { view, items } = makeView();
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    patch(view, () => {
      throw new Error("boom");
    });
    const call = view.getSortedFolderItems as (f: unknown) => FolderItemLike[];
    expect(call(folder)).toEqual(items);
    // Logged once, not per call — this runs on every sort of every folder.
    call(folder);
    call(folder);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("ALLOWS a subset, because filtering removes rows on purpose", () => {
    // Reverses the old rule. The mechanism (2026-09-07) returns only the rows
    // a space shows, so a shorter output is the feature, not a fault.
    const { view, items } = makeView();
    patch(view, (_p, i) => i.slice(1));
    const out = (view.getSortedFolderItems as (f: unknown) => FolderItemLike[])(folder);
    expect(out).toEqual(items.slice(1));
  });

  it("falls back when the transform INVENTS an entry", () => {
    // The hazard the old length check actually existed for: a row in the
    // user's tree that corresponds to nothing Obsidian offered.
    const { view, items } = makeView();
    patch(view, (_p, i) => [...i, { file: { path: "F/invented.md" } }]);
    const out = (view.getSortedFolderItems as (f: unknown) => FolderItemLike[])(folder);
    expect(out).toEqual(items);
  });

  it("falls back when the transform DUPLICATES an entry", () => {
    // A duplicate is length-legal and still wrong: the same file would render
    // twice, and the second row would be a lie about the vault.
    const { view, items } = makeView();
    patch(view, (_p, i) => [i[0], i[0]]);
    const out = (view.getSortedFolderItems as (f: unknown) => FolderItemLike[])(folder);
    expect(out).toEqual(items);
  });

  it("falls back when the transform SUBSTITUTES a fabricated entry for a real one", () => {
    // The case the length pre-check cannot see: same count, no duplicates, but
    // one entry never came from Obsidian. Only the subset membership check
    // rejects it, and a fabricated row is a lie about the vault.
    const { view, items } = makeView();
    patch(view, (_p, i) => [i[0], { file: { path: "F/fabricated.md" } }]);
    const out = (view.getSortedFolderItems as (f: unknown) => FolderItemLike[])(folder);
    expect(out).toEqual(items);
  });

  it("allows an empty result, because a folder may contain no visible rows", () => {
    const { view } = makeView();
    patch(view, () => []);
    const out = (view.getSortedFolderItems as (f: unknown) => FolderItemLike[])(folder);
    expect(out).toEqual([]);
  });

  it("falls back when the folder argument has no usable path", () => {
    const { view, items } = makeView();
    patch(view, (_p, i) => [...i].reverse());
    const call = view.getSortedFolderItems as (f: unknown) => FolderItemLike[];
    expect(call(null)).toEqual(items);
    expect(call({})).toEqual(items);
  });

  it("refuses to patch twice, so teardown cannot restore an intermediate layer", () => {
    const { view } = makeView();
    expect(patch(view, (_p, i) => [...i].reverse())).toBe(true);
    expect(patch(view, (_p, i) => i)).toBe(false);
  });

  it("calls the original exactly once per invocation (no nesting)", () => {
    const { view, calls } = makeView();
    patch(view, (_p, i) => i);
    patch(view, (_p, i) => i);
    (view.getSortedFolderItems as (f: unknown) => FolderItemLike[])(folder);
    expect(calls.getSorted).toBe(1);
  });
});

describe("unpatch", () => {
  it("removes the own property and restores prototype inheritance", () => {
    const { view, proto } = makeView();
    patch(view, (_p, i) => [...i].reverse());
    unpatch(view);
    expect(Object.prototype.hasOwnProperty.call(view, "getSortedFolderItems")).toBe(false);
    expect(view.getSortedFolderItems).toBe(proto.getSortedFolderItems);
    expect(isPatched(view)).toBe(false);
  });

  it("FORCES a re-sort, because deleting the override does not revert the tree", () => {
    // Measured in the fixture vault: after `delete`, the explorer keeps
    // its last sorted result until something re-sorts. Without this call,
    // disabling the plugin leaves rows in the custom order — residue a disabled plugin must not leave.
    const { view, calls } = makeView();
    patch(view, (_p, i) => i);
    unpatch(view);
    expect(calls.sort).toBe(1);
  });

  it("goes INERT when another plugin wrapped us and we cannot be lifted out", () => {
    // R2, mainline review 2026-09-08. `unpatch` correctly refuses to delete an
    // own property that is no longer ours — deleting it would uninstall the
    // other plugin's feature. But our override stays buried inside their
    // closure, and until this fix it kept transforming.
    //
    // That was tolerable when this seam carried only ORDERING: a stale sort
    // after unload. Since source filtering (design 2026-09-07) it carries
    // FILTERING, so a buried wrapper leaves the user's tree still filtered
    // after spaces is disabled — residue a disabled plugin must not
    // leave, and it fails in the one direction that is never acceptable,
    // showing LESS.
    const { view, items } = makeView();
    patch(view, (_p, i) => i.slice(1)); // a filtering transform: drops a row

    // Another plugin wraps what it finds, which is us, and calls through.
    const ours = view.getSortedFolderItems as (f: unknown) => FolderItemLike[];
    let foreignCalls = 0;
    (view as { getSortedFolderItems: unknown }).getSortedFolderItems = function (
      this: unknown,
      f: unknown
    ): FolderItemLike[] {
      foreignCalls++;
      return ours.call(this, f);
    };

    unpatch(view);

    // Theirs survives — we must not have deleted it.
    expect(foreignCalls).toBe(0);
    const out = (view.getSortedFolderItems as (f: unknown) => FolderItemLike[])(folder);
    expect(foreignCalls).toBe(1);
    // And ours, still in the chain, now passes everything straight through.
    expect(out).toEqual(items);
  });

  it("goes inert even when removing the override THROWS", () => {
    // Why `deactivate()` runs before the delete attempt rather than after.
    // The delete is wrapped in try/catch because a non-configurable own
    // property "should be impossible for an own property we assigned" — but
    // if that ever stops being true, deactivating afterwards would be skipped
    // and the override would keep filtering. Ordering it first costs nothing
    // and is the difference between a stale tree and a safe one.
    const { view, items } = makeView();
    patch(view, (_p, i) => i.slice(1));

    // Make the own property impossible to delete, the one way the catch fires.
    Object.defineProperty(view, "getSortedFolderItems", {
      value: view.getSortedFolderItems,
      configurable: false,
      writable: false,
    });

    expect(() => unpatch(view)).not.toThrow();

    const out = (view.getSortedFolderItems as (f: unknown) => FolderItemLike[])(folder);
    expect(out).toEqual(items);
  });

  it("is a no-op on a view that was never patched", () => {
    const { view, calls } = makeView();
    expect(() => unpatch(view)).not.toThrow();
    expect(calls.sort).toBe(0);
  });

  it("is safe to call twice and only re-sorts once", () => {
    const { view, calls } = makeView();
    patch(view, (_p, i) => i);
    unpatch(view);
    unpatch(view);
    expect(calls.sort).toBe(1);
  });

  it("can re-patch after unpatching", () => {
    const { view } = makeView();
    patch(view, (_p, i) => i);
    unpatch(view);
    expect(patch(view, (_p, i) => i)).toBe(true);
  });
});

describe("requestResort", () => {
  it("uses the DIRECT sort, because the queued one leaves windowed rows stale", () => {
    // Measured in the fixture vault: after an order change, `requestSort()`
    // left a windowed folder's rendered rows showing the OLD order even though
    // the seam returned the new one. `sort()` re-rendered immediately. This
    // test pins the choice so it cannot be "optimised" back to the queued call.
    const { view, calls } = makeView();
    requestResort(view);
    expect(calls.sort).toBe(1);
    expect(calls.requestSort).toBe(0);
  });

  it("falls back to requestSort only when sort is absent", () => {
    const requestSort = vi.fn();
    requestResort({ getSortedFolderItems() {}, requestSort });
    expect(requestSort).toHaveBeenCalledTimes(1);
  });

  it("does not throw on a view with neither", () => {
    expect(() => requestResort({})).not.toThrow();
  });
});

describe("unpatch respects a co-installed plugin", () => {
  it("does NOT delete an own property that is no longer ours", () => {
    // Another plugin patching the same method after us owns the own property.
    // `delete` would uninstall their feature along with ours. `unpatch` must
    // read the stored original before deleting, or it would delete whatever
    // property it found.
    const { view } = makeView();
    patch(view, (_p, i) => i);
    const theirs = function (): FolderItemLike[] {
      return [];
    };
    (view as Record<string, unknown>).getSortedFolderItems = theirs;

    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    unpatch(view);
    expect(view.getSortedFolderItems).toBe(theirs);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("still forces the re-sort in that case, so our order does not linger", () => {
    const { view, calls } = makeView();
    patch(view, (_p, i) => i);
    (view as Record<string, unknown>).getSortedFolderItems = function (): FolderItemLike[] {
      return [];
    };
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    unpatch(view);
    expect(calls.sort).toBe(1);
    spy.mockRestore();
  });

  it("stops reporting as patched once unpatched, so a later patch is allowed", () => {
    const { view } = makeView();
    patch(view, (_p, i) => i);
    (view as Record<string, unknown>).getSortedFolderItems = function (): FolderItemLike[] {
      return [];
    };
    const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
    unpatch(view);
    spy.mockRestore();
    expect(isPatched(view)).toBe(false);
  });
});

describe("readSortOrder", () => {
  it("reads the view's sort order", () => {
    expect(readSortOrder({ sortOrder: "alphabeticalReverse" })).toBe("alphabeticalReverse");
  });

  it("returns null when the property is absent", () => {
    // A build that renames or drops it must degrade to "no gesture ever seen",
    // not to a thrown error inside a sort callback.
    expect(readSortOrder({})).toBeNull();
  });

  it("returns null for a non-string value", () => {
    expect(readSortOrder({ sortOrder: 3 })).toBeNull();
    expect(readSortOrder({ sortOrder: null })).toBeNull();
  });

  it("returns null for a non-object view", () => {
    expect(readSortOrder(null)).toBeNull();
    expect(readSortOrder(undefined)).toBeNull();
  });
});

describe("patch probes the property it is about to shadow", () => {
  it("does not shadow a plugin that patches the PROTOTYPE after us", () => {
    // We install an OWN property, which shadows the prototype for this view.
    // A co-installed plugin that patches the same method on the prototype
    // AFTER us is therefore invisible to this instance — its comparator never
    // runs and it has no way to find out. Composing with a prototype patch
    // installed BEFORE us already works; this is the other direction.
    const { view, proto, items } = makeView();
    const seen: string[] = [];
    patch(view, (_p, i) => i);

    const theirs = [{ file: { path: "F/theirs.md" } }];
    proto.getSortedFolderItems = function (this: unknown, _folder: unknown) {
      seen.push("other-plugin");
      return theirs;
    };

    const out = (view.getSortedFolderItems as (f: unknown) => FolderItemLike[])(folder);
    expect(seen).toEqual(["other-plugin"]);
    expect(out).toBe(theirs);
    expect(out).not.toBe(items);
  });

  it("still composes with a prototype patch installed BEFORE us", () => {
    const { view, proto } = makeView();
    const seen: string[] = [];
    const theirs = [{ file: { path: "F/theirs.md" } }];
    proto.getSortedFolderItems = function (this: unknown, _folder: unknown) {
      seen.push("other-plugin");
      return theirs;
    };
    patch(view, (_p, i) => i);
    const out = (view.getSortedFolderItems as (f: unknown) => FolderItemLike[])(folder);
    expect(seen).toEqual(["other-plugin"]);
    expect(out).toBe(theirs);
  });

  it("wraps an instance patch installed before us rather than re-reading the prototype", () => {
    // An OWN property already present is someone else's instance patch. We
    // captured IT as the original, so the prototype probe must stay out of the
    // way: re-resolving to the prototype here would delete their feature.
    const { view, proto } = makeView();
    const theirs = [{ file: { path: "F/theirs.md" } }];
    (view as Record<string, unknown>).getSortedFolderItems = function (
      this: unknown,
      _folder: unknown
    ) {
      return theirs;
    };
    patch(view, (_p, i) => i);
    proto.getSortedFolderItems = function (this: unknown, _folder: unknown) {
      return [{ file: { path: "F/proto.md" } }];
    };
    const out = (view.getSortedFolderItems as (f: unknown) => FolderItemLike[])(folder);
    expect(out).toBe(theirs);
  });

  it("refuses a view whose seam is a non-configurable own property", () => {
    // We could never `delete` it, so installing over it would be residue
    // we cannot remove. Refusing is the fail-open direction (no filtering).
    const { view } = makeView();
    Object.defineProperty(view, "getSortedFolderItems", {
      value: () => [],
      configurable: false,
      writable: true,
    });
    expect(patch(view, (_p, i) => i)).toBe(false);
    expect(isPatched(view)).toBe(false);
  });

  it("refuses a view whose seam is an accessor rather than a data property", () => {
    // Assigning through someone's setter is not a shadow, it is a write into
    // their machinery, and `delete` would not undo it.
    const { view } = makeView();
    Object.defineProperty(view, "getSortedFolderItems", {
      get: () => () => [],
      configurable: true,
    });
    expect(patch(view, (_p, i) => i)).toBe(false);
    expect(isPatched(view)).toBe(false);
  });
});

describe("the permitted-item predicate", () => {
  // Scoped to this describe rather than added at module scope: this file
  // already has a top-level `folder` (a plain object) and `makeView` (returns
  // {view, calls, proto, items}) for the pre-existing tests above, with
  // incompatible shapes from what the helpers below need. Declaring these
  // inside the callback shadows the outer names for this block only, so
  // neither set of tests sees the other's helpers.
  function folder(path: string): unknown {
    return { path };
  }
  function pathsOf(items: readonly { file?: { path?: string } }[]): (string | undefined)[] {
    return items.map((i) => i.file?.path);
  }
  //
  // This mock view must include `sort` alongside `requestSort`. `probe()`
  // requires it (teardown needs
  // a direct re-sort, per the comment above `requestResort`), so without it
  // `patch()` refuses to install at all and every test below would pass or
  // fail on the UNPATCHED passthrough rather than on the guard being tested.
  function makeView(items: { file: { path: string } }[]): {
    getSortedFolderItems: (f: unknown) => { file?: { path?: string } }[];
    sort: () => void;
    requestSort: () => void;
  } {
    return { getSortedFolderItems: () => items, sort: () => undefined, requestSort: () => undefined };
  }

  /** An item the input never contained — a substitution, or a fabrication. */
  const foreign = { file: { path: "Projects/Work/Overview.md" } };

  it("still rejects an out-of-input item when no predicate is supplied", () => {
    // The existing contract, unchanged. This is the regression that matters:
    // adding the parameter must not weaken the default.
    const view = makeView([{ file: { path: "A.md" } }]);
    patch(view, () => [foreign]);
    expect(pathsOf(view.getSortedFolderItems(folder("/")))).toEqual(["A.md"]);
  });

  it("permits an out-of-input item the predicate accepts", () => {
    const view = makeView([{ file: { path: "A.md" } }]);
    patch(view, () => [foreign], (_folderPath, itemPath) =>
      itemPath === "Projects/Work/Overview.md"
    );
    expect(pathsOf(view.getSortedFolderItems(folder("/")))).toEqual([
      "Projects/Work/Overview.md",
    ]);
  });

  it("rejects the whole output when ONE item is not permitted", () => {
    // All-or-nothing, like the subset rule: a partially honoured transform is
    // a tree that is subtly wrong, which is worse than one that is plainly
    // unfiltered.
    const ok = { file: { path: "Projects/Work/Overview.md" } };
    const bad = { file: { path: "Elsewhere/Nope.md" } };
    const view = makeView([{ file: { path: "A.md" } }]);
    patch(view, () => [ok, bad], (_f, p) => p === "Projects/Work/Overview.md");
    expect(pathsOf(view.getSortedFolderItems(folder("/")))).toEqual(["A.md"]);
  });

  it("still rejects a duplicate even when the predicate would permit it", () => {
    // Duplication is the other half of what the subset rule caught, and the
    // predicate must not become a way around it.
    const view = makeView([{ file: { path: "A.md" } }]);
    patch(view, () => [foreign, foreign], () => true);
    expect(pathsOf(view.getSortedFolderItems(folder("/")))).toEqual(["A.md"]);
  });

  it("still permits a plain subset of the input", () => {
    const a = { file: { path: "A.md" } };
    const b = { file: { path: "B.md" } };
    const view = makeView([a, b]);
    patch(view, () => [b], () => false);
    expect(pathsOf(view.getSortedFolderItems(folder("/")))).toEqual(["B.md"]);
  });
});
