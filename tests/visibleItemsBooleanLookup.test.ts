/**
 * `filterVisibleItems` asks a BOOLEAN, not a full decision.
 *
 * Every hidden row used to cost a `VisibilityDecision`: `decisionFor` runs
 * `reasonFor`, whose last line is `ignore.matches(path)` — up to G regex tests
 * — purely to label a row the caller then throws away. This function only ever
 * reads `.visible`.
 *
 * So `VisibilityLookup` now declares an OPTIONAL `isVisible`, and prefers it.
 * Optional because the implementation that would supply it —
 * `buildVisibilitySnapshot` in `src/visibility/VisibilityEngine.ts` — is
 * outside this fix's file ownership; the seam lands here, the engine side is
 * recorded as a cross-boundary need. The fallback keeps every existing caller
 * working unchanged.
 *
 * The discriminator is a lookup whose `decisionFor` THROWS: before the fix
 * these tests fail, because the only path through the filter went through it.
 *
 * Layer 1: `visibleItems.ts` imports no `"obsidian"`.
 */
import { describe, expect, it } from "vitest";
import {
  filterVisibleItems,
  type FilterableItem,
  type VisibilityLookup,
} from "../src/visibility/visibleItems";

function item(path: string): FilterableItem {
  return { file: { path } };
}

function pathsOf(items: FilterableItem[]): (string | undefined)[] {
  return items.map((i) => i.file?.path);
}

/** Answers the boolean, and fails loudly if asked to build a decision. */
function booleanOnly(visible: readonly string[]): VisibilityLookup {
  return {
    isVisible: (path) => visible.includes(path),
    decisionFor() {
      throw new Error(
        "filterVisibleItems built a VisibilityDecision when a boolean was offered"
      );
    },
  };
}

describe("filterVisibleItems prefers a boolean query", () => {
  it("uses `isVisible` and never builds a decision", () => {
    const out = filterVisibleItems(
      [item("Papers/Attention.md"), item("Papers/Draft.md")],
      booleanOnly(["Papers/Attention.md"])
    );
    expect(pathsOf(out)).toEqual(["Papers/Attention.md"]);
  });

  it("keeps an unkeyable item without asking either question", () => {
    const weird = {} as FilterableItem;
    expect(filterVisibleItems([weird], booleanOnly([]))).toEqual([weird]);
  });

  it("still falls back to `decisionFor` for a lookup that has no `isVisible`", () => {
    // The optional half of the seam: `VisibilitySnapshot` does not implement
    // `isVisible` yet, so this is the path the app takes today and it must not
    // have changed.
    const lookup: VisibilityLookup = {
      decisionFor: (path) => ({ visible: path === "Papers/Attention.md" }),
    };
    const out = filterVisibleItems(
      [item("Papers/Attention.md"), item("Papers/Draft.md")],
      lookup
    );
    expect(pathsOf(out)).toEqual(["Papers/Attention.md"]);
  });

  it("still returns everything for a null snapshot (All)", () => {
    const items = [item("a.md"), item("b.md")];
    expect(filterVisibleItems(items, null)).toEqual(items);
  });
});
