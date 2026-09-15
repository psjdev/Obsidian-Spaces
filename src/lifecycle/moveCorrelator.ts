/**
 * Turning an external move back into a rename. Pure — no DOM, no
 * `"obsidian"` import.
 *
 * Obsidian fires `create` at the new path and `delete` at the old, create
 * first by 600–1000ms, with nothing linking them. This repairs the move
 * outright, producing `{ oldPath, newPath }` for `repairOnRename`, which
 * rewrites by prefix across `members`, `root` and every order map. No index
 * is kept, only a few seconds of in-memory event history that expires by
 * itself — persistence buys nothing since a closed-mid-move Obsidian fires
 * no events at all.
 *
 * **It can only ever UPGRADE a delete to a move, on positive evidence** —
 * with none, it declines and the caller keeps prior behaviour. That is what
 * makes the awkward cases safe: a move OUT of the vault fires a delete with
 * no create (measured), a genuine delete likewise, and a cross-volume move
 * changes `ctime` so nothing matches.
 */

/** How long a partner event stays eligible. Comfortably past the ~1s observed. */
export const CORRELATION_WINDOW_MS = 4000;

/**
 * The buffer is capped by LENGTH as well as by age.
 *
 * `filePairs` is O(B^2) and runs once per folder delete. With only the time
 * cap, a burst (sync, importer, an externally moved 500-file folder as
 * ~1,000 create/delete events) puts the whole thing inside one 4s window:
 * 2,040 events measured at 281ms, growing quadratically.
 *
 * 256 keeps the scan at ~33k comparisons (about 1.5% of that cost) while
 * still spanning far more than a real move emits. Overflowing it can only
 * cost a correlation, never invent one: the module upgrades a delete to a
 * move on positive evidence only, so an evicted partner just declines.
 */
export const MAX_CORRELATION_BUFFER = 256;

export interface VaultEventRecord {
  kind: "create" | "delete";
  path: string;
  isFolder: boolean;
  /** Null for folders, which carry no `stat` at all (measured). */
  size: number | null;
  ctime: number | null;
  mtime: number | null;
  at: number;
}

interface MoveMapping {
  oldPath: string;
  newPath: string;
}

export function prune(
  buffer: readonly VaultEventRecord[],
  now: number,
  windowMs: number = CORRELATION_WINDOW_MS
): VaultEventRecord[] {
  const fresh = buffer.filter((e) => now - e.at <= windowMs);
  // Newest wins: the partner of the event being correlated right now is the
  // one that matters, and it is always at the young end.
  return fresh.length > MAX_CORRELATION_BUFFER
    ? fresh.slice(fresh.length - MAX_CORRELATION_BUFFER)
    : fresh;
}

/** All three stats present and equal. A folder can never satisfy this. */
function sameStats(a: VaultEventRecord, b: VaultEventRecord): boolean {
  if (a.size === null || a.ctime === null || a.mtime === null) return false;
  return a.size === b.size && a.ctime === b.ctime && a.mtime === b.mtime;
}

function inWindow(a: VaultEventRecord, b: VaultEventRecord, windowMs: number): boolean {
  return Math.abs(a.at - b.at) <= windowMs;
}

/** `{ oldPath, newPath }` from a pair, whichever direction it arrived in. */
function orient(a: VaultEventRecord, b: VaultEventRecord): MoveMapping {
  const del = a.kind === "delete" ? a : b;
  const add = a.kind === "create" ? a : b;
  return { oldPath: del.path, newPath: add.path };
}

/** Every stat-matched file pair the buffer contains, oriented old → new. */
function filePairs(buffer: readonly VaultEventRecord[], windowMs: number): MoveMapping[] {
  const out: MoveMapping[] = [];
  // Bounded HERE too, not only in `prune`. The quadratic cost must not
  // depend on a caller remembering to prune first — `correlate` is exported.
  const scan =
    buffer.length > MAX_CORRELATION_BUFFER
      ? buffer.slice(buffer.length - MAX_CORRELATION_BUFFER)
      : buffer;
  for (let i = 0; i < scan.length; i++) {
    for (let j = i + 1; j < scan.length; j++) {
      const a = scan[i];
      const b = scan[j];
      if (a.isFolder || b.isFolder) continue;
      if (a.kind === b.kind) continue;
      if (a.path === b.path) continue;
      if (!sameStats(a, b) || !inWindow(a, b, windowMs)) continue;
      out.push(orient(a, b));
    }
  }
  return out;
}

function isUnder(path: string, base: string): boolean {
  return path.startsWith(`${base}/`);
}

/**
 * The move this event completes, or null.
 *
 * `buffer` must NOT contain `event`; the caller appends after correlating so a
 * single event cannot pair with itself.
 */
export function correlate(args: {
  buffer: readonly VaultEventRecord[];
  event: VaultEventRecord;
  windowMs?: number;
}): MoveMapping | null {
  const { buffer, event } = args;
  const windowMs = args.windowMs ?? CORRELATION_WINDOW_MS;

  if (event.isFolder) return correlateFolder(buffer, event, windowMs);

  const partners = buffer.filter(
    (c) =>
      !c.isFolder &&
      c.kind !== event.kind &&
      c.path !== event.path &&
      sameStats(event, c) &&
      inWindow(event, c, windowMs)
  );
  // Ambiguity declines. Two files can share a size and a millisecond-identical
  // ctime — batch-copied or extracted together — and repointing membership at
  // the wrong one is worse than leaving it dangling.
  if (partners.length !== 1) return null;
  return orient(event, partners[0]);
}

/**
 * A folder carries no `stat`, so it is identified only through a descendant
 * whose stats do match: for a correlated child `old/rel` → `new/rel`, the
 * folder's mapping is `old` → `new`.
 *
 * Handled only for an incoming DELETE. A folder's own create arrives before its
 * descendants' deletes, so at create time there is nothing yet to key on;
 * by the time the delete arrives the whole tree is in the buffer (measured:
 * all four deletes of a moved tree land in the same millisecond, the root
 * last).
 */
function correlateFolder(
  buffer: readonly VaultEventRecord[],
  event: VaultEventRecord,
  windowMs: number
): MoveMapping | null {
  if (event.kind !== "delete") return null;

  const createdFolders = new Set(
    buffer.filter((e) => e.isFolder && e.kind === "create").map((e) => e.path)
  );

  const derived = new Set<string>();
  for (const pair of filePairs(buffer, windowMs)) {
    if (!isUnder(pair.oldPath, event.path)) continue;
    const rel = pair.oldPath.slice(event.path.length + 1);
    if (!pair.newPath.endsWith(`/${rel}`)) continue;
    const newFolder = pair.newPath.slice(0, pair.newPath.length - rel.length - 1);
    if (newFolder === event.path) continue;
    // A descendant that matches while no folder was created at the derived
    // destination means the derivation is wrong, not that a folder moved.
    if (!createdFolders.has(newFolder)) continue;
    derived.add(newFolder);
  }

  // Same rule as for files: agreement or nothing. Descendants pointing at
  // different destinations means this was not one move.
  if (derived.size !== 1) return null;
  return { oldPath: event.path, newPath: [...derived][0] };
}
