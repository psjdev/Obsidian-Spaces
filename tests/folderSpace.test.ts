/**
 * The folder-space decision, as a pure function.
 *
 * `makePermits` is the guard the seam enforces. It is the reason
 * `isAllowed`'s identity/subset rule does not have to be loosened (renamed
 * from `isAllowed`), so it is tested at least as hard as the rule
 * it stands beside: it must accept exactly the root's children and
 * the named elsewhere paths, and reject everything else — including a child of
 * a sibling folder, which is the shape a re-parenting bug would produce.
 */
import { describe, expect, it } from "vitest";
import {
  elsewhereOf,
  hasRoot,
  isFolderSpace,
  isVaultRoot,
  makePermits,
  parentPathOf,
  rootOf,
} from "../src/visibility/folderSpace";
import type { SpaceDefinition } from "../src/types";

const folderSpace = {
  id: "work", name: "Work", icon: "briefcase", color: "#5b5bff",
  root: "Projects/Work", members: [],
} as SpaceDefinition;

const curated = {
  id: "research", name: "Research", icon: "microscope", color: "#4ecdc4",
  members: [{ path: "Papers", kind: "folder" as const }],
} as SpaceDefinition;

describe("isFolderSpace / rootOf", () => {
  it("recognises a space with a root", () => {
    expect(isFolderSpace(folderSpace)).toBe(true);
    expect(rootOf(folderSpace)).toBe("Projects/Work");
  });

  it("does not recognise a curated space", () => {
    expect(isFolderSpace(curated)).toBe(false);
    expect(rootOf(curated)).toBeNull();
  });

  it("treats All (null) as not a folder space", () => {
    expect(isFolderSpace(null)).toBe(false);
    expect(rootOf(null)).toBeNull();
  });

  it("treats an empty or vault-root root as absent", () => {
    // The schema refuses these, but a folder space is also the missing-root
    // state when its root cannot be honoured, and this is the single place
    // that decides it. Returning "/" here would hoist the whole vault.
    for (const root of ["", "/"]) {
      expect(rootOf({ ...folderSpace, root }), root).toBeNull();
    }
  });
});

describe("hasRoot / isFolderSpace — the missing-root state", () => {
  // An unusable root (`""` or `"/"`) is stored rather than the
  // space that declared it being deleted — the space is not deleted, and
  // its root string is
  // kept. `rootOf` collapses that case and "no root at all" to the same
  // null, which is exactly the ambiguity the runtime must not have: a space
  // that DECLARED a root it cannot use is still a folder space — it owes the
  // user the empty state and a repair path, not a silent fall-through to
  // rendering as an empty curated space.
  it("a declared-but-unusable root is still a folder space", () => {
    const missingRoot = { ...folderSpace, root: "" } as SpaceDefinition;
    expect(hasRoot(missingRoot)).toBe(true);
    expect(isFolderSpace(missingRoot)).toBe(true);
    expect(rootOf(missingRoot)).toBeNull();
  });

  it("a curated space has no root at all", () => {
    expect(hasRoot(curated)).toBe(false);
    expect(isFolderSpace(curated)).toBe(false);
  });

  it("treats All (null/undefined) as having no root", () => {
    expect(hasRoot(null)).toBe(false);
    expect(hasRoot(undefined)).toBe(false);
  });
});

describe("isVaultRoot", () => {
  it("accepts both spellings Obsidian and storage use", () => {
    // Obsidian's root folder path is "/"; storage uses "".
    expect(isVaultRoot("/")).toBe(true);
    expect(isVaultRoot("")).toBe(true);
  });

  it("rejects a real folder", () => {
    expect(isVaultRoot("Projects")).toBe(false);
    expect(isVaultRoot("Projects/Work")).toBe(false);
  });
});

describe("parentPathOf", () => {
  it("returns the containing folder", () => {
    expect(parentPathOf("Projects/Work/Notes.md")).toBe("Projects/Work");
    expect(parentPathOf("Projects/Work")).toBe("Projects");
  });

  it("returns the empty string for a top-level path", () => {
    expect(parentPathOf("Notes.md")).toBe("");
  });
});

describe("makePermits — the seam's guard", () => {
  const permits = makePermits("Projects/Work", new Set(["Inbox/Note.md"]));

  it("permits a direct child of the root, at the vault root", () => {
    expect(permits("/", "Projects/Work/Overview.md")).toBe(true);
    expect(permits("/", "Projects/Work/Hardware")).toBe(true);
  });

  it("permits a named elsewhere path, at the vault root", () => {
    expect(permits("/", "Inbox/Note.md")).toBe(true);
  });

  it("refuses a GRANDCHILD of the root", () => {
    // Only the root's direct children are hoisted; a grandchild belongs to a
    // folder Obsidian will ask about separately, and admitting it here would
    // render it twice.
    expect(permits("/", "Projects/Work/Hardware/Board.md")).toBe(false);
  });

  it("refuses a child of a sibling folder", () => {
    // The shape a re-parenting bug produces.
    expect(permits("/", "Projects/Other/Thing.md")).toBe(false);
  });

  it("refuses the root itself", () => {
    expect(permits("/", "Projects/Work")).toBe(false);
  });

  it("refuses an unnamed elsewhere path", () => {
    expect(permits("/", "Archive/Old.md")).toBe(false);
  });

  it("refuses an item with no path at all", () => {
    expect(permits("/", undefined)).toBe(false);
  });

  it("permits nothing at any folder other than the vault root", () => {
    // Substitution happens only at the vault root. Everywhere else the
    // subset rule stands alone.
    expect(permits("Projects/Work", "Projects/Work/Overview.md")).toBe(false);
    expect(permits("Projects/Work/Hardware", "Inbox/Note.md")).toBe(false);
  });
});

describe("elsewhereOf", () => {
  const root = "Projects/Work";

  it("returns open paths that are outside the root", () => {
    const live = new Set(["Inbox/Note.md", "Projects/Work/Overview.md"]);
    expect(elsewhereOf(root, live)).toEqual(["Inbox/Note.md"]);
  });

  it("excludes anything under the root, at any depth", () => {
    const live = new Set([
      "Projects/Work/Overview.md",
      "Projects/Work/Hardware/Board.md",
    ]);
    expect(elsewhereOf(root, live)).toEqual([]);
  });

  it("excludes the root itself", () => {
    expect(elsewhereOf(root, new Set([root]))).toEqual([]);
  });

  it("does NOT treat a sibling with the root as a prefix as inside", () => {
    // "Projects/Workshop" starts with "Projects/Work" as a string but is not
    // under it. Prefix matching without the separator is the classic bug here.
    expect(elsewhereOf(root, new Set(["Projects/Workshop/Plan.md"]))).toEqual([
      "Projects/Workshop/Plan.md",
    ]);
  });

  it("sorts, so the group's order does not depend on open order", () => {
    const live = new Set(["Zed/Z.md", "Alpha/A.md"]);
    expect(elsewhereOf(root, live)).toEqual(["Alpha/A.md", "Zed/Z.md"]);
  });
});
