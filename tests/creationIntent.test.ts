import { describe, expect, it } from "vitest";
import { INTENT_TTL_MS, armIntent, matchIntent } from "../src/actions/creationIntent";

const T0 = 1_000_000;
const armed = (over: Partial<Parameters<typeof armIntent>[0]> = {}) =>
  armIntent({
    target: { path: "Projects", isFolder: true },
    activeSpaceId: "work",
    now: T0,
    ...over,
  });

const match = (over: Partial<Parameters<typeof matchIntent>[0]> = {}) =>
  matchIntent({
    intent: armed(),
    created: { path: "Projects/Untitled.md", parentPath: "Projects", isFolder: false },
    activeSpaceId: "work",
    now: T0 + 500,
    ...over,
  });

describe("armIntent", () => {
  it("arms on a folder while a space is active", () => {
    expect(armed()).toEqual({ folderPath: "Projects", spaceId: "work", expiresAt: T0 + INTENT_TTL_MS });
  });

  it("does not arm for a file — you cannot create inside a note", () => {
    expect(armed({ target: { path: "Projects/Note.md", isFolder: false } })).toBeNull();
  });

  it("does not arm in All, which has no membership to grant", () => {
    expect(armed({ activeSpaceId: null })).toBeNull();
  });

  it("arms on the vault root, which is what the empty explorer body reports", () => {
    // Measured: right-clicking below the tree fires file-menu with path "/".
    expect(armed({ target: { path: "/", isFolder: true } })?.folderPath).toBe("/");
  });
});

describe("matchIntent", () => {
  it("matches a direct child created in the armed folder", () => {
    expect(match()).toEqual({ spaceId: "work", path: "Projects/Untitled.md", kind: "file" });
  });

  it("matches a created FOLDER, not just a file", () => {
    // The whole reason this mechanism was chosen over content heuristics: a
    // folder has no size and never becomes the active file, but it does have
    // a parent.
    expect(
      match({ created: { path: "Projects/New folder", parentPath: "Projects", isFolder: true } })
    ).toEqual({ spaceId: "work", path: "Projects/New folder", kind: "folder" });
  });

  it("matches at the vault root", () => {
    expect(
      match({
        intent: armed({ target: { path: "/", isFolder: true } }),
        created: { path: "Untitled.md", parentPath: "/", isFolder: false },
      })
    ).toEqual({ spaceId: "work", path: "Untitled.md", kind: "file" });
  });

  it("does NOT match a grandchild — intent covers one folder, not a subtree", () => {
    // A template or importer that builds a nested tree under the armed folder
    // must not have every level join the space.
    expect(
      match({
        created: { path: "Projects/Sub/Deep.md", parentPath: "Projects/Sub", isFolder: false },
      })
    ).toBeNull();
  });

  it("does not match a sibling folder", () => {
    expect(
      match({ created: { path: "Archive/Untitled.md", parentPath: "Archive", isFolder: false } })
    ).toBeNull();
  });

  it("does not match after the window expires", () => {
    // The whole safety argument: a create arriving later (sync, a batch job)
    // is not attributable to the gesture.
    expect(match({ now: T0 + INTENT_TTL_MS + 1 })).toBeNull();
  });

  it("matches exactly at the expiry boundary", () => {
    expect(match({ now: T0 + INTENT_TTL_MS })).not.toBeNull();
  });

  it("does not match once the active space has changed", () => {
    // Switching spaces between the right-click and the create means the
    // gesture's space is no longer the one that would receive the member.
    expect(match({ activeSpaceId: "other" })).toBeNull();
  });

  it("does not match in All", () => {
    expect(match({ activeSpaceId: null })).toBeNull();
  });

  it("does nothing without an armed intent", () => {
    expect(match({ intent: null })).toBeNull();
  });

  it("survives a created path with no parent", () => {
    // The vault root's own TFolder has a null parent.
    expect(match({ created: { path: "/", parentPath: null, isFolder: true } })).toBeNull();
  });
});

