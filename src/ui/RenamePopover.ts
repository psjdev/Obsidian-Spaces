import { Notice } from "obsidian";
import { AnchoredPopover } from "./AnchoredPopover";
import { MAX_SPACE_NAME_LENGTH, normalizeSpaceName } from "./renameSpaceForm";

/**
 * The switcher context menu's "Rename Space…".
 *
 * A separate widget from the header's inline rename, on purpose. The header
 * shows only the ACTIVE space, but this menu is offered on every icon, so
 * routing the menu through the header's input would either edit the wrong
 * space or force a switch as a side effect of renaming. The two share
 * `renameSpaceForm.ts`, not a widget.
 *
 * Positioning and dismissal come from `AnchoredPopover`, so it behaves exactly
 * like the and the pickers.
 */
interface RenamePopoverDeps {
  anchor: HTMLElement;
  current: string;
  /** Rejects on a failed write. */
  apply(name: string): Promise<void>;
}

/** Returns the popover so its opener can close it (see `AnchoredPopover`). */
export function openRenamePopover(deps: RenamePopoverDeps): AnchoredPopover {
  const popover = new AnchoredPopover({
    anchor: deps.anchor,
    className: "spaces-rename-popover",
    ariaLabel: `Rename ${deps.current}`,
    build: (root, pop) => {
      const doc = root.ownerDocument;

      const input = doc.win.createEl("input");
      input.type = "text";
      input.className = "spaces-rename-input";
      input.setAttribute("aria-label", "Space name");
      // Caps typing and paste at the schema's limit, so the common way to
      // reach an invalid name never happens; `normalizeSpaceName` still has
      // the last word.
      input.maxLength = MAX_SPACE_NAME_LENGTH;
      input.value = deps.current;

      const commit = (): void => {
        const next = normalizeSpaceName(input.value);
        // Null is a cancel, never an error: an emptied field keeps the
        // old name rather than raising a dialog that teaches nothing.
        if (next && next !== deps.current) {
          void deps.apply(next).catch((e: unknown) => {
            new Notice(`Spaces: could not rename the space (${String(e)})`);
          });
        }
        pop.close();
      };

      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          // Stopped here as well as prevented: the popover's own Escape
          // handler is on the document in capture, and letting this reach
          // Obsidian would close the sidebar behind the popover too.
          e.preventDefault();
          e.stopPropagation();
          pop.close();
        }
      });

      const go = doc.win.createEl("button");
      go.className = "mod-cta";
      go.textContent = "Rename";
      go.addEventListener("click", commit);

      root.appendChild(input);
      root.appendChild(go);

      // After `build` returns, `open()` repositions and the element is in the
      // document, so focusing now is safe and puts the caret where the user
      // is already looking.
      input.focus();
      input.select();
    },
  });

  popover.open();
  return popover;
}
