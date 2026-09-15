// @vitest-environment jsdom
/**
 * Independent step guarding, applied to the lifecycle edges.
 *
 * `bindExplorer()` guards each of its five steps independently, with a comment
 * on each saying which later step a throw would otherwise skip. `onunload()`
 * needs the same discipline: an early throw skips
 * `unsubscribeDefs()`, so a `DefinitionStore` subscriber closing over a
 * plugin instance that has been unloaded stays in the set for the life of the
 * app, repainting a switcher and a header that are no longer on screen.
 * `start()` and `onExternalSettingsChange()` are both called BY Obsidian from
 * places that do not catch, so a throw escapes into the host.
 *
 * These tests assert the property, not the absence of a throw. "It does not
 * throw" pins nothing, so every case below makes one step throw and then
 * checks that the steps AFTER it still ran.
 *
 * Layer: unit. The collaborators are fakes, so this is
 * evidence about the guarding, not about Obsidian.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import SpacesPlugin from "../src/main";
import { DefinitionStore } from "../src/definitions/DefinitionStore";
import { RuntimeStateStore } from "../src/runtime/RuntimeStateStore";

/** Records the order in which teardown steps ran. */
interface Trace {
  steps: string[];
}

function makePlugin(): { plugin: SpacesPlugin; body: HTMLElement } {
  const body = document.body;
  const plugin = new SpacesPlugin(
    {} as ConstructorParameters<typeof SpacesPlugin>[0],
    {} as ConstructorParameters<typeof SpacesPlugin>[1]
  );
  // `setSwitchMask` reads the body through the workspace's container element;
  // that is the only part of `app` `onunload` touches.
  const container = document.createElement("div");
  document.body.appendChild(container);
  (plugin as unknown as { app: unknown }).app = {
    workspace: { containerEl: container },
  };
  plugin["defs"] = new DefinitionStore({
    read: async () => undefined,
    write: async () => undefined,
  });
  const backing = new Map<string, unknown>();
  plugin["runtime"] = new RuntimeStateStore({
    get: (k) => backing.get(k),
    set: (k, v) => void backing.set(k, v),
  });
  return { plugin, body };
}

/**
 * Wires every teardown collaborator `onunload` reaches to a recorder, with the
 * one named by `throwAt` throwing instead.
 */
function armTeardown(plugin: SpacesPlugin, throwAt: string | null): Trace {
  const trace: Trace = { steps: [] };
  const step = (name: string) => () => {
    trace.steps.push(name);
    if (name === throwAt) throw new Error(`${name} exploded`);
  };
  const set = (field: string, value: unknown): void => {
    (plugin as unknown as Record<string, unknown>)[field] = value;
  };
  set("dragOrdering", { unbind: step("dragOrdering.unbind") });
  set("sortedView", { getSortedFolderItems: () => [] });
  plugin["adapter"] = { unbind: step("adapter.unbind") } as unknown as typeof plugin["adapter"];
  plugin["switcher"] = { destroy: step("switcher.destroy") } as unknown as typeof plugin["switcher"];
  plugin["header"] = { destroy: step("header.destroy") } as unknown as typeof plugin["header"];
  set("createPanel", { destroy: step("createPanel.destroy") });
  set("unsubscribeDefs", step("unsubscribeDefs"));
  return trace;
}

/** Every step `armTeardown` installs, in the order `onunload` runs them. */
const ALL_STEPS = [
  "dragOrdering.unbind",
  "adapter.unbind",
  "switcher.destroy",
  "header.destroy",
  "createPanel.destroy",
  "unsubscribeDefs",
];

describe("onunload guarding", () => {
  let errors: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.replaceChildren();
    document.body.className = "";
    errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  it("runs every teardown step when nothing throws", () => {
    const { plugin } = makePlugin();
    const trace = armTeardown(plugin, null);
    plugin.onunload();
    expect(trace.steps).toEqual(ALL_STEPS);
    errors.mockRestore();
  });

  it.each(ALL_STEPS)("still runs the steps after %s when it throws", (failing) => {
    const { plugin } = makePlugin();
    const trace = armTeardown(plugin, failing);
    // A throw escaping `onunload` is itself a defect: Obsidian calls it while
    // disabling the plugin and does not retry.
    expect(() => plugin.onunload()).not.toThrow();
    // The property that matters: everything downstream of the failure ran.
    expect(trace.steps).toEqual(ALL_STEPS);
    // And it was reported rather than swallowed, which is the whole point.
    expect(errors).toHaveBeenCalled();
    errors.mockRestore();
  });

  it("leaks no definitions subscriber when an earlier step throws", () => {
    // Asserted against the real DefinitionStore rather than a
    // recorder: a subscriber left behind holds this plugin instance,
    // and its `switcher?.render()` keeps running for a plugin that is gone.
    const { plugin } = makePlugin();
    let notified = 0;
    const unsubscribe = plugin["defs"].subscribe(() => {
      notified += 1;
    });
    armTeardown(plugin, "dragOrdering.unbind");
    (plugin as unknown as Record<string, unknown>).unsubscribeDefs = unsubscribe;
    plugin.onunload();
    return plugin["defs"].mutate((d) => {
      d.spaces = [];
    }).then(() => {
      expect(notified).toBe(0);
      errors.mockRestore();
    });
  });

  it("clears the switch mask even when a later step throws", () => {
    // A mask left on the body hides the file tree of a vault that no
    // longer has spaces installed, and no later apply comes to clear it.
    const { plugin } = makePlugin();
    document.body.classList.add("spaces-switching");
    armTeardown(plugin, "adapter.unbind");
    plugin.onunload();
    expect(document.body.classList.contains("spaces-switching")).toBe(false);
    errors.mockRestore();
  });
});

