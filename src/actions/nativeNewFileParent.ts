import { TFolder, type App } from "obsidian";
import { noticeMissingRoot, pinnedDestination, rootIsFolder } from "./creation";
import { isVaultRoot } from "../visibility/folderSpace";

/**
 * PRIVATE OBSIDIAN API — the fourth quarantine module, added 2026-09-14
 * alongside `nativeMenuSubmenu.ts`. `createNewMarkdownFile` and
 * `createNewFolder` appear nowhere in `obsidian.d.ts`; their names stay out
 * of every other file so a grep for them cannot lie about where they're used.
 *
 * Fixes: right-clicking the empty body of the file explorer in a folder
 * space created the note at the vault root instead of the pinned folder.
 * Measured (space pinned to `Archive`): the empty body fires `file-menu`
 * with the vault root as target and its items call
 * `createNewMarkdownFile("/")`/`createNewFolder("/")` directly —
 * `getNewFileParent` is never asked, so `newFileLocation.ts` can't cover it.
 *
 * The redirect fires only when the parent IS the vault root: a real folder
 * row already creates correctly there, and in a folder space the root is
 * never a visible row, so a vault-root parent can only mean the empty body.
 * Both methods are wrapped defensively — a missing one is skipped, degrading
 * to Obsidian's own vault-root behaviour rather than throwing on load.
 */

/** A method that takes the destination folder first and anything else after. */
type ParentFirst = (parent: TFolder, ...rest: unknown[]) => unknown;

/** Every private member this module touches, named once. */
const METHODS = ["createNewMarkdownFile", "createNewFolder"] as const;

type Patchable = Record<(typeof METHODS)[number], ParentFirst | undefined>;

interface Record_ {
  wrappers: Map<string, ParentFirst>;
  originals: Map<string, ParentFirst>;
  restore: () => void;
}

/**
 * Keyed by the file manager, so two overlapping plugin instances cannot
 * clobber each other's record, and weak so a discarded `App` is not held
 * alive. Same shape as `newFileLocation.ts`'s.
 */
const patched = new WeakMap<object, Record_>();

/**
 * Replaces both creation methods and returns the teardown.
 *
 * `activeRoot` is read on EVERY call and must never be captured: the patch
 * outlives every space switch, so a root resolved at install time would go on
 * writing into the folder the user used to be in.
 */
export function installNativeCreateRedirect(
  app: App,
  activeRoot: () => string | null
): () => void {
  const fm = app.fileManager as unknown as Patchable & object;
  const existing = patched.get(fm);
  if (existing) return existing.restore;

  const wrappers = new Map<string, ParentFirst>();
  const originals = new Map<string, ParentFirst>();

  // Goes false on restore even when a wrapper cannot be lifted back out,
  // so a buried wrapper stops redirecting for a plugin that is gone.
  let live = true;

  const restore = (): void => {
    const record = patched.get(fm);
    if (!record) return;
    patched.delete(fm);
    live = false;
    for (const name of METHODS) {
      const mine = record.wrappers.get(name);
      const original = record.originals.get(name);
      if (!mine || !original) continue;
      // Only if OURS is still installed. A plugin that patched after us owns
      // the property now, and restoring over it would silently uninstall their
      // feature — the rule `nativeExplorerSort.unpatch` follows.
      if ((fm as Patchable)[name] === mine) (fm as Patchable)[name] = original;
    }
  };

  for (const name of METHODS) {
    const original = (fm as Patchable)[name];
    // Undocumented, so a future Obsidian may not have it. Skipping is the
    // degradation; throwing here would take the whole plugin down on load.
    if (typeof original !== "function") continue;

    const wrapper: ParentFirst = function (this: unknown, parent, ...rest) {
      if (!live) return original.call(this, parent, ...rest);
      const redirected = pinnedFolderFor(app, parent, activeRoot);
      return original.call(this, redirected ?? parent, ...rest);
    };
    originals.set(name, original);
    wrappers.set(name, wrapper);
    (fm as Patchable)[name] = wrapper;
  }

  patched.set(fm, { wrappers, originals, restore });
  return restore;
}

/**
 * The folder to use instead, or `undefined` to leave the call untouched.
 *
 * Asks `pinnedDestination` — the same policy `destinationFolder` and
 * `newFileLocation.ts` use — rather than re-deciding what a usable root is.
 */
function pinnedFolderFor(
  app: App,
  parent: unknown,
  activeRoot: () => string | null
): TFolder | undefined {
  // Not a folder, or a real one the user actually pointed at: not ours.
  if (!(parent instanceof TFolder) || !isVaultRoot(parent.path)) return undefined;
  const root = activeRoot();
  if (root === null) return undefined;

  const out = pinnedDestination(root, rootIsFolder(app, root));
  if (out.missingRoot) noticeMissingRoot();
  if (out.path === null) return undefined;

  const folder = app.vault.getAbstractFileByPath(out.path);
  return folder instanceof TFolder ? folder : undefined;
}
