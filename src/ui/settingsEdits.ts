/**
 * The parts of the settings tab that can be reasoned about without a DOM.
 *
 * `SettingsTab.ts` imports `"obsidian"`, whose npm package is types-only
 * (`"main": ""`), so it throws at import time under vitest and cannot be
 * Layer 1 tested. Everything here is declared against structural interfaces
 * instead — the same reason `src/actions/membershipMenu.ts` exists — so the
 * three behaviours below are covered in plain node and the tab keeps only
 * the wiring.
 */

/**
 * A settings control that persists from its `blur` handler.
 *
 * Removing a focused element from the document does NOT fire `blur` (the HTML
 * standard's focus fixup moves focus to the body silently; verified in
 * `tests/settingsBlurFlush.test.ts`), and `PluginSettingTab.hide()` empties
 * `containerEl` — so an edit typed and then abandoned with Escape was written
 * nowhere. `hide()` flushes through the ledger below instead.
 */
export interface BlurCommittedField {
  /**
   * The control's current content, already reduced to the exact form that
   * would be persisted. Comparing canonical forms is what keeps a flush from
   * re-writing a value `blur` already wrote.
   */
  current(): string;
  /**
   * Whether `value` is worth persisting at all — an emptied rename box is not
   * a rename. A rejected value leaves the baseline alone, so the field stays
   * live for the next edit. Absent means everything is acceptable.
   */
  accepts?(value: string): boolean;
  /** Persist. Only called with a value that is both new and accepted. */
  write(value: string): void;
}

/**
 * Remembers what each blur-committed control last persisted, so the
 * same commit path serves both `blur` and `hide()` and neither writes twice.
 */
export class BlurCommitLedger {
  /** field → the value it is known to have persisted. */
  private readonly committed = new Map<BlurCommittedField, string>();

  /**
   * `initial` is what the store already holds, in the field's own canonical
   * form — not the empty string, or the first flush would rewrite every
   * untouched control on the tab.
   */
  track(field: BlurCommittedField, initial: string): void {
    this.committed.set(field, initial);
  }

  /** Called from the field's `blur` handler. Returns whether it wrote. */
  commit(field: BlurCommittedField): boolean {
    const last = this.committed.get(field);
    // An untracked field is a field from a previous render whose controls are
    // already detached; writing through it would resurrect a stale value.
    if (last === undefined) return false;
    const value = field.current();
    if (value === last) return false;
    if (field.accepts && !field.accepts(value)) return false;
    field.write(value);
    this.committed.set(field, value);
    return true;
  }

  /**
   * Called from `hide()` before the container is emptied. Returns how many
   * fields still had an uncommitted edit.
   */
  flush(): number {
    let written = 0;
    for (const field of this.committed.keys()) {
      try {
        if (this.commit(field)) written++;
      } catch (e) {
        // One control failing to persist must not strand the others: this is
        // the last chance any of them gets.
        console.error("Spaces: could not flush a settings edit", e);
      }
    }
    return written;
  }

  /** `display()` rebuilds every control, so the old ones must be forgotten. */
  clear(): void {
    this.committed.clear();
  }
}


/** What the confirmation has to say to be worth reading. */
interface DeletableSpace {
  name: string;
  memberCount: number;
  missingCount: number;
}

export interface ConfirmPrompt {
  title: string;
  body: string;
  confirmLabel: string;
}

/**
 * This tab supports bulk management — "you delete several in a sitting" —
 * and the Delete button sits one click right of a rename field, so the
 * confirmation has to name which space and how much of it is at stake. A
 * bare "Are you sure?" would be the same mis-click with one more step.
 */
export function deleteConfirmPrompt(space: DeletableSpace): ConfirmPrompt {
  const noun = space.memberCount === 1 ? "member" : "members";
  // The same rule as the settings list: a count that silently includes
  // entries whose file is gone reads as a lie once you know.
  const missing = space.missingCount > 0 ? `, ${space.missingCount} missing` : "";
  return {
    title: `Delete "${space.name}"?`,
    body:
      `This space has ${space.memberCount} ${noun}${missing}. ` +
      "Deleting it also discards its saved order and layout. This cannot be undone.",
    confirmLabel: "Delete",
  };
}

/**
 * The side of the deletion confirmation that touches Obsidian, kept behind
 * an interface.
 */
interface ConfirmedDeletion {
  confirm(prompt: ConfirmPrompt): Promise<boolean>;
  remove(): Promise<void>;
  /** Re-render the tab. Only on a delete that actually happened. */
  onDeleted(): void;
  onError(message: string): void;
}

/**
 * Returns whether the space was deleted. A cancel leaves the tab
 * untouched — re-rendering after a cancel would throw away whatever the user
 * had half-typed into the rename field beside the button.
 */
export async function deleteWithConfirm(
  space: DeletableSpace,
  io: ConfirmedDeletion
): Promise<boolean> {
  if (!(await io.confirm(deleteConfirmPrompt(space)))) return false;
  try {
    await io.remove();
  } catch (e) {
    // Previously this rejection escaped an async onClick and became an
    // unhandled rejection, so a failed write looked exactly like a success.
    io.onError(`Spaces: could not delete "${space.name}" (${String(e)})`);
    return false;
  }
  io.onDeleted();
  return true;
}
