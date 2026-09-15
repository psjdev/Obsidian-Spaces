import { describe, expect, it } from "vitest";
import type { MemberKind } from "../src/types";
import type { VaultIndex } from "../src/visibility/VaultIndex";
import { createTreeVaultIndex, isUnder } from "../src/visibility/VaultIndex";

/**
 * The oracle: a linear-scan implementation of the same interface.
 * `createTreeVaultIndex` must be indistinguishable from it — same sets AND
 * same order, because the explorer's render order and the user's own
 * ordering both read `childrenOf`/`descendantsOf` positionally.
 */
function linearScanIndex(kinds: Map<string, MemberKind>): VaultIndex {
  const paths = [...kinds.keys()];
  return {
    exists: (p) => kinds.has(p),
    kindOf: (p) => kinds.get(p) ?? null,
    childrenOf: (p) =>
      paths.filter(
        (c) => isUnder(c, p) && !c.slice(p.length + 1).includes("/")
      ),
    descendantsOf: (p) => paths.filter((c) => isUnder(c, p)),
    allPaths: () => [...paths],
  };
}

/** Entries in the DFS pre-order that `ObsidianVaultIndex`'s walk() emits. */
const fixture = new Map<string, MemberKind>([
  ["Archive", "folder"],
  ["Archive/Old", "folder"],
  ["Archive/Old/Deep", "folder"],
  ["Archive/Old/Deep/Deeper", "folder"],
  ["Archive/Old/Deep/Deeper/Leaf.md", "file"],
  ["Archive/Old/Note.md", "file"],
  ["Empty", "folder"],
  ["Notes", "folder"],
  ["Notes/a.md", "file"],
  ["Notes/z.md", "file"],
  ["Notes/b", "folder"],
  ["Notes/b/inner.md", "file"],
  // A folder and a file sharing a stem, plus a prefix that is not a segment.
  ["Notes.md", "file"],
  ["Notes-old", "folder"],
  ["Notes-old/legacy.md", "file"],
  ["Recipes.md", "file"],
  ["z-last", "folder"],
]);

const probes = [
  "",
  "/",
  "Archive",
  "Archive/Old",
  "Archive/Old/Deep",
  "Archive/Old/Deep/Deeper",
  "Archive/Old/Deep/Deeper/Leaf.md",
  "Empty",
  "Notes",
  "Notes/b",
  "Notes/a.md",
  "Notes.md",
  "Notes-old",
  "Recipes.md",
  "z-last",
  "Nope",
  "Notes/nope",
  "Archive/Old/Deep/Deeper/Leaf.md/further",
];

describe("createTreeVaultIndex matches the linear-scan index it replaces", () => {
  const oracle = linearScanIndex(fixture);
  const tree = createTreeVaultIndex(new Map(fixture));

  it.each(probes)("childrenOf(%j) is identical, order included", (p) => {
    expect(tree.childrenOf(p)).toEqual(oracle.childrenOf(p));
  });

  it.each(probes)("descendantsOf(%j) is identical, order included", (p) => {
    expect(tree.descendantsOf(p)).toEqual(oracle.descendantsOf(p));
  });

  it("agrees on exists/kindOf/allPaths", () => {
    for (const p of [...probes, ...fixture.keys()]) {
      expect(tree.exists(p)).toBe(oracle.exists(p));
      expect(tree.kindOf(p)).toBe(oracle.kindOf(p));
    }
    expect(tree.allPaths()).toEqual(oracle.allPaths());
  });

  it("pins the exact order the explorer renders", () => {
    // Spelled out rather than compared, so a change to BOTH implementations
    // still trips this: DFS pre-order, siblings in vault order (a.md, z.md, b),
    // never sorted.
    expect(tree.childrenOf("Notes")).toEqual([
      "Notes/a.md",
      "Notes/z.md",
      "Notes/b",
    ]);
    expect(tree.descendantsOf("Notes")).toEqual([
      "Notes/a.md",
      "Notes/z.md",
      "Notes/b",
      "Notes/b/inner.md",
    ]);
    expect(tree.descendantsOf("Archive")).toEqual([
      "Archive/Old",
      "Archive/Old/Deep",
      "Archive/Old/Deep/Deeper",
      "Archive/Old/Deep/Deeper/Leaf.md",
      "Archive/Old/Note.md",
    ]);
    expect(tree.childrenOf("")).toEqual([
      "Archive",
      "Empty",
      "Notes",
      "Notes.md",
      "Notes-old",
      "Recipes.md",
      "z-last",
    ]);
    expect(tree.childrenOf("Empty")).toEqual([]);
    expect(tree.descendantsOf("Empty")).toEqual([]);
    // The vault root object is never an entry, so it answers as unknown.
    expect(tree.childrenOf("/")).toEqual([]);
    expect(tree.descendantsOf("/")).toEqual([]);
  });

  it("returns fresh arrays callers may mutate without corrupting the index", () => {
    const first = tree.childrenOf("Notes");
    first.push("Notes/injected.md");
    expect(tree.childrenOf("Notes")).toEqual([
      "Notes/a.md",
      "Notes/z.md",
      "Notes/b",
    ]);
  });

  it("tolerates an entry whose intermediate folders are absent", () => {
    // Not something walk() produces, but the oracle answers it, so the
    // replacement must too rather than silently dropping the subtree.
    const gappy = new Map<string, MemberKind>([
      ["a", "folder"],
      ["a/b/c.md", "file"],
      ["a/d.md", "file"],
    ]);
    const g = createTreeVaultIndex(new Map(gappy));
    const o = linearScanIndex(gappy);
    for (const p of ["", "a", "a/b", "a/b/c.md"]) {
      expect(g.childrenOf(p)).toEqual(o.childrenOf(p));
      expect(g.descendantsOf(p)).toEqual(o.descendantsOf(p));
    }
  });
});

describe("createTreeVaultIndex on a generated tree", () => {
  const kinds = new Map<string, MemberKind>();
  for (let t = 0; t < 4; t++) {
    const top = `T${t}`;
    kinds.set(top, "folder");
    for (let f = 0; f < 3; f++) kinds.set(`${top}/f${f}.md`, "file");
    for (let s = 0; s < 3; s++) {
      const sub = `${top}/s${s}`;
      kinds.set(sub, "folder");
      for (let f = 0; f < 3; f++) kinds.set(`${sub}/g${f}.md`, "file");
      for (let u = 0; u < 2; u++) {
        const leaf = `${sub}/u${u}`;
        kinds.set(leaf, "folder");
        kinds.set(`${leaf}/h.md`, "file");
      }
    }
  }
  const oracle = linearScanIndex(kinds);
  const tree = createTreeVaultIndex(new Map(kinds));

  it("agrees on every path in the tree, plus the root", () => {
    for (const p of ["", ...kinds.keys()]) {
      expect(tree.childrenOf(p)).toEqual(oracle.childrenOf(p));
      expect(tree.descendantsOf(p)).toEqual(oracle.descendantsOf(p));
    }
  });
});
