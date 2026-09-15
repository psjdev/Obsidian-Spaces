import { describe, expect, it, vi } from "vitest";
import { RuntimeStateStore } from "../src/runtime/RuntimeStateStore";

function mem(initial: Record<string, unknown> = {}) {
  const data = { ...initial };
  return {
    get: (k: string) => (k in data ? data[k] : null),
    set: (k: string, v: unknown) => {
      data[k] = v;
    },
    peek: () => data,
  };
}

describe("RuntimeStateStore", () => {
  it("defaults to All when nothing is stored", () => {
    const s = new RuntimeStateStore(mem());
    s.load();
    expect(s.getSelection()).toEqual({ kind: "all" });
  });

  it("round-trips a space selection", () => {
    const backing = mem();
    const a = new RuntimeStateStore(backing);
    a.load();
    a.setSelection({ kind: "space", id: "research" });

    const b = new RuntimeStateStore(backing);
    b.load();
    expect(b.getSelection()).toEqual({ kind: "space", id: "research" });
  });

  it("reads state left under the pre-rename key", () => {
    const s = new RuntimeStateStore(
      mem({ "spacejam:runtime": { activeSelection: { kind: "space", id: "research" } } })
    );
    s.load();
    expect(s.getSelection()).toEqual({ kind: "space", id: "research" });
  });

  it("prefers the current key when both are present", () => {
    const s = new RuntimeStateStore(
      mem({
        "spaces:runtime": { activeSelection: { kind: "space", id: "current" } },
        "spacejam:runtime": { activeSelection: { kind: "space", id: "stale" } },
      })
    );
    s.load();
    expect(s.getSelection()).toEqual({ kind: "space", id: "current" });
  });

  it("writes only under the current key, leaving the old one untouched", () => {
    const backing = mem({
      "spacejam:runtime": { activeSelection: { kind: "space", id: "research" } },
    });
    const s = new RuntimeStateStore(backing);
    s.load();
    s.setSelection({ kind: "all" });
    expect(backing.peek()["spacejam:runtime"]).toEqual({
      activeSelection: { kind: "space", id: "research" },
    });
    expect(backing.peek()["spaces:runtime"]).toBeTruthy();
  });

  it("falls back to All on corrupt stored state", () => {
    const s = new RuntimeStateStore(mem({ "spaces:runtime": { nope: 1 } }));
    s.load();
    expect(s.getSelection()).toEqual({ kind: "all" });
  });

  it("falls back to All when the backing store throws", () => {
    const s = new RuntimeStateStore({
      get: () => {
        throw new Error("private mode");
      },
      set: () => undefined,
    });
    s.load();
    expect(s.getSelection()).toEqual({ kind: "all" });
  });

  it("says so when load() falls open, instead of failing silently", () => {
    // The fail-open philosophy is applied consistently for CORRECTNESS
    // and not for DIAGNOSABILITY. This catch was the last fully silent one —
    // a user whose selection, layouts and sort overrides all reset at startup
    // had nothing anywhere to explain it, while `DefinitionStore.load()`'s
    // equivalent already warns.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const s = new RuntimeStateStore({
        get: () => {
          throw new Error("private mode");
        },
        set: () => undefined,
      });
      s.load();
      expect(spy).toHaveBeenCalledTimes(1);
      expect(String(spy.mock.calls[0][0])).toMatch(/^Spaces: /);
      // The error itself is passed through, not flattened into a string —
      // a stack is what makes "private mode" actionable.
      expect(spy.mock.calls[0][1]).toBeInstanceOf(Error);
    } finally {
      spy.mockRestore();
    }
  });

  it("logs nothing on a normal load", () => {
    // Discriminates against a log placed outside the catch: this runs on every
    // startup, and an unconditional console.error would be noise the user
    // learns to ignore.
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      new RuntimeStateStore(mem()).load();
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  it("round-trips a layout for a named space", () => {
    const backing = mem();
    const a = new RuntimeStateStore(backing);
    a.load();
    a.setLayoutFor({ kind: "space", id: "research" }, { main: "R" });

    const b = new RuntimeStateStore(backing);
    b.load();
    expect(b.getLayoutFor({ kind: "space", id: "research" })).toEqual({ main: "R" });
  });

  it("stores All's layout in its own slot, not under a space id", () => {
    const backing = mem();
    const s = new RuntimeStateStore(backing);
    s.load();
    s.setLayoutFor({ kind: "all" }, { main: "ALL" });
    s.setLayoutFor({ kind: "space", id: "all" }, { main: "SPACE-NAMED-ALL" });

    expect(s.getLayoutFor({ kind: "all" })).toEqual({ main: "ALL" });
    expect(s.getLayoutFor({ kind: "space", id: "all" })).toEqual({
      main: "SPACE-NAMED-ALL",
    });
  });

  it("returns null for a space with no stored layout", () => {
    const s = new RuntimeStateStore(mem());
    s.load();
    expect(s.getLayoutFor({ kind: "space", id: "nope" })).toBeNull();
    expect(s.getLayoutFor({ kind: "all" })).toBeNull();
  });

  it("drops a space's layout without touching others or All", () => {
    const s = new RuntimeStateStore(mem());
    s.load();
    s.setLayoutFor({ kind: "all" }, { main: "ALL" });
    s.setLayoutFor({ kind: "space", id: "a" }, { main: "A" });
    s.setLayoutFor({ kind: "space", id: "b" }, { main: "B" });

    s.dropLayoutFor("a");

    expect(s.getLayoutFor({ kind: "space", id: "a" })).toBeNull();
    expect(s.getLayoutFor({ kind: "space", id: "b" })).toEqual({ main: "B" });
    expect(s.getLayoutFor({ kind: "all" })).toEqual({ main: "ALL" });
  });

  it("ignores a corrupt layouts map rather than throwing", () => {
    const s = new RuntimeStateStore(
      mem({ "spaces:runtime": { activeSelection: { kind: "all" }, layoutsBySpaceId: 42 } })
    );
    s.load();
    expect(s.getLayoutFor({ kind: "space", id: "x" })).toBeNull();
    expect(s.getSelection()).toEqual({ kind: "all" });
  });

  it("tolerates a throwing backing on layout write", () => {
    const s = new RuntimeStateStore({
      get: () => null,
      set: () => {
        throw new Error("quota");
      },
    });
    s.load();
    expect(() => s.setLayoutFor({ kind: "all" }, { main: "X" })).not.toThrow();
  });

  it("invokes onWriteError when persist() fails (finding 6)", () => {
    const onWriteError = vi.fn();
    const s = new RuntimeStateStore(
      {
        get: () => null,
        set: () => {
          throw new Error("quota");
        },
      },
      onWriteError
    );
    s.load();
    s.setSelection({ kind: "all" });
    expect(onWriteError).toHaveBeenCalledTimes(1);
    expect(onWriteError.mock.calls[0][0]).toBeInstanceOf(Error);
  });

  it("does not call onWriteError when persist() succeeds", () => {
    const onWriteError = vi.fn();
    const s = new RuntimeStateStore(mem(), onWriteError);
    s.load();
    s.setSelection({ kind: "space", id: "x" });
    expect(onWriteError).not.toHaveBeenCalled();
  });

  it("reconcileLayouts drops layouts for unknown space ids", () => {
    const backing = mem();
    const s = new RuntimeStateStore(backing);
    s.load();
    s.setLayoutFor({ kind: "space", id: "a" }, { main: "A" });
    s.setLayoutFor({ kind: "space", id: "b" }, { main: "B" });

    s.reconcileLayouts(["a"]);

    expect(s.getLayoutFor({ kind: "space", id: "a" })).toEqual({ main: "A" });
    expect(s.getLayoutFor({ kind: "space", id: "b" })).toBeNull();
  });

  it("reconcileLayouts never drops All's layout", () => {
    const s = new RuntimeStateStore(mem());
    s.load();
    s.setLayoutFor({ kind: "all" }, { main: "ALL" });
    s.setLayoutFor({ kind: "space", id: "a" }, { main: "A" });

    s.reconcileLayouts([]);

    expect(s.getLayoutFor({ kind: "all" })).toEqual({ main: "ALL" });
    expect(s.getLayoutFor({ kind: "space", id: "a" })).toBeNull();
  });

  it("reconcileLayouts is a no-op (and does not persist) when nothing is orphaned", () => {
    const sets: unknown[] = [];
    const s = new RuntimeStateStore({
      get: () => null,
      set: (_k, v) => {
        sets.push(v);
      },
    });
    s.load();
    s.setLayoutFor({ kind: "space", id: "a" }, { main: "A" });
    sets.length = 0;

    s.reconcileLayouts(["a"]);

    expect(sets).toHaveLength(0);
  });
});

