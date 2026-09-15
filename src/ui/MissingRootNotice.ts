import { Notice, TFolder, type App } from "obsidian";
import { openFolderPickerPopover } from "./FolderPickerPopover";
import type { AnchoredPopover } from "./AnchoredPopover";
import type { VaultSource } from "./createSpaceForm";
import { isFolderSpace, isVaultRoot } from "../visibility/folderSpace";
import type { SpaceDefinition } from "../types";

/**
 * The standing notice shown while a folder pinned space cannot show its
 * folder, and the "Change folder…" picker that repairs it.
 *
 * A folder pinned space whose root is gone renders an empty tree. Empty is
 * indistinguishable from "this folder really is empty", so the state is
 * announced rather than left to be inferred — with the repair attached to the
 * message, because the user cannot fix it from an empty pane.
 */
interface MissingRootDeps {
  /**
   * Resolved per call, like the rest: this is constructed as a field
   * initialiser, so an `App` captured by value here can be captured before
   * one exists.
   */
  app: () => App;
  /** The space the tree is filtered to, or null in All. */
  activeSpace: () => SpaceDefinition | null;
  /** Folder candidates for the picker, read fresh so new folders appear. */
  folders: () => VaultSource;
  /** Writes the chosen root back to the space. */
  setRoot: (spaceId: string, path: string) => Promise<void>;
}

export class MissingRootNotice {
  private notice: Notice | null = null;

  /**
   * Which space the notice is about. One value, not a set: only the active
   * space can be in this state, and only one space is active.
   */
  private aboutSpaceId: string | null = null;

  /**
   * The message currently displayed, so a change WHILE the same space stays
   * active — renaming it, or picking a root that is also missing — rewrites
   * the existing notice instead of stacking a second one.
   */
  private shownKey: string | null = null;

  private popover: AnchoredPopover | null = null;

  constructor(private readonly deps: MissingRootDeps) {}

  /** Raises, updates or withdraws the notice to match the active space. */
  report(): void {
    const space = this.deps.activeSpace();
    const detail = space ? this.detailFor(space) : null;
    if (space === null || detail === null) {
      this.clear();
      return;
    }

    const key = `${space.name} ${detail}`;
    // `isConnected` distinguishes a live toast from one Obsidian has already
    // dismissed; without it a dismissed notice would never be raised again.
    if (this.aboutSpaceId === space.id && this.notice?.noticeEl.isConnected) {
      if (this.shownKey !== key) {
        this.shownKey = key;
        this.notice.setMessage(this.message(space, detail));
      }
      return;
    }

    this.clear();
    this.aboutSpaceId = space.id;
    this.shownKey = key;
    // `0` means it stays until the state is fixed. A timed notice would let
    // the tree sit empty with nothing saying why.
    this.notice = new Notice(this.message(space, detail), 0);
  }

  clear(): void {
    this.notice?.hide();
    this.notice = null;
    this.aboutSpaceId = null;
    this.shownKey = null;
    this.popover?.close();
    this.popover = null;
  }

  /** Withdraws the notice only if it is about this space — used when one is deleted. */
  clearIfAbout(spaceId: string): void {
    if (this.aboutSpaceId === spaceId) this.clear();
  }

  /**
   * What is wrong with this space's root, or null when nothing is.
   *
   * Two different faults, worth distinguishing: a root that was chosen and has
   * since gone, versus one that was never chosen. Both render the same empty
   * tree; only the first is a fault the user did not cause.
   */
  private detailFor(space: SpaceDefinition): string | null {
    if (!isFolderSpace(space)) return null;
    const root = space.root;
    const declared = typeof root === "string" && !isVaultRoot(root);
    if (declared && this.rootExists(root)) return null;
    return declared ? `"${root}" no longer exists` : "no folder has been chosen for it yet";
  }

  private rootExists(root: string): boolean {
    return this.deps.app().vault.getAbstractFileByPath(root) instanceof TFolder;
  }

  private message(space: SpaceDefinition, detail: string): DocumentFragment {
    const frag = document.createDocumentFragment();
    const text = document.createElement("span");
    text.textContent = `Spaces: "${space.name}" is a folder pinned space, and ${detail}. `;
    frag.appendChild(text);

    const change = document.createElement("button");
    change.textContent = "Change folder…";
    change.className = "mod-cta";
    change.addEventListener("click", (e) => {
      // Obsidian dismisses a notice on click; without stopping this the
      // picker's anchor would be removed as it opened.
      e.preventDefault();
      e.stopPropagation();
      this.openPicker(space, change);
    });
    frag.appendChild(change);
    return frag;
  }

  private openPicker(space: SpaceDefinition, anchor: HTMLElement): void {
    this.popover?.close();
    const root = space.root;
    this.popover = openFolderPickerPopover({
      anchor,
      app: this.deps.app(),
      folders: this.deps.folders(),
      current: typeof root === "string" && !isVaultRoot(root) ? root : "",
      apply: (path) => this.deps.setRoot(space.id, path),
    });
  }
}
