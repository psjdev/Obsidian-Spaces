// @vitest-environment jsdom
/**
 * The declared extension surface.
 *
 * An accidental API already existed: eight plugin fields were declared without
 * `private`, so `app.plugins.plugins.spaces.controller` was the de-facto
 * public interface — and the project's own verification loop consumes it
 * (`controller.currentSnapshot()?.visiblePaths()`). The choice was never
 * "API or no API"; it was "accidental or deliberate".
 *
 * So: five read-only methods on `plugin.api`, and a `data-spaces-space`
 * marker on `document.body` while a space is filtering the tree — body,
 * because a switch replaces every element inside the explorer pane (the
 * measurement `CLS_SWITCHING` records in `src/explorer/selectors.ts`).
 *
 * Layer: unit (it runs against the `obsidian` stub, so it is
 * evidence about the surface, not about the real app). What it buys is that the
 * surface cannot be renamed or deleted in silence, which is the entire point of
 * declaring one.
 */
import { beforeEach, describe, expect, it } from "vitest";
import SpacesPlugin from "../src/main";
import { DefinitionStore } from "../src/definitions/DefinitionStore";
import { RuntimeStateStore } from "../src/runtime/RuntimeStateStore";
import type { SpaceDefinition, SpaceSummary } from "../src/types";

const RESEARCH: SpaceDefinition = {
  id: "research",
  name: "Research",
  icon: "microscope",
  color: "#4ecdc4",
  members: [
    { path: "Papers/Attention.md", kind: "file" },
    { path: "Inbox", kind: "folder" },
  ],
};

const ADMIN: SpaceDefinition = {
  id: "admin",
  name: "Admin",
  icon: "briefcase",
  color: "#ff6b6b",
  members: [{ path: "Invoices/2026.md", kind: "file" }],
};

/**
 * The plugin with only the two collaborators the API reads. `onload()` is never
 * called; the API deliberately does not go through `SpaceController`, so it can
 * answer before `start()` has built one.
 *
 * The fake app carries the one thing the marker needs: the workspace's own
 * document, read the same way `setSwitchMask` reads it so a second Obsidian
 * window marks its own body rather than the main one's.
 */
function makePlugin(): SpacesPlugin {
  const app = { workspace: { containerEl: document.createElement("div") } };
  const plugin = new SpacesPlugin(
    app as unknown as ConstructorParameters<typeof SpacesPlugin>[0],
    {} as ConstructorParameters<typeof SpacesPlugin>[1]
  );
  // Bracket access because these are `private` now — which is the fix, not a
  // workaround for it (see the eight-fields note in the file docstring).
  plugin["defs"] = new DefinitionStore({
    read: async () => undefined,
    write: async () => undefined,
  });
  const backing = new Map<string, unknown>();
  plugin["runtime"] = new RuntimeStateStore({
    get: (k) => backing.get(k),
    set: (k, v) => void backing.set(k, v),
  });
  return plugin;
}

/** What `host.apply` calls on every path that commits a selection. */
function sync(plugin: SpacesPlugin): void {
  plugin["syncSpaceSurface"]();
}

describe("the declared read-only API", () => {
  let plugin: SpacesPlugin;

  beforeEach(async () => {
    document.body.removeAttribute("data-spaces-space");
    plugin = makePlugin();
    // A REAL definitions document, built through the validator, so these
    // answers cannot disagree with the schema.
    await plugin["defs"].mutate((d) => {
      d.spaces = [RESEARCH, ADMIN];
    });
  });

  it("hangs off the plugin so `app.plugins.plugins.spaces.api` reaches it", () => {
    expect(typeof plugin.api.getActiveSpace).toBe("function");
    expect(typeof plugin.api.listSpaces).toBe("function");
    expect(typeof plugin.api.isMember).toBe("function");
    expect(typeof plugin.api.memberPaths).toBe("function");
    expect(typeof plugin.api.onSpaceChange).toBe("function");
  });

  it("listSpaces projects the stored document in definition order", () => {
    expect(plugin.api.listSpaces()).toEqual([
      { id: "research", name: "Research", icon: "microscope", color: "#4ecdc4" },
      { id: "admin", name: "Admin", icon: "briefcase", color: "#ff6b6b" },
    ]);
  });

  it("hands out copies, so a consumer cannot mutate the store through them", () => {
    const spaces = plugin.api.listSpaces();
    spaces[0].name = "Clobbered";
    spaces.length = 0;
    expect(plugin.api.listSpaces()[0].name).toBe("Research");
    const paths = plugin.api.memberPaths("research");
    paths.push("Nonsense.md");
    expect(plugin.api.memberPaths("research")).not.toContain("Nonsense.md");
  });

  it("getActiveSpace is null in All and the summary in a space", () => {
    expect(plugin.api.getActiveSpace()).toBeNull();
    plugin["runtime"].setSelection({ kind: "space", id: "research" });
    expect(plugin.api.getActiveSpace()?.id).toBe("research");
  });

  it("isMember answers exact and inherited membership, defaulting to the active space", () => {
    plugin["runtime"].setSelection({ kind: "space", id: "research" });
    expect(plugin.api.isMember("Papers/Attention.md")).toBe(true);
    // Inherited from the `Inbox` folder member: membership is ownership-free
    //, so a descendant of a member folder is a member.
    expect(plugin.api.isMember("Inbox/Today.md")).toBe(true);
    expect(plugin.api.isMember("Papers/Draft.md")).toBe(false);
  });

  it("isMember takes an explicit space id, and is false for All or an unknown id", () => {
    expect(plugin.api.isMember("Invoices/2026.md", "admin")).toBe(true);
    // No active space: the default target does not exist, so the answer is no.
    expect(plugin.api.isMember("Invoices/2026.md")).toBe(false);
    expect(plugin.api.isMember("Invoices/2026.md", "nope")).toBe(false);
  });

  it("memberPaths returns the EXACT stored entries only", () => {
    // `members` holds only exact members; inherited ones are computed and
    // never stored, so a descendant of `Inbox` is a member but not a path here.
    expect(plugin.api.memberPaths("research")).toEqual([
      "Papers/Attention.md",
      "Inbox",
    ]);
    expect(plugin.api.isMember("Inbox/Today.md", "research")).toBe(true);
    expect(plugin.api.memberPaths("research")).not.toContain("Inbox/Today.md");
  });
});

