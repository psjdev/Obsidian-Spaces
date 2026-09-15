import { AbstractInputSuggest, type App } from "obsidian";
import { folderCandidates, type VaultSource } from "./createSpaceForm";

/**
 * Backs a folder-path field's autocomplete. All matching logic is
 * `folderCandidates` (createSpaceForm.ts) — this class only adapts
 * Obsidian's popover to that pure function and reports a pick outward.
 * `renderSuggestion`/`getSuggestions` are abstract on `AbstractInputSuggest`;
 * `selectSuggestion` is not, but is overridden here (rather than using the
 * `onSelect` callback) so a pick both notifies the caller AND clears the
 * input in one place, instead of splitting that across two hooks.
 *
 * `onError` exists because the degradation covers
 * only a *construction*-time throw. `getSuggestions` runs on every keystroke,
 * long after construction succeeded, and a throw there must not leave the
 * field silently dead — it reports outward so the caller can flip the field
 * to its plain-input fallback.
 *
 * Extracted from `CreateSpacePanel.ts` so a second
 * caller — the missing-root state's "Change folder…" affordance — can share
 * it rather than reimplementing the same `AbstractInputSuggest` adapter. The
 * class itself was already self-contained: every dependency arrives through
 * the constructor, and nothing here reaches back into `CreateSpacePanel`'s
 * own state. Only the OWNERSHIP (who constructs it, who tears it down, who
 * reads `isPopoverOpen`) stays with each caller.
 */
export class FolderSuggest extends AbstractInputSuggest<string> {
  /**
   * Tracked so a caller's document-level
   * Escape listener can tell "the popover is open, Escape should close only
   * it" from "nothing is open, Escape should close something else" —
   * `PopoverSuggest` (the Obsidian base class) exposes no public getter for
   * this, only `open()`/`close()`, which it already calls as its actual
   * entry/exit points (they are the documented, overridable public API — not
   * a private implementation detail this reaches around). Overriding them to
   * track a flag stays inside that public surface, unlike reading an internal
   * DOM class name, which the quarantine keeps private API away from
   * this file entirely.
   */
  private popoverOpen = false;

  constructor(
    app: App,
    textInputEl: HTMLInputElement,
    private readonly folders: VaultSource,
    private readonly onPick: (path: string) => void,
    private readonly onError: (e: unknown) => void
  ) {
    super(app, textInputEl);
  }

  get isPopoverOpen(): boolean {
    return this.popoverOpen;
  }

  override open(): void {
    this.popoverOpen = true;
    super.open();
  }

  override close(): void {
    this.popoverOpen = false;
    super.close();
  }

  protected override getSuggestions(query: string): string[] {
    try {
      return folderCandidates(this.folders, query);
    } catch (e) {
      this.onError(e);
      return [];
    }
  }

  override renderSuggestion(value: string, el: HTMLElement): void {
    el.setText(value);
  }

  override selectSuggestion(value: string): void {
    this.onPick(value);
    this.setValue("");
    this.close();
  }
}
