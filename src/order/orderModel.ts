/**
 * The ordering rules, as pure functions over arrays of paths.
 *
 * No DOM, no `"obsidian"` import, no knowledge of spaces or visibility.
 * Ordering must never consult visibility, and keeping this module ignorant of
 * both is how that rule is enforced rather than merely stated.
 */

/** Total order for one folder's children, keyed by folder path ("" is the vault root). */
export type OrderMap = Record<string, string[]>;

/**
 * The rendering rule. `live` arrives in Obsidian's OWN sorted order, and
 * unlisted entries must keep it — that is what makes an untouched folder, and the
 * unlisted tail of a touched one, sort natively.
 *
 * Listed-but-not-live paths are skipped here and NOT removed: a path can be
 * missing because the space filters it or because the file is gone, and this
 * function cannot tell those apart. Storage is compacted by `compact` on write.
 */
export function applyOrder(order: string[] | undefined, live: string[]): string[] {
  if (!order || order.length === 0) return live;
  const liveSet = new Set(live);
  const listed = order.filter((p) => liveSet.has(p));
  if (listed.length === 0) return live;
  const claimed = new Set(listed);
  const rest = live.filter((p) => !claimed.has(p));
  return [...listed, ...rest];
}

function clampIndex(i: number, len: number): number {
  if (i < 0) return 0;
  if (i > len) return len;
  return i;
}

/** Moves an already-listed path. `toIndex` is the position AFTER removal. */
export function moveWithin(order: string[], path: string, toIndex: number): string[] {
  const from = order.indexOf(path);
  if (from === -1) return order;
  const without = order.filter((p) => p !== path);
  const at = clampIndex(toIndex, without.length);
  return [...without.slice(0, at), path, ...without.slice(at)];
}

/** Inserts a path that may or may not already be listed. */
export function insertAt(order: string[], path: string, toIndex: number): string[] {
  if (order.includes(path)) return moveWithin(order, path, toIndex);
  const at = clampIndex(toIndex, order.length);
  return [...order.slice(0, at), path, ...order.slice(at)];
}

/** Drops entries that no longer resolve, preserving the order of survivors. */
export function compact(order: string[], live: Set<string>): string[] {
  return order.filter((p) => live.has(p));
}