describe("onSpaceChange", () => {
  let plugin: SpacesPlugin;
  let seen: (SpaceSummary | null)[];

  beforeEach(async () => {
    document.body.removeAttribute("data-spaces-space");
    plugin = makePlugin();
    await plugin["defs"].mutate((d) => {
      d.spaces = [RESEARCH, ADMIN];
    });
    seen = [];
  });

  it("fires when the active space changes, and not when it has not", () => {
    plugin.api.onSpaceChange((s) => seen.push(s));
    plugin["runtime"].setSelection({ kind: "space", id: "research" });
    sync(plugin);
    sync(plugin); // host.apply also runs on every file open — no second event
    expect(seen.map((s) => s?.id ?? null)).toEqual(["research"]);

    plugin["runtime"].setSelection({ kind: "all" });
    sync(plugin);
    expect(seen.map((s) => s?.id ?? null)).toEqual(["research", null]);
  });

  it("returns an unsubscribe that stops delivery, and is idempotent", () => {
    const off = plugin.api.onSpaceChange((s) => seen.push(s));
    plugin["runtime"].setSelection({ kind: "space", id: "research" });
    sync(plugin);
    off();
    off();
    plugin["runtime"].setSelection({ kind: "space", id: "admin" });
    sync(plugin);
    expect(seen.map((s) => s?.id)).toEqual(["research"]);
  });

  it("drops every subscriber when the plugin releases them, so a forgotten unsubscribe cannot leak", () => {
    plugin.api.onSpaceChange((s) => seen.push(s));
    plugin["releaseSpaceSurface"]();
    plugin["runtime"].setSelection({ kind: "space", id: "research" });
    sync(plugin);
    expect(seen).toEqual([]);
  });

  it("isolates a throwing subscriber from the rest", () => {
    plugin.api.onSpaceChange(() => {
      throw new Error("consumer bug");
    });
    plugin.api.onSpaceChange((s) => seen.push(s));
    plugin["runtime"].setSelection({ kind: "space", id: "research" });
    expect(() => sync(plugin)).not.toThrow();
    expect(seen.map((s) => s?.id)).toEqual(["research"]);
  });
});

describe("the data-spaces-space marker", () => {
  let plugin: SpacesPlugin;

  beforeEach(async () => {
    document.body.removeAttribute("data-spaces-space");
    plugin = makePlugin();
    await plugin["defs"].mutate((d) => {
      d.spaces = [RESEARCH, ADMIN];
    });
  });

  it("names the active space on the body, and comes off in All", () => {
    plugin["runtime"].setSelection({ kind: "space", id: "research" });
    sync(plugin);
    expect(document.body.getAttribute("data-spaces-space")).toBe("research");

    plugin["runtime"].setSelection({ kind: "space", id: "admin" });
    sync(plugin);
    expect(document.body.getAttribute("data-spaces-space")).toBe("admin");

    plugin["runtime"].setSelection({ kind: "all" });
    sync(plugin);
    expect(document.body.hasAttribute("data-spaces-space")).toBe(false);
  });

  it("comes off when the plugin releases the surface", () => {
    plugin["runtime"].setSelection({ kind: "space", id: "research" });
    sync(plugin);
    plugin["releaseSpaceSurface"]();
    expect(document.body.hasAttribute("data-spaces-space")).toBe(false);
  });
});
