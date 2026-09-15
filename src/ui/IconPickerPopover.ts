import { Notice, getIconIds, setIcon } from "obsidian";
import { AnchoredPopover } from "./AnchoredPopover";
import { CURATED_ICONS, iconSearchResults, normalizeIconId } from "./iconPicker";

/**
 * The "Change Space Icon…" picker.
 *
 * A small popover anchored just above the switcher strip, in the manner of
 * Arc's icon picker. It searches every
 * icon Obsidian has registered, which is why this feature bundles no icon data.
 *
 * **Deliberately not an Obsidian `Modal`.** That was the first implementation
 * and it was wrong: a `Modal` is ~700px wide, centred on the whole window, and
 * dims everything behind it — a full-screen interruption for picking a 16px
 * glyph, and nothing like the reference. This is an owned element on `body`,
 * `position: fixed`, measured against the control that opened it.
 *
 * It is attached to `body` rather than the pane because the sidebar clips its
 * own overflow, and a popover anchored above the bottom strip is exactly the
 * thing that would be cut off.
 *
 * It decides nothing: which ids to show for a query is `iconSearchResults`,
 * tested in plain node.
 *
 * Returns the popover so its opener can close it (see `AnchoredPopover`).
 */
export function openIconPicker(
  anchor: HTMLElement,
  currentIcon: string,
  apply: (icon: string) => Promise<void>,
  /** Passed through to `AnchoredPopover`; see its `placement`. */
  placement?: "above" | "below"
): AnchoredPopover {
  let allIds: string[];
  try {
    allIds = getIconIds().map(normalizeIconId);
  } catch {
    // Degrade to the curated shelf rather than showing an empty picker.
    allIds = [...CURATED_ICONS];
  }
  let query = "";

  const pop = new AnchoredPopover({
    anchor,
    placement,
    className: "spaces-icon-popover",
    ariaLabel: "Choose an icon",
    build: (root, popover) => {
      const doc = root.ownerDocument;

      const search = doc.win.createEl("input");
      search.type = "text";
      search.className = "spaces-icon-search";
      search.placeholder = "Search icons…";
      search.setAttribute("aria-label", "Search icons");
      root.appendChild(search);

      const grid = doc.win.createDiv();
      grid.className = "spaces-icon-grid";
      root.appendChild(grid);

      const renderGrid = (): void => {
        grid.replaceChildren();
        const ids = iconSearchResults({ query, allIds });
        if (ids.length === 0) {
          const empty = doc.win.createDiv();
          empty.className = "spaces-icon-empty";
          empty.textContent = "No matching icon";
          grid.appendChild(empty);
          popover.reposition();
          return;
        }
        for (const id of ids) {
          const cell = doc.win.createDiv();
          cell.className = "spaces-icon-cell";
          cell.setAttribute("role", "button");
          cell.setAttribute("tabindex", "0");
          // The name, not the glyph alone — a bare icon announces nothing.
          cell.setAttribute("aria-label", id);
          cell.setAttribute("aria-pressed", String(id === currentIcon));
          if (id === currentIcon) cell.classList.add("is-selected");
          try {
            setIcon(cell, id);
          } catch {
            continue;
          }
          const choose = (): void => {
            void apply(id).catch((err) => {
              new Notice(`Spaces: could not change the icon (${String(err)})`);
            });
            popover.close();
          };
          cell.addEventListener("click", choose);
          cell.addEventListener("keydown", (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              choose();
            }
          });
          grid.appendChild(cell);
        }
        // The grid's height changes with the result count, so the
        // anchor-relative position has to be recomputed or a short list floats
        // away from the strip.
        popover.reposition();
      };

      search.addEventListener("input", () => {
        query = search.value;
        renderGrid();
      });
      renderGrid();
      search.focus();
    },
  });
  pop.open();
  return pop;
}
