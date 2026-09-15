import type { ActiveSelection, LayoutBlob } from "../types";
import { withOverride, type SortOverrides } from "../order/sortOverride";

interface RuntimeBacking {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
}

const KEY = "spaces:runtime";

/**
 * The key this state was written under before the plugin was renamed.
 *
 * Read-only, and read only when the current key holds nothing: the rename
 * would otherwise reset the active space, every stored tab layout and every
 * sort override at once, with nothing to say why. The old value is left where
 * it is rather than moved, so an install that goes back to the previous build
 * still finds its state.
 */
const LEGACY_KEY = "spacejam:runtime";
const ALL: ActiveSelection = { kind: "all" };

function parseSelection(raw: unknown): ActiveSelection {
  if (!raw || typeof raw !== "object") return ALL;
  const sel = (raw as Record<string, unknown>).activeSelection;
  if (!sel || typeof sel !== "object") return ALL;
  const s = sel as Record<string, unknown>;
  if (s.kind === "all") return ALL;
  if (s.kind === "space" && typeof s.id === "string" && s.id) {
    return { kind: "space", id: s.id };
  }
  return ALL;
}

function isBlob(v: unknown): v is LayoutBlob {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function parseLayouts(raw: unknown): Record<string, LayoutBlob> {
  if (!raw || typeof raw !== "object") return {};
  const m = (raw as Record<string, unknown>).layoutsBySpaceId;
  if (!isBlob(m)) return {};
  const out: Record<string, LayoutBlob> = {};
  for (const [k, v] of Object.entries(m)) if (isBlob(v)) out[k] = v;
  return out;
}

function parseOverrides(raw: unknown): SortOverrides {
  const empty: SortOverrides = { all: false, bySpaceId: {} };
  if (!raw || typeof raw !== "object") return empty;
  const r = raw as Record<string, unknown>;
  const bySpaceId: Record<string, boolean> = {};
  const m = r.nativeSortBySpaceId;
  if (m && typeof m === "object" && !Array.isArray(m)) {
    // Only `true` survives: a hand-edited file must degrade rather than
    // throw, and a truthy non-boolean must not read as an override.
    for (const [k, v] of Object.entries(m as Record<string, unknown>)) {
      if (v === true) bySpaceId[k] = true;
    }
  }
  return { all: r.allNativeSort === true, bySpaceId };
}

export class RuntimeStateStore {
  private selection: ActiveSelection = ALL;
  private allLayout: LayoutBlob | null = null;
  private layouts: Record<string, LayoutBlob> = {};
  private overrides: SortOverrides = { all: false, bySpaceId: {} };

  constructor(
    private backing: RuntimeBacking,
    private onWriteError?: (e: unknown) => void
  ) {}

  load(): void {
    try {
      const raw = this.backing.get(KEY) ?? this.backing.get(LEGACY_KEY);
      this.selection = parseSelection(raw);
      this.layouts = parseLayouts(raw);
      const a = raw && typeof raw === "object"
        ? (raw as Record<string, unknown>).allLayout
        : undefined;
      this.allLayout = isBlob(a) ? a : null;
      this.overrides = parseOverrides(raw);
    } catch (e) {
      this.selection = ALL; // fail open
      this.allLayout = null;
      this.layouts = {};
      this.overrides = { all: false, bySpaceId: {} };
      // This catch used to be completely silent, unlike
      // `DefinitionStore.load()`'s equivalent. Falling open here silently
      // resets the active space, every stored layout and every sort override
      // at once, and left the user nothing anywhere to explain it. Once per
      // session by construction rather than by a flag: `load()` is called
      // exactly once, from `main.ts`'s `onload`, so there is nothing here to
      // flood — which is why this needs no `warned` guard of the kind
      // `nativeExplorerSort.ts` carries for its per-sort catch.
      console.error("Spaces: could not read stored runtime state; starting in All", e);
    }
  }

  getSelection(): ActiveSelection {
    return this.selection;
  }

  setSelection(selection: ActiveSelection): void {
    this.selection = selection;
    this.persist();
  }

  getLayoutFor(sel: ActiveSelection): LayoutBlob | null {
    if (sel.kind === "all") return this.allLayout;
    return this.layouts[sel.id] ?? null;
  }

  setLayoutFor(sel: ActiveSelection, layout: LayoutBlob): void {
    if (sel.kind === "all") this.allLayout = layout;
    else this.layouts[sel.id] = layout;
    this.persist();
  }

  /** Called when a space is deleted, so its layout does not linger forever. */
  dropLayoutFor(spaceId: string): void {
    delete this.layouts[spaceId];
    this.persist();
  }

  getSortOverrides(): SortOverrides {
    return this.overrides;
  }

  /** Never writes a saved order; this is view state only. */
  setSortOverride(sel: ActiveSelection, on: boolean): void {
    this.overrides = withOverride(this.overrides, sel, on);
    this.persist();
  }

  /** Called when a space is deleted, beside `dropLayoutFor`. */
  dropSortOverrideFor(spaceId: string): void {
    if (this.overrides.bySpaceId[spaceId] === undefined) return;
    this.overrides = withOverride(this.overrides, { kind: "space", id: spaceId }, false);
    this.persist();
  }

  /**
   * Drops any stored per-space layout whose id is not in `knownSpaceIds`.
   * Guards against a space removed by a `data.json` hand-edit (bypassing
   * `dropLayoutFor`, which only runs from the Settings Delete button) leaving
   * its layout blob orphaned forever. Never touches All's layout — All is
   * structural, not a space id.
   */
  reconcileLayouts(knownSpaceIds: string[]): void {
    const known = new Set(knownSpaceIds);
    let changed = false;
    for (const id of Object.keys(this.layouts)) {
      if (!known.has(id)) {
        delete this.layouts[id];
        changed = true;
      }
    }
    for (const id of Object.keys(this.overrides.bySpaceId)) {
      if (!known.has(id)) {
        this.overrides = withOverride(this.overrides, { kind: "space", id }, false);
        changed = true;
      }
    }
    if (changed) this.persist();
  }

  private persist(): void {
    try {
      this.backing.set(KEY, {
        activeSelection: this.selection,
        ...(this.allLayout ? { allLayout: this.allLayout } : {}),
        layoutsBySpaceId: this.layouts,
        ...(this.overrides.all ? { allNativeSort: true } : {}),
        nativeSortBySpaceId: this.overrides.bySpaceId,
      });
    } catch (e) {
      // A runtime write failure degrades to "layouts did not persist".
      // It must never corrupt definitions or throw into a switch, but it must
      // still warn, so the caller decides how (main.ts caps it at one Notice
      // per session; a bare console.error would be silence in practice).
      this.onWriteError?.(e);
    }
  }
}
