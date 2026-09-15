/**
 * The icon picker rules, pure (no DOM, no `"obsidian"` import).
 *
 * Obsidian bundles Lucide and exposes every registered id through
 * `getIconIds()`, so searching the whole set costs no bundled data — the
 * caller passes the ids in and this module never learns where they came from.
 */

import { PRESET_ICONS } from "./createSpaceForm";

/**
 * The grid shown before anything is typed. Starts with the create panel's
 * presets so the two surfaces agree on what a space's icon usually looks like,
 * then broadens enough to fill a grid without becoming a scroll of its own.
 *
 * A curated default matters because the full set is ~1500 icons: opening
 * straight into all of them is a wall, and picking from a wall is worse than
 * picking from a shelf.
 */
export const CURATED_ICONS: readonly string[] = [
  ...PRESET_ICONS,
  "folder",
  "file-text",
  "notebook-pen",
  "calendar",
  "check-square",
  "list-todo",
  "star",
  "heart",
  "flag",
  "bookmark",
  "lightbulb",
  "flask-conical",
  "graduation-cap",
  "building-2",
  "users",
  "message-square",
  "mail",
  "phone",
  "camera",
  "music",
  "film",
  "gamepad-2",
  "plane",
  "map-pin",
  "compass",
  "wrench",
  "cpu",
  "database",
  "terminal",
  "git-branch",
  "shield",
  "key",
];

/**
 * Obsidian reports its Lucide ids prefixed (`lucide-box`), but a space's stored
 * icon has always been the bare name (`box`) and `setIcon` accepts either.
 * Everything here is compared and stored bare, so a search result and a preset
 * are the same string.
 */
export function normalizeIconId(id: string): string {
  return id.startsWith("lucide-") ? id.slice("lucide-".length) : id;
}

/**
 * `isIconIdShape` moved to `definitions/appearance.ts` — it decides
 * what may be written to `data.json` as a space icon, which is domain
 * validation rather than a picker concern, and `actions/spaceLifecycle.ts` was
 * importing it up out of this layer. Re-exported because the picker's own
 * tests and callers read it from here.
 */
export { isIconIdShape } from "../definitions/appearance";

function basenameRank(id: string, q: string): number {
  return id.startsWith(q) ? 0 : 1;
}

/**
 * The grid's contents for a given query.
 *
 * Empty query returns the curated shelf. Otherwise every known id is matched on
 * substring and ranked the same way `folderCandidates` ranks folders — a prefix
 * is what the user most likely meant, then shorter names as the more general
 * ones, then alphabetical so the order is stable rather than incidental.
 *
 * `limit` exists because an unfiltered grid of ~1500 icons is a scroll, not a
 * choice; a short query like "a" would otherwise render most of the set.
 */
export function iconSearchResults(args: {
  query: string;
  allIds: readonly string[];
  curated?: readonly string[];
  limit?: number;
}): string[] {
  const limit = args.limit ?? 60;
  const q = args.query.trim().toLowerCase();
  if (q === "") return [...(args.curated ?? CURATED_ICONS)].slice(0, limit);

  const seen = new Set<string>();
  const matches: string[] = [];
  for (const raw of args.allIds) {
    const id = normalizeIconId(raw);
    if (seen.has(id)) continue;
    if (!id.toLowerCase().includes(q)) continue;
    seen.add(id);
    matches.push(id);
  }

  matches.sort((a, b) => {
    const ar = basenameRank(a, q);
    const br = basenameRank(b, q);
    if (ar !== br) return ar - br;
    if (a.length !== b.length) return a.length - b.length;
    return a.localeCompare(b);
  });
  return matches.slice(0, limit);
}

/**
 * The icon to actually render for a stored value.
 *
 * `setIcon` draws NOTHING for a name Lucide does not know, which leaves a blank
 * switcher button with no clue why — reachable through a hand-edited
 * `data.json`, or a space written by a future version with icons this build
 * lacks. Falling back keeps a space clickable and identifiable, which matters
 * more than honouring an id that cannot be drawn.
 */
export function renderableIcon(
  stored: string | undefined,
  known: ReadonlySet<string>,
  fallback = "box"
): string {
  if (!stored) return fallback;
  const id = normalizeIconId(stored);
  // An empty known-set means the caller could not enumerate icons; trusting the
  // stored value is better than replacing every icon with the fallback.
  if (known.size === 0) return id;
  return known.has(id) ? id : fallback;
}
