// @vitest-environment jsdom
/**
 * The explorer context menu's creation items, in a folder space.
 *
 * Measured before this existed, in a space pinned to `Archive`: right-clicking
 * the EMPTY BODY of the file explorer fires `file-menu` with the vault root as
 * its target, and the menu's items create straight into that target —
 * `fileManager.createNewMarkdownFile("/")` and `createNewFolder("/")`, with
 * `getNewFileParent` called ZERO times. So the public-API redirect
 * (`newFileLocation.ts`) cannot reach this path: it hooks a method the menu
 * never asks.
 *
 * Right-clicking a real folder row is already correct — the target is that
 * folder and the file lands inside it (measured: `Archive/Sub/Untitled.md`).
 * These tests pin that it stays correct, because the whole risk of this patch
 * is over-reaching.
 *
 * `jsdom` because the missing-root path raises a `Notice`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import type { App } from "obsidian";
import { TFolder, noticeLog } from "./helpers/obsidian-stub";
import { installNativeCreateRedirect } from "../src/actions/nativeNewFileParent";

interface Calls {
  markdown: Array<{ parent: string; rest: unknown[] }>;
  folder: Array<{ parent: string; rest: unknown[] }>;
}

function fakeApp(o: { folders: string[] }): { app: App; calls: Calls } {
  const folders = new Map<string, TFolder>();
  for (const p of o.folders) {
    const f = new TFolder();
    f.path = p;
    folders.set(p, f);
  }
  const vaultRoot = new TFolder();
  vaultRoot.path = "/";
  const calls: Calls = { markdown: [], folder: [] };

  const app = {
    vault: {
      getAbstractFileByPath: (p: string) => (p === "/" ? vaultRoot : (folders.get(p) ?? null)),
    },
    fileManager: {
      createNewMarkdownFile: (parent: TFolder, ...rest: unknown[]) => {
        calls.markdown.push({ parent: parent.path, rest });
        return Promise.resolve("made-a-note");
      },
      createNewFolder: (parent: TFolder, ...rest: unknown[]) => {
        calls.folder.push({ parent: parent.path, rest });
        return Promise.resolve("made-a-folder");
      },
    },
  } as unknown as App;
  return { app, calls };
}

/** The vault root as Obsidian hands it over: a real TFolder whose path is "/". */
const vaultRootOf = (app: App): TFolder =>
  app.vault.getAbstractFileByPath("/") as unknown as TFolder;

beforeEach(() => {
  for (const n of noticeLog) n.__destroy();
  noticeLog.length = 0;
});

