type NativeWorkspacesStatus = "disabled" | "enabled" | "unknown";

/**
 * PRIVATE API. `app.internalPlugins` is not part of obsidian.d.ts.
 *
 * This is the only place in the codebase that reaches for it, so a future
 * Obsidian change has exactly one repair point. Verified against 1.13.7 in
 * Spike B: `internalPlugins.getEnabledPluginById` exists and `workspaces` is
 * the correct plugin id.
 *
 * Every failure mode collapses to "unknown", which callers must treat as
 * not-disabled — see effectiveRestoreLayouts.
 */
export function detectNativeWorkspaces(app: unknown): NativeWorkspacesStatus {
  try {
    const ip = (app as { internalPlugins?: unknown })?.internalPlugins as
      | { getEnabledPluginById?: (id: string) => unknown }
      | undefined;
    if (!ip || typeof ip.getEnabledPluginById !== "function") return "unknown";
    return ip.getEnabledPluginById("workspaces") ? "enabled" : "disabled";
  } catch {
    return "unknown";
  }
}

/**
 * The configured preference is never rewritten; this derives the mode actually
 * in force. "unknown" is deliberately not-disabled: if we cannot tell whether
 * another layout manager is running, we do not run ours.
 */
export function effectiveRestoreLayouts(
  configured: boolean,
  status: NativeWorkspacesStatus
): boolean {
  return configured && status === "disabled";
}
