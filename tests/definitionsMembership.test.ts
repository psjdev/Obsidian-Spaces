/**
 * `inheritedFromFolder` after the move out of `actions/membershipMenu.ts`.
 *
 * A move needs a different kind of evidence from a fix: that the symbol still
 * behaves the same, and that every previous importer still reaches the same
 * function object rather than a second copy. The predicate had no direct test
 * before — `spaceAddTargets.test.ts` and `memberList.test.ts` exercised it
 * only through their own callers — so these cases are new coverage as well as
 * move evidence.
 *
 * Layer 1: pure, no `obsidian`.
 */
import { describe, expect, it } from "vitest";
import { inheritedFromFolder } from "../src/definitions/membership";
import { inheritedFromFolder as viaMembershipMenu } from "../src/actions/membershipMenu";
import type { SpaceDefinition } from "../src/types";

function space(members: SpaceDefinition["members"]): SpaceDefinition {
  return { id: "s", name: "S", icon: "box", color: "#5b5bff", members };
}

describe("inheritedFromFolder", () => {
  it("returns the folder member that covers the path", () => {
    const s = space([{ path: "Projects", kind: "folder" }]);
    expect(inheritedFromFolder(s, "Projects/Console/notes.md")).toBe("Projects");
  });

  it("returns the INNERMOST covering folder when several nest", () => {
    // The innermost is the one that explains the row: naming "Projects" when
    // "Projects/Console" is also a member would send the user to the wrong
    // entry in Settings.
    const s = space([
      { path: "Projects", kind: "folder" },
      { path: "Projects/Console", kind: "folder" },
    ]);
    expect(inheritedFromFolder(s, "Projects/Console/notes.md")).toBe("Projects/Console");
  });

  it("ignores a FILE member with the same path as an ancestor segment", () => {
    // Only folder members confer inheritance; a file member named
    // "Projects" is not a folder and covers nothing below it.
    const s = space([{ path: "Projects", kind: "file" }]);
    expect(inheritedFromFolder(s, "Projects/notes.md")).toBeNull();
  });

  it("does not treat the path itself as its own covering folder", () => {
    const s = space([{ path: "Projects", kind: "folder" }]);
    expect(inheritedFromFolder(s, "Projects")).toBeNull();
  });

  it("returns null when nothing covers the path", () => {
    expect(inheritedFromFolder(space([]), "Inbox/today.md")).toBeNull();
  });

  it("does not match a sibling folder that merely shares a name prefix", () => {
    // "Projects2" is not an ancestor of "Projects/notes.md", and a prefix
    // comparison rather than a segment walk would say it is.
    const s = space([{ path: "Projects2", kind: "folder" }]);
    expect(inheritedFromFolder(s, "Projects/notes.md")).toBeNull();
  });

  it("is the same function object the old import path still hands out", () => {
    // The re-export in `actions/membershipMenu.ts` is a compatibility shim for
    // the two importers owned by other branches. A second copy of the
    // predicate would let the two import paths silently diverge over time.
    expect(viaMembershipMenu).toBe(inheritedFromFolder);
  });
});
