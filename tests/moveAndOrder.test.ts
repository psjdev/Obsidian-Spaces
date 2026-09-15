// @vitest-environment jsdom
/**
 * One gesture, one Notice.
 *
 * `moveAndOrder` handles the cross-folder drop: move first, order only what
 * landed. A failure path that raises `new Notice(...)` **inside the loop**,
 * with raw `String(e)` in the text, turns fifteen notes dragged into a folder
 * holding ten same-named files into ten stacked, developer-phrased toasts for
 * one drag.
 *
 * The codebase already knows the shape of the answer: `actions/membership.ts`
 * does the equivalent bulk operation and raises exactly one Notice for the
 * batch, and `reportLayoutOutcome`'s plain-language Notices are the register.
 * These tests pin that — and that the summary says how much of the gesture
 * actually happened rather than reporting only the parts that threw.
 *
 * Layer: a unit test. It runs against the `obsidian` stub,
 * so it is evidence about the method's own reporting, not about the real app's
 * toasts. What it buys is that the storm cannot come back in silence.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import SpacesPlugin from "../src/main";
import { DefinitionStore } from "../src/definitions/DefinitionStore";
import { RuntimeStateStore } from "../src/runtime/RuntimeStateStore";
import { noticeLog } from "./helpers/obsidian-stub";

/** The one shape `moveAndOrder` reads off a vault file: it needs the object identity. */
interface FakeFile {
  path: string;
}

function makePlugin(o: {
  files: string[];
  /** Destination paths whose rename rejects, and with what. */
  failing?: Record<string, string>;
}): { plugin: SpacesPlugin; renamed: Array<[string, string]> } {
  const files = new Map<string, FakeFile>(o.files.map((p) => [p, { path: p }]));
  const renamed: Array<[string, string]> = [];
  const app = {
    vault: {
      getAbstractFileByPath: (p: string): FakeFile | null => files.get(p) ?? null,
    },
    fileManager: {
      renameFile: async (f: FakeFile, dest: string): Promise<void> => {
        const why = o.failing?.[dest];
        if (why) throw new Error(why);
        renamed.push([f.path, dest]);
      },
    },
    // No explorer leaf: `explorerView()` answers null, `displayedPaths` is
    // never consulted, and `computeDrop` declines for want of a baseline. The
    // ordering half is `dropIntent.test.ts`'s subject, not this file's.
    // `containerEl` is what `explorerLeaves()` compares against to
    // exclude pop-out windows: it reads `workspace.containerEl.ownerDocument`
    // before filtering. Added by the merge arbiter — this fake predates
    // multi-leaf support and omitting it threw before the filter ran.
    workspace: {
      containerEl: document.createElement("div"),
      getLeavesOfType: (): unknown[] => [],
    },
  };
  const plugin = new SpacesPlugin(
    app as unknown as ConstructorParameters<typeof SpacesPlugin>[0],
    {} as ConstructorParameters<typeof SpacesPlugin>[1]
  );
  plugin["defs"] = new DefinitionStore({
    read: async () => undefined,
    write: async () => undefined,
  });
  const backing = new Map<string, unknown>();
  plugin["runtime"] = new RuntimeStateStore({
    get: (k) => backing.get(k),
    set: (k, v) => void backing.set(k, v),
  });
  return { plugin, renamed };
}

function moveAndOrder(plugin: SpacesPlugin, paths: string[]): Promise<void> {
  return plugin["moveAndOrder"](paths, "Dest", "after", "Dest/anchor.md");
}

function messages(): string[] {
  return noticeLog.map((n) => (typeof n.message === "string" ? n.message : "<fragment>"));
}

describe("SpacesPlugin.moveAndOrder — reporting a multi-file move", () => {
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    for (const n of noticeLog) n.__destroy();
    noticeLog.length = 0;
    errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    errors.mockRestore();
  });

  it("raises ONE Notice for a batch, however many files failed", async () => {
    const { plugin } = makePlugin({
      files: ["F/a.md", "F/b.md", "F/c.md"],
      failing: { "Dest/b.md": "EEXIST", "Dest/c.md": "EEXIST" },
    });
    await moveAndOrder(plugin, ["F/a.md", "F/b.md", "F/c.md"]);
    expect(messages()).toHaveLength(1);
  });

  it("says how much of the gesture happened, not only what threw", async () => {
    // Text naming only the files that failed leaves the reader unable to tell
    // a 1-of-3 move from a 1-of-300 one.
    const { plugin } = makePlugin({
      files: ["F/a.md", "F/b.md", "F/c.md"],
      failing: { "Dest/b.md": "EEXIST", "Dest/c.md": "EEXIST" },
    });
    await moveAndOrder(plugin, ["F/a.md", "F/b.md", "F/c.md"]);
    expect(messages()[0]).toMatch(/1 of 3/);
  });

  it("keeps the raw exception out of the toast and puts it in the console", async () => {
    // `reportLayoutOutcome`'s register: plain language to the user, detail to
    // the console. "Error: EEXIST" in a toast is a developer's sentence.
    const { plugin } = makePlugin({
      files: ["F/a.md", "F/b.md"],
      failing: { "Dest/b.md": "EEXIST-raw-detail" },
    });
    await moveAndOrder(plugin, ["F/a.md", "F/b.md"]);
    expect(messages()[0]).not.toMatch(/EEXIST-raw-detail/);
    const logged = errors.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
    expect(logged).toMatch(/EEXIST-raw-detail/);
    expect(logged).toMatch(/F\/b\.md/);
  });

  it("says nothing at all when every file moved", async () => {
    // A drag that worked is its own feedback: the rows are in the new folder.
    const { plugin, renamed } = makePlugin({ files: ["F/a.md", "F/b.md"] });
    await moveAndOrder(plugin, ["F/a.md", "F/b.md"]);
    expect(renamed).toEqual([
      ["F/a.md", "Dest/a.md"],
      ["F/b.md", "Dest/b.md"],
    ]);
    expect(messages()).toEqual([]);
  });

  it("still moves every file it can, and reports the ones it could not", async () => {
    // A partial multi-move is better than abandoning the files that
    // could move. What changes is that the partial result is now SAID.
    const { plugin, renamed } = makePlugin({
      files: ["F/a.md", "F/b.md", "F/c.md"],
      failing: { "Dest/b.md": "EEXIST" },
    });
    await moveAndOrder(plugin, ["F/a.md", "F/b.md", "F/c.md"]);
    expect(renamed.map(([, to]) => to)).toEqual(["Dest/a.md", "Dest/c.md"]);
    expect(messages()).toHaveLength(1);
    expect(messages()[0]).toMatch(/2 of 3/);
  });
});
