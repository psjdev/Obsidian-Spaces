/**
 * Derives the paths currently backing open main-window file leaves. Pure:
 * the caller supplies a probe, so this module never imports "obsidian" and
 * stays testable in plain node — the same arrangement
 * `src/actions/membershipMenu.ts` uses.
 *
 * This lives outside `main.ts` so it can be tested directly: three separate
 * defects in a previous ten-line version shipped past a green suite, because
 * every visibility test injects a visitor set rather than deriving one.
 */
export interface LeafProbe {
  /** A LOADED FileView's file path, or null if the leaf is not one. */
  fileViewPath(leaf: unknown): string | null;
  /**
   * A deferred leaf's view-state file path, or null.
   *
   * Obsidian defers loading background tabs: the leaf exists, its view is not
   * loaded, and it is not yet a FileView. A layout restored by changeLayout()
   * is made almost entirely of such leaves, so reading only a loaded view sees
   * an empty set precisely when the set matters most.
   */
  stateFilePath(leaf: unknown): string | null;
  /** The resolved path if it names a real file, else null. */
  resolveFilePath(path: string): string | null;
}

export function livePathsFrom(
  leaves: readonly unknown[],
  probe: LeafProbe
): Set<string> {
  const out = new Set<string>();
  for (const leaf of leaves) {
    // One leaf failing to identify itself costs one row, never the whole
    // snapshot. Both probe calls reach view code that can be mid-teardown or
    // supplied by another plugin.
    try {
      const loaded = probe.fileViewPath(leaf);
      if (loaded !== null) {
        out.add(loaded);
        continue;
      }
      const stated = probe.stateFilePath(leaf);
      if (stated === null || stated === "") continue;
      const resolved = probe.resolveFilePath(stated);
      // The RESOLVED path, never the raw view-state string: identity with the
      // vault index's keys must be enforced, not assumed.
      if (resolved !== null) out.add(resolved);
    } catch {
      continue;
    }
  }
  return out;
}
