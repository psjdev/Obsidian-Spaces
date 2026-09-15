// @vitest-environment jsdom
/**
 * Where Obsidian's OWN "new note" gestures land while a folder space is
 * active.
 *
 * `destinationFolder` (creation.ts) already answered this for spaces's two
 * commands, but those live in the command palette — the affordances people
 * actually use (Ctrl+N, the ribbon, the explorer's New note button) all ask
 * `fileManager.getNewFileParent`, which knows nothing about spaces. Measured
 * in the fixture before this was built: in a folder space rooted at
 * `Archive`, the explorer's New note button produced `Untitled 1.md` at the
 * VAULT ROOT, invisible in the space the user was standing in.
 *
 * This patches that one public method (`@public`, `@since 1.1.13` — it is
 * not part of the private-API quarantine) and delegates the decision to
 * `pinnedDestination`, the policy `destinationFolder` also uses, so there is
 * one rule rather than two that can drift. It asks the POLICY rather than
 * `destinationFolder` itself because that function's fallback is
 * `getNewFileParent` — the method being patched — and the first version of
 * this recursed until the stack blew. See the "re-entry" block at the end.
 *
 * `jsdom` for the same reason as `creation.test.ts`: the missing-root path
 * goes through `new Notice(...)`, which needs a document.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { TFolder, noticeLog } from "./helpers/obsidian-stub";
import { installNewFileRedirect } from "../src/actions/newFileLocation";

/**
 * The slice this patch reads, the same shape `creation.test.ts` builds: the
 * vault to resolve a path to a folder, and the file manager whose method is
 * being replaced. `fallbackParent` is a distinct identity so a test can never
 * pass by coincidence.
 */
function fakeApp(o: { folders: string[] }): App {
  const folders = new Map<string, TFolder>();
  for (const p of o.folders) {
    const f = new TFolder();
    f.path = p;
    folders.set(p, f);
  }
  const fallbackParent = new TFolder();
  fallbackParent.path = "";
  const rootFolder = new TFolder();
  rootFolder.path = "/";

  return {
    vault: {
      getAbstractFileByPath: (p: string) => (p === "/" ? rootFolder : (folders.get(p) ?? null)),
    },
    fileManager: {
      getNewFileParent: (_sourcePath: string) => fallbackParent,
    },
  } as unknown as App;
}

const parentPath = (app: App, source = ""): string =>
  app.fileManager.getNewFileParent(source).path;

beforeEach(() => {
  for (const n of noticeLog) n.__destroy();
  noticeLog.length = 0;
});

