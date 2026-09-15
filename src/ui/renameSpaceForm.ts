/**
 * The rename rules, pure (no DOM, no `"obsidian"` import).
 *
 * Renaming has two entrances — the space header and the switcher's
 * context menu — and deliberately no shared widget, because the header shows
 * only the ACTIVE space while the menu is offered on every icon. This module
 * is what they share instead: the single place either one decides what counts
 * as a name.
 */

import { MAX_SPACE_NAME_LENGTH } from "../definitions/schema";

export { MAX_SPACE_NAME_LENGTH };

/**
 * The name to write, or null to leave the space's name alone.
 *
 * Null covers both refusals, and both are silent by design:
 *
 * - **Empty** is a cancel. Commits happen on blur as well as Enter, so
 *   clearing the field and clicking elsewhere must not be able to destroy a
 *   name — and a nameless space is unreachable in the switcher, whose only
 *   affordance is a 28px icon carrying the name as its `aria-label`.
 * - **Too long** is refused rather than truncated: truncating writes something
 *   the user did not type and did not see. The limit is checked here so it
 *   never reaches `validateSpace`, which rejects the WHOLE definitions write
 *   rather than the one field — the same reason `setSpaceColor` guards its hex.
 *
 * The length is measured after trimming, or a paste with trailing newlines
 * would be rejected for a length the stored name would never have had.
 */
export function normalizeSpaceName(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_SPACE_NAME_LENGTH) return null;
  return trimmed;
}
