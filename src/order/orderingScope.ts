/**
 * Whether ordering applies to what is active now. Pure — no DOM, no
 * `"obsidian"` import, no store.
 *
 * There are two booleans and they are not symmetric. `allowReordering` is the
 * outer gate from slice B; `allowReorderingAll` can only NARROW it, never
 * re-enable what it switched off. Keeping that rule in one function is the
 * point of this module: it is read by both halves of the feature — which
 * order renders (`orderMapFor`) and whether the drag is live
 * (`dragDeps().enabled`) — and the two must never disagree.
 *
 * They must not disagree because a half-gated feature is worse than either
 * state. Gate only the rendering and a drag in *All* still writes to
 * `orders.all` while nothing applies it: data quietly accumulating with no
 * visible effect. Gate only the gesture and a previously stored order keeps
 * rendering with no way to change it.
 */

export interface OrderingSettings {
  allowReordering: boolean;
  allowReorderingAll: boolean;
}

export function orderingEnabledFor(
  selection: { kind: "all" } | { kind: "space"; id: string },
  settings: OrderingSettings
): boolean {
  if (!settings.allowReordering) return false;
  return selection.kind !== "all" || settings.allowReorderingAll;
}
