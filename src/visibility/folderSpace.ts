/**
 * The folder-space decision, kept pure.
 *
 * A folder space is a window onto one folder: its contents render at the top
 * of the tree and the folder itself is not shown. That is achieved by answering
 * the VAULT ROOT's query with the ROOT FOLDER's children — a substitution the
 * seam's identity-based subset rule rejects by design, because it is
 * indistinguishable from a transform fabricating rows.
 *
 * So the seam takes a second predicate, `Permits`, and this module computes it.
 * The split is deliberate and mirrors source filtering's: the checker
 * (`nativeExplorerSort.ts`) and the decision (here) live in different files, so
 * a bug in one cannot disable the other. Nothing here imports `"obsidian"`.
 */

import type { SpaceDefinition } from "../types";

/**
 * Whether an out-of-input item may be returned for this folder.
 *
 * `itemPath` is `string | undefined` because `FolderItemLike.file?.path` is
 * optional at the seam; an item we cannot name is never permitted.
 */
export type Permits = (folderPath: string, itemPath: string | undefined) => boolean;

/**
 * Obsidian's root folder path is `"/"`; storage uses `""`. Both mean
 * the vault root and both reach this module, so both are accepted rather than
 * normalised at every call site.
 */
export function isVaultRoot(folderPath: string): boolean {
  return folderPath === "/" || folderPath === "";
}

/** The containing folder of a path, or `""` when it is top-level. */
export function parentPathOf(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? "" : path.slice(0, cut);
}

/**
 * Whether this space DECLARES a root, usable or not.
 *
 * This is intent, not capability: it is `true` for a space whose `root` is
 * `""` or `"/"` just as much as for `"Projects/Work"`. Validation keeps an
 * unusable root rather than deleting the space that declared it — the space
 * is not deleted, and its root
 * string is kept — so a definition can be a folder space in the
 * missing-root state: it declared a root, that root cannot be honoured, and
 * it still owns the identity and the empty-state-with-repair that
 * state requires. `rootOf` below cannot express that state on its own, because it
 * answers `null` for it and for "no root at all" alike. `hasRoot` is the
 * function that tells those two apart, and `isFolderSpace` is bound to it
 * (not to `rootOf`) for exactly that reason.
 */
export function hasRoot(space: SpaceDefinition | null | undefined): boolean {
  return typeof space?.root === "string";
}

/**
 * The space's USABLE root, or null when it has none or the one it has cannot
 * be honoured.
 *
 * A vault-root root is treated as unusable rather than obeyed: it would hoist
 * the entire vault with nothing hidden, which is *All* under a different
 * name. The schema refuses it on load by keeping
 * the space and its unusable root rather than deleting it; this is
 * the second gate, for a definition that reached memory another way.
 *
 * Null here does NOT mean "not a folder space" — see `hasRoot`/`isFolderSpace`
 * for why those two states are kept apart.
 */
export function rootOf(space: SpaceDefinition | null | undefined): string | null {
  const root = space?.root;
  if (typeof root !== "string" || isVaultRoot(root)) return null;
  return root;
}

/**
 * True when this space is a window onto a folder rather than a curated set —
 * including the missing-root state, where the folder it names cannot be
 * honoured but the space is still a folder space, not a curated one with
 * zero members. Bound to `hasRoot`, not `rootOf`: a space whose root is
 * missing must still answer `true` here, or it silently renders as an empty
 * curated space with no explanation, which is the exact failure the
 * missing-root handling exists to prevent.
 */
export function isFolderSpace(space: SpaceDefinition | null | undefined): boolean {
  return hasRoot(space);
}

/**
 * The guard, for a folder space with this root and this set of elsewhere paths.
 *
 * Two rules:
 *  - Answers `true` ONLY at the vault root. Every other folder is served by
 *    its own children, so the subset rule stands alone there.
 *  - At the vault root it permits a DIRECT child of the root, or a path the
 *    elsewhere set named. A grandchild is refused because the folder holding
 *    it is asked about separately, and permitting it here would render it twice.
 *
 * This decides entirely from two strings — `folderPath` and `itemPath` — and
 * never sees an item object, so "parent is exactly `root`" is a PATH
 * comparison, not an identity check: a fabricated item carrying a real
 * child's path would pass this test too. That is safe only because this is a
 * second gate on top of the seam's identity half (`isAllowed` in
 * `nativeExplorerSort.ts`), and because the one production caller never
 * hands the seam an item it did not itself look up as a real vault object —
 * a fact this module cannot enforce.
 */
export function makePermits(root: string, elsewhere: ReadonlySet<string>): Permits {
  return (folderPath, itemPath) => {
    if (!isVaultRoot(folderPath)) return false;
    if (typeof itemPath !== "string") return false;
    if (elsewhere.has(itemPath)) return true;
    return parentPathOf(itemPath) === root;
  };
}

/**
 * The open paths a folder space has no place for.
 *
 * A link must never lead nowhere, so a file opened from outside the
 * root still appears — flat, after the hoisted children, dimmed. There is no
 * hierarchy to hang scaffolds from, and inventing one would undo the hoist.
 *
 * Sorted, so the group's order is a property of the set rather than of the
 * order the user happened to open things in.
 */
export function elsewhereOf(root: string, livePaths: ReadonlySet<string>): string[] {
  const prefix = `${root}/`;
  const out: string[] = [];
  for (const p of livePaths) {
    // The separator matters: "Projects/Workshop" has "Projects/Work" as a
    // string prefix but is not inside it.
    if (p === root || p.startsWith(prefix)) continue;
    out.push(p);
  }
  return out.sort();
}
