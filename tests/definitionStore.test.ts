import { describe, expect, it, vi } from "vitest";
import { DefinitionStore } from "../src/definitions/DefinitionStore";
import { DEFAULT_DEFINITIONS, SCHEMA_VERSION } from "../src/types";

function backing(initial: unknown) {
  let data = initial;
  return {
    read: vi.fn(async () => data),
    write: vi.fn(async (d: unknown) => {
      data = d;
    }),
    peek: () => data,
  };
}

/**
 * Models the shipped platform rather than an idealised backing:
 * `Vault.writeJson` swallows the adapter error outright, so `Plugin.saveData`
 * resolves whether or not a byte reached disk, and a later `loadData()` still
 * hands back the STALE document. Nothing throws anywhere.
 */
function silentlyFailingBacking(initial: unknown) {
  const frozen = JSON.parse(JSON.stringify(initial)) as unknown;
  return {
    read: vi.fn(async () => JSON.parse(JSON.stringify(frozen)) as unknown),
    write: vi.fn(async () => undefined),
  };
}

const oneSpace = {
  schemaVersion: SCHEMA_VERSION,
  settings: { globalIgnore: [], restoreLayouts: false },
  spaces: [
    { id: "a", name: "A", icon: "box", color: "#112233", members: [] },
  ],
};