// `mem(initial?)` is the existing helper at the top of this file: a backing
// store over a plain object, optionally seeded. KEY is "spaces:runtime".
describe("sort overrides (spec 22.2)", () => {
  it("defaults to nothing overridden", () => {
    const s = new RuntimeStateStore(mem());
    s.load();
    expect(s.getSortOverrides()).toEqual({ all: false, bySpaceId: {} });
  });

  it("round-trips a space override through persistence", () => {
    const backing = mem();
    const a = new RuntimeStateStore(backing);
    a.load();
    a.setSortOverride({ kind: "space", id: "work" }, true);
    const b = new RuntimeStateStore(backing);
    b.load();
    expect(b.getSortOverrides()).toEqual({ all: false, bySpaceId: { work: true } });
  });

  it("round-trips All separately from a space called all", () => {
    const backing = mem();
    const a = new RuntimeStateStore(backing);
    a.load();
    a.setSortOverride({ kind: "all" }, true);
    const b = new RuntimeStateStore(backing);
    b.load();
    expect(b.getSortOverrides()).toEqual({ all: true, bySpaceId: {} });
  });

  it("survives a malformed stored value by reporting nothing overridden", () => {
    // Runtime state fails open. A hand-edited file must not throw here.
    const s = new RuntimeStateStore(
      mem({ "spaces:runtime": { nativeSortBySpaceId: "not an object", allNativeSort: 7 } })
    );
    s.load();
    expect(s.getSortOverrides()).toEqual({ all: false, bySpaceId: {} });
  });

  it("ignores non-boolean entries inside the map", () => {
    const s = new RuntimeStateStore(
      mem({ "spaces:runtime": { nativeSortBySpaceId: { work: true, lab: "yes", x: 1 } } })
    );
    s.load();
    expect(s.getSortOverrides().bySpaceId).toEqual({ work: true });
  });

  it("drops a deleted space's override the way it drops its layout", () => {
    const s = new RuntimeStateStore(mem());
    s.load();
    s.setSortOverride({ kind: "space", id: "work" }, true);
    s.dropSortOverrideFor("work");
    expect(s.getSortOverrides().bySpaceId).toEqual({});
  });

  it("reconciles away an override for a space that no longer exists", () => {
    // The hand-edited-data.json case `reconcileLayouts` already guards.
    const s = new RuntimeStateStore(mem());
    s.load();
    s.setSortOverride({ kind: "space", id: "ghost" }, true);
    s.reconcileLayouts(["work"]);
    expect(s.getSortOverrides().bySpaceId).toEqual({});
  });

  it("never reconciles away All's override, which is not a space id", () => {
    const s = new RuntimeStateStore(mem());
    s.load();
    s.setSortOverride({ kind: "all" }, true);
    s.reconcileLayouts([]);
    expect(s.getSortOverrides().all).toBe(true);
  });
});