describe("installNativeCreateRedirect", () => {
  it("sends a vault-root note into the pinned folder", () => {
    const { app, calls } = fakeApp({ folders: ["Archive"] });
    installNativeCreateRedirect(app, () => "Archive");
    void (app.fileManager as never as { createNewMarkdownFile: (p: TFolder) => void })
      .createNewMarkdownFile(vaultRootOf(app));
    expect(calls.markdown.map((c) => c.parent)).toEqual(["Archive"]);
  });

  it("sends a vault-root folder into the pinned folder", () => {
    const { app, calls } = fakeApp({ folders: ["Archive"] });
    installNativeCreateRedirect(app, () => "Archive");
    void (app.fileManager as never as { createNewFolder: (p: TFolder) => void })
      .createNewFolder(vaultRootOf(app));
    expect(calls.folder.map((c) => c.parent)).toEqual(["Archive"]);
  });

  it("treats the empty-string spelling of the vault root the same", () => {
    // `""` and `"/"` are the same missing/whole-vault state, and
    // `isVaultRoot` is the one authority on that. Obsidian hands over `/`
    // at this seam today; agreeing with the rest of the plugin costs nothing
    // and means one spelling cannot slip past.
    const { app, calls } = fakeApp({ folders: ["Archive"] });
    installNativeCreateRedirect(app, () => "Archive");
    const empty = new TFolder();
    empty.path = "";
    void (app.fileManager as never as { createNewFolder: (p: TFolder) => void })
      .createNewFolder(empty);
    expect(calls.folder.map((c) => c.parent)).toEqual(["Archive"]);
  });

  /**
   * The behaviour this patch must NOT break, and the whole reason its
   * condition is "the parent IS the vault root" rather than "a folder space is
   * active". Right-clicking a real folder row already creates inside it, which
   * is correct and is what a user expects from that gesture.
   */
  it("leaves a real folder target alone", () => {
    const { app, calls } = fakeApp({ folders: ["Archive", "Archive/Sub"] });
    installNativeCreateRedirect(app, () => "Archive");
    const sub = app.vault.getAbstractFileByPath("Archive/Sub") as unknown as TFolder;
    void (app.fileManager as never as { createNewMarkdownFile: (p: TFolder) => void })
      .createNewMarkdownFile(sub);
    expect(calls.markdown.map((c) => c.parent)).toEqual(["Archive/Sub"]);
  });

  it("leaves everything alone when no folder space is active", () => {
    const { app, calls } = fakeApp({ folders: ["Archive"] });
    installNativeCreateRedirect(app, () => null);
    void (app.fileManager as never as { createNewMarkdownFile: (p: TFolder) => void })
      .createNewMarkdownFile(vaultRootOf(app));
    expect(calls.markdown.map((c) => c.parent)).toEqual(["/"]);
  });

  it("resolves the root per call, not at install time", () => {
    // The patch outlives every space switch.
    const { app, calls } = fakeApp({ folders: ["Archive", "Projects"] });
    let root: string | null = "Archive";
    installNativeCreateRedirect(app, () => root);
    const create = (app.fileManager as never as { createNewFolder: (p: TFolder) => void })
      .createNewFolder;
    void create.call(app.fileManager, vaultRootOf(app));
    root = "Projects";
    void create.call(app.fileManager, vaultRootOf(app));
    root = null;
    void create.call(app.fileManager, vaultRootOf(app));
    expect(calls.folder.map((c) => c.parent)).toEqual(["Archive", "Projects", "/"]);
  });

  it("falls back, with a notice, when the pinned folder has vanished", () => {
    const { app, calls } = fakeApp({ folders: [] });
    installNativeCreateRedirect(app, () => "Archive/Gone");
    void (app.fileManager as never as { createNewMarkdownFile: (p: TFolder) => void })
      .createNewMarkdownFile(vaultRootOf(app));
    expect(calls.markdown.map((c) => c.parent)).toEqual(["/"]);
    expect(noticeLog.map((n) => n.message).join(" ")).toContain("missing");
  });

  it("passes every other argument through untouched", () => {
    // The real signatures are undocumented and may take a basename or more.
    // Only the parent is ours to change; anything else must arrive as sent, or
    // this patch silently breaks a caller it does not understand.
    const { app, calls } = fakeApp({ folders: ["Archive"] });
    installNativeCreateRedirect(app, () => "Archive");
    void (
      app.fileManager as never as {
        createNewMarkdownFile: (p: TFolder, a: string, b: number) => void;
      }
    ).createNewMarkdownFile(vaultRootOf(app), "Basename", 7);
    expect(calls.markdown[0].rest).toEqual(["Basename", 7]);
  });

  it("returns what the original returned", () => {
    const { app } = fakeApp({ folders: ["Archive"] });
    installNativeCreateRedirect(app, () => "Archive");
    const out = (
      app.fileManager as never as {
        createNewMarkdownFile: (p: TFolder) => Promise<string>;
      }
    ).createNewMarkdownFile(vaultRootOf(app));
    return expect(out).resolves.toBe("made-a-note");
  });

  describe("teardown", () => {
    it("restores both methods", () => {
      const { app } = fakeApp({ folders: ["Archive"] });
      const fm = app.fileManager as never as Record<string, unknown>;
      const before = { md: fm.createNewMarkdownFile, folder: fm.createNewFolder };
      const restore = installNativeCreateRedirect(app, () => "Archive");
      expect(fm.createNewMarkdownFile).not.toBe(before.md);
      restore();
      expect(fm.createNewMarkdownFile).toBe(before.md);
      expect(fm.createNewFolder).toBe(before.folder);
    });

    it("does not stack when installed twice", () => {
      const { app } = fakeApp({ folders: ["Archive"] });
      const fm = app.fileManager as never as Record<string, unknown>;
      const original = fm.createNewFolder;
      installNativeCreateRedirect(app, () => "Archive");
      const restore = installNativeCreateRedirect(app, () => "Archive");
      restore();
      expect(fm.createNewFolder).toBe(original);
    });

    it("leaves a later plugin's patch in place", () => {
      // Same rule as `nativeExplorerSort.unpatch`: restoring over someone
      // else's wrapper would silently uninstall their feature.
      const { app } = fakeApp({ folders: ["Archive"] });
      const fm = app.fileManager as never as Record<string, unknown>;
      const restore = installNativeCreateRedirect(app, () => "Archive");
      const theirs = (): string => "theirs";
      fm.createNewMarkdownFile = theirs;
      restore();
      expect(fm.createNewMarkdownFile).toBe(theirs);
    });

    it("survives a host that never had the methods", () => {
      // They are undocumented, so a future Obsidian may simply not have them.
      // Patching must degrade to doing nothing rather than throwing on load.
      const app = { vault: {}, fileManager: {} } as unknown as App;
      expect(() => installNativeCreateRedirect(app, () => "Archive")()).not.toThrow();
    });
  });
});