describe("DefinitionStore", () => {
  it("loads and exposes valid definitions", async () => {
    const store = new DefinitionStore(backing(oneSpace));
    const r = await store.load();
    expect(r.ok).toBe(true);
    expect(store.get().spaces).toHaveLength(1);
  });

  it("falls back to defaults and reports the error on invalid data", async () => {
    const store = new DefinitionStore(backing({ nonsense: true }));
    const r = await store.load();
    expect(r.ok).toBe(false);
    expect(store.get()).toEqual(DEFAULT_DEFINITIONS);
  });

  it("does not write when a future schema is found", async () => {
    const b = backing({ ...oneSpace, schemaVersion: SCHEMA_VERSION + 1 });
    const store = new DefinitionStore(b);
    const r = await store.load();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.futureSchema).toBe(true);
    expect(b.write).not.toHaveBeenCalled();
  });

  it("serializes concurrent mutations", async () => {
    const b = backing(oneSpace);
    const store = new DefinitionStore(b);
    await store.load();
    await Promise.all([
      store.mutate((d) => {
        d.spaces.push({ id: "b", name: "B", icon: "box", color: "#112233", members: [] });
      }),
      store.mutate((d) => {
        d.spaces.push({ id: "c", name: "C", icon: "box", color: "#112233", members: [] });
      }),
    ]);
    expect(store.get().spaces.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("notifies subscribers on change", async () => {
    const store = new DefinitionStore(backing(oneSpace));
    await store.load();
    const seen = vi.fn();
    store.subscribe(seen);
    await store.mutate((d) => {
      d.settings.globalIgnore.push("x/**");
    });
    expect(seen).toHaveBeenCalledTimes(1);
  });

  it("treats a valid external snapshot as authoritative", async () => {
    const store = new DefinitionStore(backing(oneSpace));
    await store.load();
    await store.onExternalChange({
      ...oneSpace,
      spaces: [
        { id: "z", name: "Z", icon: "box", color: "#445566", members: [] },
      ],
    });
    expect(store.get().spaces.map((s) => s.id)).toEqual(["z"]);
  });

  it("keeps last-known-good when the external snapshot is invalid", async () => {
    const store = new DefinitionStore(backing(oneSpace));
    await store.load();
    await store.onExternalChange({ garbage: true });
    expect(store.get().spaces.map((s) => s.id)).toEqual(["a"]);
  });

  it("does not let a throwing subscriber fail a mutate() that already wrote to disk", async () => {
    const b = backing(oneSpace);
    const store = new DefinitionStore(b);
    await store.load();
    store.subscribe(() => {
      throw new Error("boom");
    });
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(
      store.mutate((d) => {
        d.settings.globalIgnore.push("x/**");
      })
    ).resolves.toBeUndefined();
    // The write landed even though the subscriber threw.
    expect(b.write).toHaveBeenCalledTimes(1);
    expect(store.get().settings.globalIgnore).toEqual(["x/**"]);
    errorSpy.mockRestore();
  });

  it("still notifies later subscribers after an earlier one throws", async () => {
    const store = new DefinitionStore(backing(oneSpace));
    await store.load();
    store.subscribe(() => {
      throw new Error("boom");
    });
    const seen = vi.fn();
    store.subscribe(seen);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await store.mutate((d) => {
      d.settings.globalIgnore.push("y/**");
    });
    expect(seen).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});

describe("DefinitionStore — a failed load is sticky", () => {
  it("distinguishes a missing file (null) from an unreadable one (undefined)", async () => {
    const missing = new DefinitionStore({
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
    });
    expect((await missing.load()).ok).toBe(true);

    // `Vault.readJson` returns undefined for malformed JSON — it console.errors
    // and does NOT throw. A truncated data.json therefore arrives as `undefined`.
    const unreadable = new DefinitionStore({
      read: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
    });
    const r = await unreadable.load();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("data.json");
  });

  it("refuses to write after an unreadable data.json, and says so", async () => {
    const b = { read: vi.fn(async () => undefined), write: vi.fn(async () => undefined) };
    const warn = vi.fn();
    const store = new DefinitionStore(b, warn);
    await store.load();
    await expect(
      store.mutate((d) => {
        d.settings.globalIgnore.push("x/**");
      })
    ).rejects.toThrow();
    expect(b.write).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("data.json");
  });

  it("refuses to write after a rejected data.json (future schema)", async () => {
    const b = backing({ ...oneSpace, schemaVersion: SCHEMA_VERSION + 1 });
    const store = new DefinitionStore(b);
    await store.load();
    await expect(
      store.mutate((d) => {
        d.spaces.pop();
      })
    ).rejects.toThrow();
    expect(b.write).not.toHaveBeenCalled();
    // Disk still holds the document we could not understand.
    expect((b.peek() as { spaces: unknown[] }).spaces).toHaveLength(1);
  });

  it("lifts the refusal once a valid document loads", async () => {
    let data: unknown = undefined;
    const b = {
      read: vi.fn(async () => data),
      write: vi.fn(async (d: unknown) => {
        data = d;
      }),
    };
    const store = new DefinitionStore(b);
    expect((await store.load()).ok).toBe(false);
    data = oneSpace;
    expect((await store.load()).ok).toBe(true);
    await store.mutate((d) => {
      d.settings.globalIgnore.push("x/**");
    });
    expect(b.write).toHaveBeenCalledTimes(1);
  });

  it("lifts the refusal when a valid external document arrives (spec 4.5)", async () => {
    const store = new DefinitionStore({
      read: vi.fn(async () => undefined),
      write: vi.fn(async () => undefined),
    });
    expect((await store.load()).ok).toBe(false);
    await store.onExternalChange(oneSpace);
    await expect(
      store.mutate((d) => {
        d.settings.globalIgnore.push("x/**");
      })
    ).resolves.toBeUndefined();
  });

  it("copies the pre-session document aside before the first write, exactly once", async () => {
    const b = backing(oneSpace);
    const bak = vi.fn(async (_d: unknown) => undefined);
    const store = new DefinitionStore({ ...b, backup: bak });
    await store.load();
    await store.mutate((d) => {
      d.settings.globalIgnore.push("x/**");
    });
    await store.mutate((d) => {
      d.settings.globalIgnore.push("y/**");
    });
    expect(bak).toHaveBeenCalledTimes(1);
    // The backup holds the document as it was BEFORE this session wrote.
    const backedUp = bak.mock.calls[0]?.[0] as { settings: { globalIgnore: string[] } };
    expect(backedUp.settings.globalIgnore).toEqual([]);
  });

  it("does not back up a fresh install — there is nothing to lose", async () => {
    const bak = vi.fn(async () => undefined);
    const store = new DefinitionStore({
      read: vi.fn(async () => null),
      write: vi.fn(async () => undefined),
      backup: bak,
    });
    await store.load();
    await store.mutate((d) => {
      d.settings.globalIgnore.push("x/**");
    });
    expect(bak).not.toHaveBeenCalled();
  });

  it("writes even when the backup itself fails — insurance, not a gate", async () => {
    const b = backing(oneSpace);
    const store = new DefinitionStore({
      ...b,
      backup: vi.fn(async () => {
        throw new Error("read-only volume");
      }),
    });
    await store.load();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await store.mutate((d) => {
      d.settings.globalIgnore.push("x/**");
    });
    expect(b.write).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });
});

describe("DefinitionStore — a failed save is detected", () => {
  it("warns when the document that comes back off disk is not the one written", async () => {
    const b = silentlyFailingBacking(oneSpace);
    const warn = vi.fn();
    const store = new DefinitionStore(b, warn);
    await store.load();
    // saveData cannot reject, so this resolves — but nothing reached disk.
    await store.mutate((d) => {
      d.settings.globalIgnore.push("x/**");
    });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("data.json");
  });

  it("warns once per outage, not once per mutation", async () => {
    const b = silentlyFailingBacking(oneSpace);
    const warn = vi.fn();
    const store = new DefinitionStore(b, warn);
    await store.load();
    await store.mutate((d) => {
      d.settings.globalIgnore.push("x/**");
    });
    await store.mutate((d) => {
      d.settings.globalIgnore.push("y/**");
    });
    await store.mutate((d) => {
      d.settings.globalIgnore.push("z/**");
    });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("stays silent when the write actually lands", async () => {
    const warn = vi.fn();
    const store = new DefinitionStore(backing(oneSpace), warn);
    await store.load();
    await store.mutate((d) => {
      d.settings.globalIgnore.push("x/**");
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("DefinitionStore — external arbitration", () => {
  const external = {
    ...oneSpace,
    spaces: [{ id: "z", name: "Z", icon: "box", color: "#445566", members: [] }],
  };

  it("re-persists the captured snapshot when a local write landed after capture", async () => {
    const b = backing(oneSpace);
    const store = new DefinitionStore(b);
    await store.load();
    // Step 1: the caller captures the external bytes — and the write token.
    const token = store.writeToken();
    // Step 3: an already-queued local write lands on disk after that capture.
    await store.mutate((d) => {
      d.settings.globalIgnore.push("local/**");
    });
    // Steps 4 and 5.
    await store.onExternalChange(external, token);
    expect(store.get().spaces.map((s) => s.id)).toEqual(["z"]);
    const disk = b.peek() as { spaces: { id: string }[] };
    expect(disk.spaces.map((s) => s.id)).toEqual(["z"]);
  });

  it("announces that an unsaved local change was superseded (step 6)", async () => {
    const warn = vi.fn();
    const store = new DefinitionStore(backing(oneSpace), warn);
    await store.load();
    const token = store.writeToken();
    await store.mutate((d) => {
      d.settings.globalIgnore.push("local/**");
    });
    await store.onExternalChange(external, token);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0]).toLowerCase()).toContain("superseded");
  });

  it("writes nothing when no local write intervened", async () => {
    const b = backing(oneSpace);
    const warn = vi.fn();
    const store = new DefinitionStore(b, warn);
    await store.load();
    await store.onExternalChange(external, store.writeToken());
    expect(b.write).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("DefinitionStore — prototype-safe order maps", () => {
  it("hands a mutate() draft order maps that cannot reach Object.prototype", async () => {
    const withOrders = {
      ...oneSpace,
      orders: { bySpaceId: { a: { "": ["a.md"] } } },
    };
    const store = new DefinitionStore(backing(withOrders));
    await store.load();
    try {
      await store.mutate((d) => {
        const by = d.orders?.bySpaceId as Record<string, Record<string, string[]>>;
        // Exactly the shape writeOrderFor uses, for a space id of `__proto__`.
        by["__proto__"] ??= {};
        by["__proto__"]!["Notes"] = ["Notes/x.md"];
      });
    } catch {
      // Validation may reject the mutation; what must never happen is the
      // prototype write asserted below.
    }
    expect(({} as Record<string, unknown>)["Notes"]).toBeUndefined();
    delete (Object.prototype as unknown as Record<string, unknown>)["Notes"];
  });
});
