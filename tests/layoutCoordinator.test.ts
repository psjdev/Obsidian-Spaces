import { describe, expect, it, vi } from "vitest";
import { LayoutCoordinator } from "../src/layout/LayoutCoordinator";
import { RuntimeStateStore } from "../src/runtime/RuntimeStateStore";
import type { LayoutBlob } from "../src/types";

function mem() {
  const d: Record<string, unknown> = {};
  return { get: (k: string) => d[k] ?? null, set: (k: string, v: unknown) => { d[k] = v; } };
}

function runtime() {
  const s = new RuntimeStateStore(mem());
  s.load();
  return s;
}

/** A fake workspace. `leaves` is what mainLeafCount() reports next. */
function port(opts: { leaves?: number } = {}) {
  let current: LayoutBlob = { main: "LIVE" };
  let leaves = opts.leaves ?? 3;
  return {
    capture: () => current,
    restore: vi.fn(async (l: LayoutBlob) => {
      current = l;
    }),
    mainLeafCount: () => leaves,
    setLeaves: (n: number) => { leaves = n; },
    setCurrent: (l: LayoutBlob) => { current = l; },
  };
}

const A = { kind: "space", id: "a" } as const;
const B = { kind: "space", id: "b" } as const;
const ALL = { kind: "all" } as const;

describe("LayoutCoordinator", () => {
  it("skips entirely when restoration is disabled, and captures nothing", async () => {
    const p = port();
    const r = runtime();
    const c = new LayoutCoordinator(p, r);

    const out = await c.transition(A, B, false);

    expect(out.kind).toBe("skipped");
    expect(p.restore).not.toHaveBeenCalled();
    expect(r.getLayoutFor(A)).toBeNull();
  });

  it("captures the outgoing layout before restoring", async () => {
    const p = port();
    p.setCurrent({ main: "OUTGOING" });
    const r = runtime();
    r.setLayoutFor(B, { main: "TARGET" });

    await new LayoutCoordinator(p, r).transition(A, B, true);

    expect(r.getLayoutFor(A)).toEqual({ main: "OUTGOING" });
    expect(p.restore).toHaveBeenCalledWith({ main: "TARGET" });
  });

  it("restores a stored target layout", async () => {
    const p = port();
    const r = runtime();
    r.setLayoutFor(B, { main: "TARGET" });

    const out = await new LayoutCoordinator(p, r).transition(A, B, true);

    expect(out.kind).toBe("restored");
  });

  it("adopts the live layout when the target has none, and never calls restore", async () => {
    const p = port();
    p.setCurrent({ main: "LIVE" });
    const r = runtime();

    const out = await new LayoutCoordinator(p, r).transition(A, B, true);

    expect(out.kind).toBe("adopted");
    expect(p.restore).not.toHaveBeenCalled();
    expect(r.getLayoutFor(B)).toEqual({ main: "LIVE" });
  });

  it("rolls back when a restore leaves an empty workspace", async () => {
    // changeLayout does not throw on bad input, so an empty
    // result is the only signal that the restore failed.
    const p = port({ leaves: 3 });
    p.setCurrent({ main: "OUTGOING" });
    const r = runtime();
    r.setLayoutFor(B, { main: "BAD" });
    p.restore.mockImplementation(async (l: LayoutBlob) => {
      p.setLeaves(l === undefined ? 0 : (l as { main?: string }).main === "BAD" ? 0 : 3);
    });

    const out = await new LayoutCoordinator(p, r).transition(A, B, true);

    expect(out.kind).toBe("rolled-back");
    expect(p.restore).toHaveBeenCalledTimes(2);
    expect(p.restore.mock.calls[1][0]).toEqual({ main: "OUTGOING" });
  });

  it("fails open when the rollback is also empty", async () => {
    const p = port({ leaves: 3 });
    const r = runtime();
    r.setLayoutFor(B, { main: "BAD" });
    p.restore.mockImplementation(async () => {
      p.setLeaves(0);
    });

    const out = await new LayoutCoordinator(p, r).transition(A, B, true);

    expect(out.kind).toBe("failed-open");
  });

  it("rolls back when restore throws", async () => {
    const p = port();
    p.setCurrent({ main: "OUTGOING" });
    const r = runtime();
    r.setLayoutFor(B, { main: "TARGET" });
    let call = 0;
    p.restore.mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error("boom");
    });

    const out = await new LayoutCoordinator(p, r).transition(A, B, true);

    expect(out.kind).toBe("rolled-back");
  });

  it("captures nothing on a self-transition, so a no-op cannot prune a saved layout", async () => {
    // What `capture()` reports is whatever `changeLayout()` actually built,
    // which drops leaves it could not resolve. On a `from === to`
    // run that blob would be written straight back over the space's own saved
    // layout — silent loss with no restore failure involved.
    const p = port();
    p.setCurrent({ main: "PRUNED" });
    const r = runtime();
    r.setLayoutFor(A, { main: "SAVED" });

    const out = await new LayoutCoordinator(p, r).transition(A, A, true);

    expect(out.kind).toBe("skipped");
    expect(r.getLayoutFor(A)).toEqual({ main: "SAVED" });
    expect(p.restore).not.toHaveBeenCalled();
  });

  it("treats All as a normal target with its own slot", async () => {
    const p = port();
    const r = runtime();
    r.setLayoutFor(ALL, { main: "ALL-LAYOUT" });

    const out = await new LayoutCoordinator(p, r).transition(A, ALL, true);

    expect(out.kind).toBe("restored");
    expect(p.restore).toHaveBeenCalledWith({ main: "ALL-LAYOUT" });
  });
});
