/**
 * PRIVATE OBSIDIAN API — QUARANTINE MODULE.
 *
 * The fourth, alongside `layout/nativeWorkspaces.ts`,
 * `layout/ObsidianLayoutPort.ts` and `layout/nativeExplorerSort.ts`. Nothing
 * outside this file may name `setSubmenu`; verify with
 * `grep -rn "setSubmenu" src/`.
 *
 * ## What is private, and what was measured
 *
 * `MenuItem.setSubmenu()` is absent from `obsidian.d.ts` entirely, while
 * existing at runtime. Measured twice against Obsidian 1.13.7:
 *
 * - it is an own method of `MenuItem.prototype`;
 * - its arity is 0 — it takes no arguments;
 * - it returns a NEW object whose prototype is identical to `Menu`'s, so it
 *   is a `Menu` in all but name, and `addItem` on it succeeds.
 *
 * The public `MenuItem` surface offers only `setTitle`, `setIcon`,
 * `setChecked`, `setDisabled`, `setWarning`, `setIsLabel`, `onClick` and
 * `setSection`. There is no public way to nest a menu, which is why this file
 * exists. `Menu.setSectionSubmenu(section, opts)` is the other private route;
 * it is deliberately NOT used, since one private member is easier to defend
 * and to drop than two.
 *
 * ## Fail-open
 *
 * `submenuFor` returns null whenever the capability is not exactly as
 * expected, and the caller then renders flat entries carrying the same
 * information. A future Obsidian release that renames or removes the method
 * therefore degrades the presentation and never breaks the context menu.
 */

import type { MenuItemLike } from "./membershipMenu";

/** Just the member the caller needs from the returned menu. */
export interface SubmenuLike {
  addItem(build: (item: MenuItemLike) => MenuItemLike): void;
}

/** The shape we hope for, expressed so no `any` escapes this file. */
interface MaybeSubmenuCapable {
  setSubmenu?: unknown;
}

/**
 * The nested menu for `item`, or null when this build cannot nest.
 *
 * Both checks matter. The first is the obvious one. The second guards a
 * subtler failure: a future `setSubmenu` that exists but returns something
 * else — a boolean, `this`, a promise — would otherwise be handed to the
 * caller as a menu and throw on first use, turning a cosmetic degradation
 * into a broken context menu.
 */
export function submenuFor(item: MenuItemLike): SubmenuLike | null {
  const candidate = (item as unknown as MaybeSubmenuCapable).setSubmenu;
  if (typeof candidate !== "function") return null;
  try {
    const sub: unknown = (candidate as () => unknown).call(item);
    if (!sub || typeof sub !== "object") return null;
    if (typeof (sub as SubmenuLike).addItem !== "function") return null;
    return sub as SubmenuLike;
  } catch {
    // Private API: a throw here is exactly the case this module exists to
    // absorb, and the caller has a public-API path to fall back on.
    return null;
  }
}
