/**
 * Whether "Create space from this folder" (main.ts's `file-menu`
 * registration) should be offered. Pure — no `"obsidian"` import.
 *
 * `!isVaultRoot(target.path)` is necessary: the empty explorer body (and a
 * folder-space's own hidden root) fires `file-menu` with a `TFolder` whose
 * path IS the vault root (measured — see `creationIntent.ts`'s "the empty
 * explorer body reports the vault root"). Without it, opening the panel from
 * a right-click on empty space in All would seed `root: "/"`, which
 * `isFolderForm` (createSpaceForm.ts) treats as no root at all, silently
 * degrading Create into an empty, unexplained space.
 *
 * Deliberately does NOT also guard `"//"` (normalizes to `""`, the other
 * vault-root spelling): neither the folder suggester nor a real
 * `TFolder.path` can produce that string. Known, deliberate gap.
 */

import { isVaultRoot } from "../visibility/folderSpace";

interface MenuTarget {
  path: string;
  isFolder: boolean;
}

/**
 * `activeSpaceId` is `null` in All AND for a dangling space selection (an id
 * `SpaceController.activeSpace()` could not resolve) — both read the same
 * way here: no active space means the item may be offered, so a stale
 * selection fails open into "All" rather than hiding the entry. Harmless,
 * since the item's own `onClick` does not depend on a real active space.
 */
export function canOfferCreateSpaceFromFolder(
  target: MenuTarget,
  activeSpaceId: string | null
): boolean {
  return target.isFolder && !isVaultRoot(target.path) && activeSpaceId === null;
}
