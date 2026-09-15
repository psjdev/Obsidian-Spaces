import { TFolder, type App } from "obsidian";
import { noticeMissingRoot, pinnedDestination, rootIsFolder } from "./creation";

/**
 * Makes Obsidian's own "new note" gestures land inside a folder space's
 * pinned folder, by replacing `fileManager.getNewFileParent` — the only
 * entry point folder-space creation has, since spaces's own commands live
 * in the command palette. It's `@public` (`@since 1.1.13`), unlike the
 * private-API quarantine files, but still someone else's object: install is
 * idempotent and teardown restores exactly what it replaced.
 *
 * Measured before this existed: standing in a space rooted at `Archive`, the
 * explorer's New note button produced `Untitled 1.md` at the vault root — a
 * file created *in* a space and invisible *from* it.
 *
 * With no active folder space the original answer is returned untouched; a
 * curated space has no single "here", and its new files are adopted by the
 * creation-intent correlator instead (`main.ts`).
 *
 * The rule lives in `pinnedDestination` (creation.ts), not here, so it has
 * one answer. `destinationFolder` wraps that same policy but falls back to
 * `getNewFileParent` — this very method — so calling it from inside this
 * wrapper recurses until the stack blows; the policy is split out so both
 * callers can share it without re-entering each other.
 */

/** Just the two members this module touches, so a test can supply them. */
type NewFileParent = App["fileManager"]["getNewFileParent"];

/**
 * Replaces `getNewFileParent` and returns the teardown.
 *
 * `activeRoot` is called on EVERY invocation and must never be captured at
 * install time. The patch outlives a space switch — that is the whole point
 * of installing it once — so a root read at install would go on writing into
 * the folder the user *used* to be in, silently, into a real vault. The same
 * mistake in the explorer seam makes it render the unfiltered vault; it is
 * more expensive here, because that bug only shows the wrong rows and this one
 * would put a file in the wrong place.
 *
 * Installing twice is a no-op rather than a second wrapper: `bindExplorer`
 * runs many times, and the click listener beside this one already had to be
 * hoisted out of it for exactly that reason. Two wrappers would make one
 * teardown reveal the other instead of the original.
 */
export function installNewFileRedirect(app: App, activeRoot: () => string | null): () => void {
  const fm = app.fileManager;
  const existing = patched.get(fm);
  if (existing) return existing.restore;

  const original: NewFileParent = fm.getNewFileParent;

  // Goes false on restore, whether or not our wrapper can be lifted back out.
  // Without it a wrapper buried under another plugin's patch keeps redirecting
  // new files into a disabled plugin's last active space, until Obsidian
  // restarts. `nativeExplorerSort` carries the same flag for the same reason.
  let live = true;

  const wrapper = ((sourcePath: string, newFilePath?: string): TFolder => {
    // The original runs first and unconditionally: it is the fallback
    // `destinationFolder` needs, and calling it keeps any behaviour it has
    // that we do not model — "same folder as current file" reads the source
    // path, so dropping the arguments would quietly change that mode for
    // everyone.
    const fallback = original.call(fm, sourcePath, newFilePath);
    if (!live) return fallback;
    const root = activeRoot();
    if (root === null) return fallback;

    // `pinnedDestination`, NOT `destinationFolder`. The latter's fallback is
    // `getNewFileParent` — this very method — so calling it here recursed
    // until the stack blew, raising a Notice per cycle. Asking the policy
    // directly, with the fallback we already hold, is what breaks the cycle.
    const out = pinnedDestination(root, rootIsFolder(app, root));
    if (out.missingRoot) noticeMissingRoot();
    if (out.path === null) return fallback;

    // The contract is a TFolder, and callers do more with it than read
    // `.path` — `fileManager.createNewFile(parent, …)` takes the object. A
    // path-shaped literal would satisfy every assertion about paths and still
    // break the callers this exists to serve. If the lookup somehow fails,
    // Obsidian's own answer is a working folder and an invented object is not.
    const folder = app.vault.getAbstractFileByPath(out.path);
    return folder instanceof TFolder ? folder : fallback;
  }) as NewFileParent;

  const restore = (): void => {
    const record = patched.get(fm);
    if (!record) return;
    patched.delete(fm);
    live = false;
    // Only if OUR wrapper is still the installed one. A plugin that patched
    // after us owns the property now, and restoring over it would silently
    // uninstall their feature — the rule `nativeExplorerSort.unpatch` follows
    // for the sort seam, for the same reason.
    if (fm.getNewFileParent === record.wrapper) fm.getNewFileParent = record.original;
  };

  fm.getNewFileParent = wrapper;
  patched.set(fm, { wrapper, original, restore });
  return restore;
}

/**
 * Keyed by the file manager rather than held in a module-level pair, so two
 * plugin instances (a reload that overlaps the old one) cannot clobber each
 * other's record. Weak, so a discarded `App` is not kept alive by this map.
 */
const patched = new WeakMap<
  App["fileManager"],
  { wrapper: NewFileParent; original: NewFileParent; restore: () => void }
>();
