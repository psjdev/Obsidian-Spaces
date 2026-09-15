/**
 * The drop rules, as pure functions.
 *
 * No DOM, no `"obsidian"` import, no knowledge of spaces. Every off-by-one a
 * drag can have lives in these two functions, which is the reason they are
 * separated from the controller that renders the drag at all.
 */

import { applyOrder } from "./orderModel";

export type DropEdge = "before" | "after";

type DropIntent =
  | { kind: "between"; edge: DropEdge }
  | { kind: "into" }
  | { kind: "none" };

/** A quarter of the row at each end reads as "between rows". */
const DEFAULT_EDGE_BAND = 0.25;

/**
 * What the pointer's position within one row means.
 *
 * The inequalities are asymmetric on purpose: `< band` for the leading edge,
 * `>= height - band` for the trailing one. With a wide `edgeBand` the two bands
 * meet, and a symmetric pair would leave the exact midpoint falling through to
 * `into` — a dead pixel row that is invisible in use and maddening to debug.
 */
export function intentFor(args: {
  offsetY: number;
  height: number;
  isFolder: boolean;
  edgeBand?: number;
}): DropIntent {
  const { offsetY, height, isFolder } = args;
  // A detached or collapsed row measures zero; dividing by it would produce
  // Infinity and a confident wrong answer.
  if (!(height > 0)) return { kind: "none" };

  // A file has no inside, so the whole row is an insertion target and the
  // nearest edge wins.
  if (!isFolder) {
    return { kind: "between", edge: offsetY < height / 2 ? "before" : "after" };
  }

  const band = height * (args.edgeBand ?? DEFAULT_EDGE_BAND);
  if (offsetY < band) return { kind: "between", edge: "before" };
  if (offsetY >= height - band) return { kind: "between", edge: "after" };
  // The middle of a folder is Obsidian's drop-into, which we never claim.
  return { kind: "into" };
}

function sameSequence(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * The folder's new order after a drop, or `null` when the drop changes nothing.
 *
 * `moveWithin`/`insertAt` from `orderModel` are deliberately NOT reused here:
 * both move a single path, and a multi-row drag has to insert its paths as one
 * block in their dragged order. Threading a loop through them would move each
 * path relative to the list the previous move just changed, which is a
 * different — and wrong — result.
 */
export function computeDrop(args: {
  order?: string[];
  displayed: string[];
  dragged: string[];
  targetPath: string;
  edge: DropEdge;
}): string[] | null {
  const { displayed, dragged, targetPath, edge } = args;

  // The baseline is the EFFECTIVE order — the stored list intersected
  // with what is displayed, then everything else in render order. Exactly what
  // `filterAndOrderFolder` paints, which is what makes a dropped position mean
  // the same thing as the position on screen.
  //
  // It used to be the stored list raw, and that was the reported bug: a stored
  // order is not required to be total, and a partial one made every unlisted
  // row untargetable — `indexOf` returned -1 and the drop declined. Measured in
  // the fixture, the root listed 7 of 14 children, and the 7 unlisted ones (which
  // render below the listed ones) could not be dropped onto at all. Each drop
  // then wrote back only what it knew about, so the folder stayed confined.
  //
  // Using the effective order also drops a stored path that is no longer live,
  // since `applyOrder` intersects with `displayed` — a stale entry can no
  // longer survive a drop by riding along in the baseline.
  const current = applyOrder(args.order, displayed);

  const draggedSet = new Set(dragged);
  const without = current.filter((p) => !draggedSet.has(p));

  // Located AFTER the removals, which is the index `moveWithin` documents and
  // the only one that means "where the user dropped".
  const at = without.indexOf(targetPath);
  // Either an unknown target, or the target was itself being dragged. Both mean
  // there is no position to compute, and guessing one is worse than declining.
  if (at === -1) return null;

  const index = edge === "before" ? at : at + 1;
  const next = [...without.slice(0, index), ...dragged, ...without.slice(index)];

  // Compared against the EFFECTIVE list, not `displayed`: in an ordered folder
  // whose stored order differs from what is rendered, comparing to the render
  // would report a change on every drag and write on every drop.
  return sameSequence(next, current) ? null : next;
}

/**
 * Whether this drop would move a folder inside itself.
 *
 * `dragged` is the whole dragged selection, unfiltered. A file can never make
 * a target illegal: for a target to sit under a dragged path that path needs
 * descendants, which only a folder has, and `targetFolder` always comes from a
 * row's `parent`, which is always a folder path. An earlier version filtered
 * to folders first and ablation showed the filter reddened no test.
 *
 * The separator in `f + "/"` is the whole subtlety. A bare prefix test would
 * call `Archive2` a descendant of `Archive` and refuse a legal move; this is
 * the same trap `spaceAddTargets` has to avoid when deciding inheritance.
 *
 * The vault root is `""` in storage terms and no folder contains it,
 * so a root target is always legal — `"".startsWith("Archive/")` is false and
 * needs no special case.
 *
 * ANY offending folder makes the whole drop illegal. A multi-selection is one
 * gesture, and moving the possible half would leave the user with a partial
 * result they did not ask for and cannot see the shape of.
 */
export function movesIntoOwnSubtree(
  dragged: readonly string[],
  targetFolder: string
): boolean {
  return dragged.some(
    (f) => targetFolder === f || targetFolder.startsWith(`${f}/`)
  );
}
