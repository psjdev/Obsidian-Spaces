/**
 * Which of a folder's items survive filtering. Pure — no DOM, no `"obsidian"`
 * import.
 *
 * This is the mechanism after the 2026-09-07 change: spaces returns only
 * the rows it intends to show, rather than returning the whole tree and hiding
 * most of it. The reason: hiding left Obsidian's virtualisation windowing over rows that
 * could never be seen, and a space whose members sat past a large expanded
 * folder rendered an empty, unscrollable pane.
 *
 * It decides nothing about visibility itself: the set construction and
 * precedence are untouched, and this only reads their answer.
 */

export interface FilterableItem {
  file?: { path?: string };
}

/** The slice of `VisibilitySnapshot` this needs, declared structurally. */
export interface VisibilityLookup {
  /**
   * The question this file actually asks. `decisionFor` labels a row —
   * `reasonFor` ends in `ignore.matches(path)`, up to G regex tests — and every
   * field but `visible` is then discarded, once per hidden row per re-sort.
   *
   * OPTIONAL only because the implementation that supplies it lives in
   * `src/visibility/VisibilityEngine.ts`, which this fix does not own: the
   * snapshot already holds the answer as `visible.has(path)` and needs no
   * `reasonFor` call to give it. Once that lands, this can be made required and
   * the fallback below deleted.
   */
  isVisible?(this: void, path: string): boolean;
  decisionFor(path: string): { visible: boolean };
}

/**
 * `null` means *All* — the adapter already expresses "no filtering" that way —
 * and everything survives.
 *
 * An item whose path cannot be read is KEPT. Filtering fails open, and an unkeyable
 * item is not evidence that a row should disappear; dropping it would remove a
 * row for no stated reason. The ordering path in `main.ts` takes the same view
 * of an unkeyable item, for the same reason.
 */
export function filterVisibleItems<T extends FilterableItem>(
  items: readonly T[],
  snapshot: VisibilityLookup | null
): T[] {
  if (snapshot === null) return [...items];
  // Resolved once, not per row: the branch is a property of the lookup, not of
  // the item, and this runs for every row of every folder on every re-sort.
  const isVisible = snapshot.isVisible;
  return items.filter((it) => {
    const path = it.file?.path;
    if (typeof path !== "string") return true;
    // `!== false` in both arms, not a bare truthiness test: filtering fails OPEN, so
    // anything that is not an explicit "no" keeps the row.
    // Called plainly, not `.call(snapshot, …)`: the interface declares
    // `this: void`, so an implementation that needed a receiver would not
    // typecheck in the first place, and passing one said otherwise.
    return isVisible
      ? isVisible(path) !== false
      : snapshot.decisionFor(path).visible !== false;
  });
}
