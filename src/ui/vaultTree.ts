/**
 * What the create panel's item picker shows: the vault as a tree, flattened to
 * the rows visible at a given expansion, filter and mode.
 *
 * One tree serves both kinds of space. Curated mode shows files and folders
 * and takes any number of them; folder mode shows folders alone and takes one,
 * because a folder space has exactly one root. Files belong here because the
 * data model has always allowed file members — `MemberEntry.kind` is
 * `"file" | "folder"`, and right-click "Add to space" has been making them all
 * along. It was only the create panel that could not.
 *
 * All of the picker's decisions live here — what a filter reveals, which
 * ancestors it opens, what a mode hides — so they are testable in plain node
 * and the panel is left drawing rows. It imports nothing from `"obsidian"` and
 * knows nothing about the DOM.
 */

export type NodeKind = "file" | "folder";

interface VaultEntry {
  path: string;
  kind: NodeKind;
}

export interface VaultNode {
  /** Full vault path, the identity everything else keys on. */
  path: string;
  /** Last segment — what the row shows. */
  name: string;
  kind: NodeKind;
  children: VaultNode[];
}

interface Row {
  path: string;
  name: string;
  kind: NodeKind;
  /** Nesting level, 0 at the top. The panel turns this into an indent. */
  depth: number;
  /** Only a node with children draws a caret. A file never has any. */
  hasChildren: boolean;
  /** Effective expansion, which a filter can force — see `visibleRows`. */
  expanded: boolean;
  selected: boolean;
}

interface ViewOptions {
  /** Paths the user has opened. Ignored for a branch a filter forces open. */
  expanded: ReadonlySet<string>;
  /** Free text; empty means no filtering. */
  filter: string;
  /** Chosen paths. Folder mode holds at most one; curated holds any number. */
  selected: ReadonlySet<string>;
  /** Folder mode: files are not candidates for a root, so they are not shown. */
  foldersOnly: boolean;
}

/**
 * Flat vault entries to a sorted tree.
 *
 * Built from path segments rather than by matching parents to children, so a
 * missing intermediate cannot orphan a subtree: `a/b/c` alone still yields
 * `a › b › c`. Any intermediate invented this way is a folder — only a folder
 * can contain something.
 *
 * Folders sort before files at each level, then alphabetically: the order the
 * file explorer itself uses, and therefore the one a reader of this picker
 * already has in their head.
 */
export function buildVaultTree(entries: readonly VaultEntry[]): VaultNode[] {
  const roots: VaultNode[] = [];
  const byPath = new Map<string, VaultNode>();

  for (const entry of entries) {
    const segments = entry.path.split("/").filter((s) => s !== "");
    let prefix = "";
    let siblings = roots;
    segments.forEach((segment, i) => {
      prefix = prefix === "" ? segment : `${prefix}/${segment}`;
      const leaf = i === segments.length - 1;
      let node = byPath.get(prefix);
      if (!node) {
        node = { path: prefix, name: segment, kind: leaf ? entry.kind : "folder", children: [] };
        byPath.set(prefix, node);
        siblings.push(node);
      } else if (leaf) {
        // A path can arrive after one of its own descendants invented it as a
        // bridge. The entry's own kind is the authoritative one.
        node.kind = entry.kind;
      }
      siblings = node.children;
    });
  }

  const sort = (nodes: VaultNode[]): void => {
    nodes.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "folder" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    for (const n of nodes) sort(n.children);
  };
  sort(roots);
  return roots;
}

/**
 * The rows to render, in order.
 *
 * Without a filter this is a plain walk: a node's children appear only if the
 * node is in `expanded`.
 *
 * With one, two rules apply together. A node is KEPT if it matches or has a
 * descendant that matches — so a deep hit brings its ancestors with it rather
 * than appearing rootless — and a kept node is force-expanded, because the
 * point of typing is to be shown the thing, and honouring a stale collapsed
 * state would hide the only row that matched. A node that matches on its own
 * name keeps its whole subtree, so typing a parent's name is a way to browse
 * into it rather than a way to hide its children.
 *
 * `foldersOnly` applies FIRST, before any of that. A folder whose only
 * matching descendant was a file must disappear along with it, rather than
 * linger as a branch that opens onto nothing.
 */
export function visibleRows(tree: readonly VaultNode[], opts: ViewOptions): Row[] {
  const query = opts.filter.trim().toLowerCase();
  const rows: Row[] = [];

  const included = (node: VaultNode): boolean => !opts.foldersOnly || node.kind === "folder";
  const matches = (node: VaultNode): boolean => node.name.toLowerCase().includes(query);

  /** Whether this node survives the filter, itself or through a descendant. */
  const keep = (node: VaultNode): boolean =>
    included(node) && (query === "" || matches(node) || node.children.some(keep));

  const walk = (nodes: readonly VaultNode[], depth: number, insideMatch: boolean): void => {
    for (const node of nodes) {
      if (!included(node)) continue;
      const selfMatches = query !== "" && matches(node);
      // Inside a matched ancestor everything is shown; that is what makes a
      // parent's name a way in rather than a filter that empties it.
      const shown = query === "" || insideMatch || selfMatches || node.children.some(keep);
      if (!shown) continue;

      const children = node.children.filter(included);
      const hasChildren = children.length > 0;
      const expanded = hasChildren && (query !== "" || opts.expanded.has(node.path));
      rows.push({
        path: node.path,
        name: node.name,
        kind: node.kind,
        depth,
        hasChildren,
        expanded,
        selected: opts.selected.has(node.path),
      });
      if (expanded) walk(children, depth + 1, insideMatch || selfMatches);
    }
  };

  walk(tree, 0, false);
  return rows;
}

/**
 * Every ancestor of `path`, so the panel can open a pre-filled selection into
 * view — the right-click "Create space from this folder" entry lands with a
 * root already chosen, and a tree that showed it collapsed would hide it.
 */
export function ancestorsOf(path: string): string[] {
  const segments = path.split("/").filter((s) => s !== "");
  const out: string[] = [];
  let prefix = "";
  // The last segment is the node itself, not an ancestor.
  for (const segment of segments.slice(0, -1)) {
    prefix = prefix === "" ? segment : `${prefix}/${segment}`;
    out.push(prefix);
  }
  return out;
}