describe("start() guarding", () => {
  it("does not let a failure escape into Obsidian's onLayoutReady", () => {
    // `onload` ends at `workspace.onLayoutReady(() => this.start())`, a bare
    // callback Obsidian invokes without a catch. Unguarded, a throw is
    // reported against Obsidian rather than spaces and the user is told
    // nothing at all.
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { plugin } = makePlugin();
      (plugin as unknown as Record<string, unknown>).loaded = true;
      // `startSteps` reaches `this.app.workspace.onHealthChange` etc. through
      // an `app` that models almost nothing, so it throws on its first real
      // call — which is exactly the scenario under test.
      expect(() => (plugin as unknown as { start(): void }).start()).not.toThrow();
      expect(errors).toHaveBeenCalled();
      expect(String(errors.mock.calls[0][0])).toMatch(/^Spaces: /);
    } finally {
      errors.mockRestore();
    }
  });

  it("still does nothing at all when the plugin is already unloaded", () => {
    // The `loaded` guard predates this fix and must survive it: onLayoutReady
    // can fire after onunload (a toggle during startup).
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { plugin } = makePlugin();
      (plugin as unknown as Record<string, unknown>).loaded = false;
      (plugin as unknown as { start(): void }).start();
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});

describe("onExternalSettingsChange guarding", () => {
  function armExternal(plugin: SpacesPlugin, throwAt: string | null): Trace {
    const trace: Trace = { steps: [] };
    const step = (name: string) => () => {
      trace.steps.push(name);
      if (name === throwAt) throw new Error(`${name} exploded`);
    };
    (plugin as unknown as Record<string, unknown>).controller = {
      refresh: step("controller.refresh"),
    };
    plugin["switcher"] = { render: step("switcher.render") } as unknown as typeof plugin["switcher"];
    plugin["header"] = { render: step("header.render") } as unknown as typeof plugin["header"];
    (plugin as unknown as Record<string, unknown>).loadData = async () => undefined;
    return trace;
  }

  const REPAINTS = ["controller.refresh", "switcher.render", "header.render"];

  it.each(REPAINTS)("still repaints the rest when %s throws", async (failing) => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { plugin } = makePlugin();
      const trace = armExternal(plugin, failing);
      await plugin.onExternalSettingsChange();
      expect(trace.steps).toEqual(REPAINTS);
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it("does not reject when reading the external document fails", async () => {
    // Obsidian awaits this without a catch, so a rejection surfaces as an
    // unhandled promise rejection attributed to the host.
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const { plugin } = makePlugin();
      armExternal(plugin, null);
      (plugin as unknown as Record<string, unknown>).loadData = async () => {
        throw new Error("data.json is locked");
      };
      await expect(plugin.onExternalSettingsChange()).resolves.toBeUndefined();
      expect(errors).toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });

  it("disposes the controller, so a switch parked on an await cannot re-install anything", () => {
    // The wiring, not the guard. `SpaceController`'s own guards are pinned in
    // `tests/unloadCancellation.test.ts`; they are inert unless `onunload`
    // actually trips the token, so without this test deleting that one line
    // leaves the whole suite green.
    const { plugin } = makePlugin();
    const dispose = vi.fn();
    plugin["controller"] = { dispose } as unknown as SpacesPlugin["controller"];

    plugin.onunload();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("unloads a plugin whose onload never built a controller", () => {
    // Obsidian calls teardown on a half-built plugin, so the `!` on the
    // `controller` field is a lie for an `onload` that threw early. This is
    // why the dispose call is optional-chained.
    const { plugin } = makePlugin();
    delete (plugin as unknown as Record<string, unknown>)["controller"];

    expect(() => plugin.onunload()).not.toThrow();
  });
});
