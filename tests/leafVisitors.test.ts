import { describe, expect, it, vi } from "vitest";
import { livePathsFrom, type LeafProbe } from "../src/explorer/leafVisitors";

const S = (...p: string[]) => new Set(p);

/** Fake leaves are opaque tokens; the probe decides what each one means. */
function probeOf(
  loaded: Record<string, string>,
  deferred: Record<string, string>,
  real: string[]
): LeafProbe {
  return {
    fileViewPath: (leaf) => loaded[leaf as string] ?? null,
    stateFilePath: (leaf) => deferred[leaf as string] ?? null,
    resolveFilePath: (p) => (real.includes(p) ? p : null),
  };
}

describe("livePathsFrom", () => {
  it("takes a loaded FileView's path", () => {
    const p = probeOf({ L1: "a.md" }, {}, ["a.md"]);
    expect(livePathsFrom(["L1"], p)).toEqual(S("a.md"));
  });

  it("takes a deferred leaf's view-state path", () => {
    const p = probeOf({}, { L1: "b.md" }, ["b.md"]);
    expect(livePathsFrom(["L1"], p)).toEqual(S("b.md"));
  });

  it("prefers the loaded FileView path over the view state", () => {
    const p = probeOf({ L1: "loaded.md" }, { L1: "stale.md" }, ["loaded.md", "stale.md"]);
    expect(livePathsFrom(["L1"], p)).toEqual(S("loaded.md"));
  });

  it("ignores a leaf that is neither", () => {
    const p = probeOf({}, {}, []);
    expect(livePathsFrom(["L1"], p)).toEqual(S());
  });

  it("ignores a deferred path that does not resolve to a real file", () => {
    const p = probeOf({}, { L1: "deleted.md" }, []);
    expect(livePathsFrom(["L1"], p)).toEqual(S());
  });

  it("adds the RESOLVED path, not the raw view-state string", () => {
    const probe: LeafProbe = {
      fileViewPath: () => null,
      stateFilePath: () => "Folder/note",
      resolveFilePath: () => "Folder/note.md",
    };
    expect(livePathsFrom(["L1"], probe)).toEqual(S("Folder/note.md"));
  });

  it("one throwing leaf costs one row, not the walk", () => {
    const probe: LeafProbe = {
      fileViewPath: (leaf) => {
        if (leaf === "BAD") throw new Error("view torn down mid-restore");
        return leaf === "GOOD" ? "good.md" : null;
      },
      stateFilePath: () => null,
      resolveFilePath: (p) => p,
    };
    expect(livePathsFrom(["BAD", "GOOD"], probe)).toEqual(S("good.md"));
  });

  it("a throwing resolveFilePath also costs only that leaf", () => {
    const probe: LeafProbe = {
      fileViewPath: () => null,
      stateFilePath: (leaf) => (leaf === "BAD" ? "boom.md" : "ok.md"),
      resolveFilePath: (p) => {
        if (p === "boom.md") throw new Error("nope");
        return p;
      },
    };
    expect(livePathsFrom(["BAD", "OK"], probe)).toEqual(S("ok.md"));
  });

  it("de-duplicates two leaves on the same file", () => {
    const p = probeOf({ L1: "a.md", L2: "a.md" }, {}, ["a.md"]);
    expect(livePathsFrom(["L1", "L2"], p)).toEqual(S("a.md"));
  });

  it("returns an empty set for no leaves", () => {
    expect(livePathsFrom([], probeOf({}, {}, []))).toEqual(S());
  });

  it("does not consult the view state when a FileView path was found", () => {
    const stateFilePath = vi.fn(() => null);
    const probe: LeafProbe = {
      fileViewPath: () => "a.md",
      stateFilePath,
      resolveFilePath: (p) => p,
    };
    livePathsFrom(["L1"], probe);
    expect(stateFilePath).not.toHaveBeenCalled();
  });
});
