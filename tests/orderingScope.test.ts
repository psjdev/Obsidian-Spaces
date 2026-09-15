import { describe, expect, it } from "vitest";
import { orderingEnabledFor } from "../src/order/orderingScope";

const ALL = { kind: "all" } as const;
const SPACE = { kind: "space", id: "work" } as const;

describe("orderingEnabledFor", () => {
  it("is on everywhere when both settings are on", () => {
    const s = { allowReordering: true, allowReorderingAll: true };
    expect(orderingEnabledFor(ALL, s)).toBe(true);
    expect(orderingEnabledFor(SPACE, s)).toBe(true);
  });

  it("turns off ONLY All when allowReorderingAll is off", () => {
    // The whole point of the second boolean: a space keeps its order while
    // All falls back to Obsidian's own sort.
    const s = { allowReordering: true, allowReorderingAll: false };
    expect(orderingEnabledFor(ALL, s)).toBe(false);
    expect(orderingEnabledFor(SPACE, s)).toBe(true);
  });

  it("turns off everywhere when the global is off, whatever All says", () => {
    // The global remains the outer gate; the All toggle can only narrow
    // it, never re-enable what the global switched off.
    for (const allowReorderingAll of [true, false]) {
      const s = { allowReordering: false, allowReorderingAll };
      expect(orderingEnabledFor(ALL, s)).toBe(false);
      expect(orderingEnabledFor(SPACE, s)).toBe(false);
    }
  });

  it("does not care which space is active", () => {
    const s = { allowReordering: true, allowReorderingAll: false };
    expect(orderingEnabledFor({ kind: "space", id: "a" }, s)).toBe(true);
    expect(orderingEnabledFor({ kind: "space", id: "b" }, s)).toBe(true);
  });
});
