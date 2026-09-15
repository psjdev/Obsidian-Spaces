import type { ActiveSelection, LayoutBlob, SwitchOutcome } from "../types";
import { sameSelection } from "../order/sortOverride";
import type { RuntimeStateStore } from "../runtime/RuntimeStateStore";

/**
 * The workspace, as this coordinator needs it. Injected so the state machine
 * below is testable with no Obsidian runtime.
 */
export interface WorkspaceLayoutPort {
  capture(): LayoutBlob;
  restore(layout: LayoutBlob): Promise<void>;
  /** Leaves in the main area. Used to verify a restore actually worked. */
  mainLeafCount(): number;
}

export class LayoutCoordinator {
  constructor(
    private port: WorkspaceLayoutPort,
    private runtime: RuntimeStateStore
  ) {}

  async transition(
    from: ActiveSelection,
    to: ActiveSelection,
    enabled: boolean
  ): Promise<SwitchOutcome> {
    // While restoration is disabled, this neither captures nor restores, so
    // a layout loaded by the native Workspaces plugin can never silently
    // become a spaces layout.
    if (!enabled) return { kind: "skipped" };

    // A self-transition must not capture. `capture()` returns whatever
    // changeLayout() actually produced, which silently drops leaves it could
    // not resolve (Spike B F20), so writing it into `from`'s own slot would
    // replace the user's saved layout with a pruned copy of itself — no
    // restore failure required. There is nothing to restore either: the
    // target's layout is the one already on screen. "skipped" is the truthful
    // outcome (nothing captured, nothing restored) and correctly tells the
    // host there is no rebuilt explorer to rebind.
    if (sameSelection(from, to)) return { kind: "skipped" };

    const outgoing = this.port.capture();
    this.runtime.setLayoutFor(from, outgoing);

    const target = this.runtime.getLayoutFor(to);
    if (!target) {
      // Adopt what is on screen and capture on departure.
      this.runtime.setLayoutFor(to, outgoing);
      return { kind: "adopted" };
    }

    const failure = await this.tryRestore(target);
    if (!failure) return { kind: "restored" };

    const rollbackFailure = await this.tryRestore(outgoing);
    if (!rollbackFailure) return { kind: "rolled-back", reason: failure };
    return { kind: "failed-open", reason: `${failure}; rollback: ${rollbackFailure}` };
  }

  /** Returns null on success, or a reason string on failure. */
  private async tryRestore(layout: LayoutBlob): Promise<string | null> {
    try {
      await this.port.restore(layout);
    } catch (e) {
      return `restore threw: ${String(e)}`;
    }
    // Spike B F20: changeLayout() accepts malformed input without throwing, so
    // the absence of an exception proves nothing. Inspect the result instead.
    if (this.port.mainLeafCount() <= 0) return "restore produced an empty workspace";
    return null;
  }
}
