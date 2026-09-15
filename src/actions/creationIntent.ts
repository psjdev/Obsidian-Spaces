/**
 * The creation intent, pure (no DOM, no `"obsidian"` import).
 *
 * `Vault.on('create')` cannot attribute a create — and that is measured, not
 * assumed: the handler receives exactly one argument, the file, and an
 * empty `.md` written from outside Obsidian is field-for-field identical to
 * a native Ctrl+N create. So membership cannot
 * be granted on the strength of a create event alone.
 *
 * What IS available is a documented, user-anchored gesture: `file-menu` fires
 * with the folder the user right-clicked (the empty explorer body reports the
 * vault root), and a create event carries its parent. Joining those two on
 * the folder path attributes the create to the gesture without ever having to
 * ask who wrote the file.
 *
 * This is a CORRELATION, not attribution, and the scoping is what makes it
 * defensible: one folder, one space, one file, one short window, consumed on
 * use. For a synced file to be caught it would have to land in exactly the
 * folder just right-clicked, inside the window, while that space is active —
 * and the cost would be one member entry, visible in Settings and removable
 * from the row's own menu.
 */

/**
 * How long a gesture stays live. Long enough to read a context menu and
 * hesitate; short enough that it is not an open door. The window's real
 * safety comes from the folder match, not its length.
 */
export const INTENT_TTL_MS = 10_000;

export interface CreationIntent {
  /** The folder the user acted on. `"/"` for the vault root. */
  folderPath: string;
  /** The space that will receive the member, captured at gesture time. */
  spaceId: string;
  expiresAt: number;
}

/**
 * Records a gesture, or null when there is nothing to record.
 *
 * Null for a file target — you cannot create inside a note — and null in
 * *All*, which has no membership to grant.
 */
export function armIntent(args: {
  target: { path: string; isFolder: boolean };
  activeSpaceId: string | null;
  now: number;
  ttlMs?: number;
}): CreationIntent | null {
  if (!args.target.isFolder) return null;
  if (args.activeSpaceId === null) return null;
  return {
    folderPath: args.target.path,
    spaceId: args.activeSpaceId,
    expiresAt: args.now + (args.ttlMs ?? INTENT_TTL_MS),
  };
}

interface IntentMatch {
  spaceId: string;
  path: string;
  kind: "file" | "folder";
}

/**
 * The membership to write, or null to leave the create alone.
 *
 * `parentPath === folderPath` deliberately covers only DIRECT children: a
 * template or importer that builds a nested tree under the armed folder must
 * not have every level join the space.
 *
 * The `activeSpaceId` re-check matters because the user can switch spaces
 * between the right-click and the create; the gesture's space is then no
 * longer the one on screen, and writing to it would be a membership change
 * with no visible cause.
 */
export function matchIntent(args: {
  intent: CreationIntent | null;
  created: { path: string; parentPath: string | null; isFolder: boolean };
  activeSpaceId: string | null;
  now: number;
}): IntentMatch | null {
  const intent = args.intent;
  if (!intent) return null;
  if (args.now > intent.expiresAt) return null;
  if (args.activeSpaceId === null || args.activeSpaceId !== intent.spaceId) return null;
  if (args.created.parentPath === null) return null;
  if (args.created.parentPath !== intent.folderPath) return null;
  return {
    spaceId: intent.spaceId,
    path: args.created.path,
    kind: args.created.isFolder ? "folder" : "file",
  };
}

/**
 * Why this module never consults the visibility snapshot to decide whether
 * membership is already covered, and the caller uses `inheritedFromFolder`
 * (membershipMenu.ts) instead.
 *
 * Two reasons, both discovered the hard way:
 *
 * 1. **Ordering.** `onVaultChange` runs the handler BEFORE it replaces the
 *    vault index, so a snapshot taken inside a create handler does not know
 *    the path that was just created. It would report a file created under a
 *    member folder as a non-member, and we would write a redundant exact
 *    member for something inheritance already covers.
 * 2. **`visible` is not `member`.** `creation.ts`'s `ensureMember` skips when
 *    a path is merely visible — and a VISITOR is visible. Obsidian opens a
 *    natively-created note the instant it exists, so by the time the create
 *    event is handled it is already a visitor. Testing visibility would skip
 *    the write and leave the note dimmed and italic, which is the exact
 *    symptom this mechanism exists to remove.
 *
 * `inheritedFromFolder` is pure, reads only the space definition, and has
 * neither problem.
 */
