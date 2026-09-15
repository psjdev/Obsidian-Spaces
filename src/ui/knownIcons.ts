import { getIconIds } from "obsidian";
import { normalizeIconId } from "./iconPicker";

/**
 * Every icon id this build can draw, bare and memoised.
 *
 * Extracted from `SwitcherView` when the header became a second reader:
 * `getIconIds()` walks Obsidian's whole registry (~1500 ids) and both views
 * re-render on every switch and every definitions change, so each needs the
 * memo — and two private copies of it would be two things to keep in step.
 *
 * The cache is module-level rather than per-instance because the icon registry
 * does not change within a session. That does make it global state, which is
 * why it holds nothing but a derived constant.
 */
let cache: ReadonlySet<string> | null = null;

export function knownIconIds(): ReadonlySet<string> {
  if (cache) return cache;
  try {
    cache = new Set(getIconIds().map(normalizeIconId));
  } catch {
    // An empty set tells `renderableIcon` to trust what is stored rather than
    // replace every icon with the fallback.
    cache = new Set<string>();
  }
  return cache;
}