describe("installNewFileRedirect", () => {
  it("sends a new file into the active folder space's root", () => {
    const app = fakeApp({ folders: ["Archive"] });
    installNewFileRedirect(app, () => "Archive");
    expect(parentPath(app)).toBe("Archive");
  });

  it("leaves Obsidian's own answer alone when no folder space is active", () => {
    // Curated spaces and All keep the user's configured default location —
    // a curated space has no single "here" to write into.
    const app = fakeApp({ folders: ["Archive"] });
    const before = parentPath(app);
    installNewFileRedirect(app, () => null);
    expect(parentPath(app)).toBe(before);
  });

  /**
   * The trap this feature shares with the explorer seam: the patch
   * outlives a space switch, so anything it consults must be resolved PER
   * CALL. A captured root would go on writing into the folder the user used
   * to be in — silently, and into a real vault.
   */
  it("resolves the root per call, not at install time", () => {
    const app = fakeApp({ folders: ["Archive", "Projects"] });
    let root: string | null = "Archive";
    installNewFileRedirect(app, () => root);
    expect(parentPath(app)).toBe("Archive");
    root = "Projects";
    expect(parentPath(app)).toBe("Projects");
    root = null;
    expect(parentPath(app)).toBe("");
  });

  it("returns a real folder object, not a path-shaped stand-in", () => {
    // The method's contract is `TFolder`, and callers do more with it than
    // read `.path` — `fileManager.createNewFile(parent, …)` takes the object
    // itself. Returning a literal would satisfy every assertion about paths
    // and still break the callers this feature exists to serve.
    const app = fakeApp({ folders: ["Archive"] });
    installNewFileRedirect(app, () => "Archive");
    const out = app.fileManager.getNewFileParent("");
    expect(out).toBeInstanceOf(TFolder);
    expect(out).toBe(app.vault.getAbstractFileByPath("Archive"));
  });

  it("falls back, with a notice, when the pinned folder has vanished", () => {
    // Delegated to `destinationFolder`, which owns this policy (the
    // missing-root state) — asserted here so the delegation cannot be quietly
    // dropped in favour of a second rule.
    const app = fakeApp({ folders: [] });
    installNewFileRedirect(app, () => "Archive/Gone");
    expect(parentPath(app)).toBe("");
    expect(noticeLog.map((n) => n.message).join(" ")).toContain("missing");
  });

  it("passes the source path through to Obsidian's own resolution", () => {
    // "Same folder as current file" is one of Obsidian's default-location
    // modes, and it reads the source path. Dropping the argument would
    // silently change that behaviour for everyone not in a folder space.
    const seen: string[] = [];
    const app = fakeApp({ folders: [] });
    const parent = new TFolder();
    parent.path = "seen";
    app.fileManager.getNewFileParent = ((source: string) => {
      seen.push(source);
      return parent;
    }) as App["fileManager"]["getNewFileParent"];
    installNewFileRedirect(app, () => null);
    app.fileManager.getNewFileParent("Notes/today.md");
    expect(seen).toEqual(["Notes/today.md"]);
  });

  describe("teardown", () => {
    it("restores the original method", () => {
      // The plugin must leave the host exactly as it found it.
      const app = fakeApp({ folders: ["Archive"] });
      const original = app.fileManager.getNewFileParent;
      const restore = installNewFileRedirect(app, () => "Archive");
      expect(app.fileManager.getNewFileParent).not.toBe(original);
      restore();
      expect(app.fileManager.getNewFileParent).toBe(original);
      expect(parentPath(app)).toBe("");
    });

    it("goes inert when our wrapper cannot be lifted back out", () => {
      // A plugin that patches AFTER us owns the property, so restore() must
      // leave theirs alone. It used to leave OURS buried and still running:
      // a disabled Spaces went on redirecting every new file into the last
      // active space's folder until Obsidian restarted.
      const app = fakeApp({ folders: ["Archive"] });
      const original = app.fileManager.getNewFileParent;
      const restore = installNewFileRedirect(app, () => "Archive");
      const ours = app.fileManager.getNewFileParent;

      // Someone else wraps us.
      const theirs = ((source: string, newPath?: string) =>
        ours.call(app.fileManager, source, newPath)) as typeof ours;
      app.fileManager.getNewFileParent = theirs;

      restore();

      // Theirs is untouched, and ours no longer redirects through it.
      expect(app.fileManager.getNewFileParent).toBe(theirs);
      expect(parentPath(app)).toBe("");
      expect(original).not.toBe(ours);
    });

    it("does not stack when installed twice", () => {
      // `bindExplorer` runs many times, and the click listener beside this one
      // already had to be hoisted out of it for exactly this reason. Two
      // wrappers would make one `restore()` reveal the other rather than the
      // original.
      const app = fakeApp({ folders: ["Archive"] });
      const original = app.fileManager.getNewFileParent;
      installNewFileRedirect(app, () => "Archive");
      const restore = installNewFileRedirect(app, () => "Archive");
      restore();
      expect(app.fileManager.getNewFileParent).toBe(original);
    });

    it("survives being restored twice", () => {
      const app = fakeApp({ folders: ["Archive"] });
      const original = app.fileManager.getNewFileParent;
      const restore = installNewFileRedirect(app, () => "Archive");
      restore();
      restore();
      expect(app.fileManager.getNewFileParent).toBe(original);
    });

    /**
     * If another plugin patched the same method after us, our wrapper is no
     * longer the installed one. Restoring the original would silently
     * uninstall their feature — the same rule `nativeExplorerSort.unpatch`
     * follows for the sort seam.
     */
    it("leaves a later plugin's patch in place", () => {
      const app = fakeApp({ folders: ["Archive"] });
      const restore = installNewFileRedirect(app, () => "Archive");
      const theirs = app.fileManager.getNewFileParent;
      const laterParent = new TFolder();
      laterParent.path = "theirs";
      const wrapped = ((source: string) => {
        theirs.call(app.fileManager, source);
        return laterParent;
      }) as App["fileManager"]["getNewFileParent"];
      app.fileManager.getNewFileParent = wrapped;
      restore();
      expect(app.fileManager.getNewFileParent).toBe(wrapped);
      expect(parentPath(app)).toBe("theirs");
    });
  });
});

describe("re-entry", () => {
  /**
   * The bug this pair of tests exists for, found by the missing-root case
   * above: the wrapper called `destinationFolder`, whose fallback is
   * `getNewFileParent` — the very method being patched. It recursed until the
   * stack blew, raising a Notice per cycle. The fix was to ask the policy
   * (`pinnedDestination`) with the fallback already in hand.
   */
  it("calls the original exactly once when the root is missing", () => {
    let calls = 0;
    const app = fakeApp({ folders: [] });
    const original = app.fileManager.getNewFileParent;
    app.fileManager.getNewFileParent = ((source: string, newPath?: string) => {
      calls += 1;
      return original.call(app.fileManager, source, newPath);
    }) as App["fileManager"]["getNewFileParent"];
    installNewFileRedirect(app, () => "Archive/Gone");
    app.fileManager.getNewFileParent("");
    expect(calls).toBe(1);
  });

  it("raises exactly one notice for one missing root", () => {
    const app = fakeApp({ folders: [] });
    installNewFileRedirect(app, () => "Archive/Gone");
    app.fileManager.getNewFileParent("");
    expect(noticeLog).toHaveLength(1);
  });
});
