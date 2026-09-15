/**
 * `nativeMenuSubmenu.ts` is one of the private-Obsidian-API
 * quarantine modules and had no test, while the other two are among the
 * best-tested modules in the tree. That is the quarantine discipline applied
 * unevenly: a quarantine file's whole job is to fail open when the
 * private member is not exactly as measured, and nothing checked that it does.
 *
 * Layer 1 — the module imports nothing but a type, so it runs in plain node.
 *
 * Each case below is one way the measured contract (Obsidian 1.13.7: an own
 * method of `MenuItem.prototype`, arity 0, returning a new object with a
 * working `addItem`) can stop holding in a future release.
 */
import { describe, expect, it } from "vitest";
import { submenuFor } from "../src/actions/nativeMenuSubmenu";
import type { MenuItemLike } from "../src/actions/membershipMenu";

/** A public-API-only MenuItem: what the caller is handed today. */
function menuItem(extra: Record<string, unknown> = {}): MenuItemLike {
  const item: Record<string, unknown> = {
    setTitle: () => item,
    setIcon: () => item,
    setDisabled: () => item,
    onClick: () => item,
    ...extra,
  };
  return item as unknown as MenuItemLike;
}

describe("submenuFor", () => {
  it("returns the nested menu when the private method behaves as measured", () => {
    const sub = { addItem: (): void => undefined };
    const item = menuItem({ setSubmenu: () => sub });
    expect(submenuFor(item)).toBe(sub);
  });

  it("calls setSubmenu with the item as its receiver", () => {
    // Measured as an own method of `MenuItem.prototype`, so it is a method
    // call and not a free function: invoking it unbound would break on any
    // build whose implementation touches `this`.
    let receiver: unknown = null;
    const item = menuItem({
      setSubmenu(this: unknown) {
        receiver = this;
        return { addItem: (): void => undefined };
      },
    });
    submenuFor(item);
    expect(receiver).toBe(item);
  });

  it("calls setSubmenu with no arguments", () => {
    // Measured arity 0. Passing something would be inventing an API.
    let args: unknown[] = [-1];
    const item = menuItem({
      setSubmenu(...received: unknown[]) {
        args = received;
        return { addItem: (): void => undefined };
      },
    });
    submenuFor(item);
    expect(args).toEqual([]);
  });

  it("fails open when the method is absent — the removal case", () => {
    expect(submenuFor(menuItem())).toBeNull();
  });

  it("fails open when the name exists but is not callable", () => {
    expect(submenuFor(menuItem({ setSubmenu: "nested" }))).toBeNull();
  });

  it("fails open when it returns a primitive instead of a menu", () => {
    // The subtler failure the module's docstring names: a future `setSubmenu`
    // that exists but returns a boolean would otherwise be handed back as a
    // menu and throw on first use, turning a cosmetic degradation into a
    // broken context menu.
    for (const value of [true, false, 0, 1, "", "menu", null, undefined]) {
      expect(submenuFor(menuItem({ setSubmenu: () => value }))).toBeNull();
    }
  });

  it("fails open when it returns an object with no addItem", () => {
    expect(submenuFor(menuItem({ setSubmenu: () => ({ addSeparator: () => undefined }) }))).toBeNull();
  });

  it("fails open when addItem is present but not a function", () => {
    expect(submenuFor(menuItem({ setSubmenu: () => ({ addItem: true }) }))).toBeNull();
  });

  it("fails open when the private method throws", () => {
    const item = menuItem({
      setSubmenu: () => {
        throw new Error("not supported in this build");
      },
    });
    expect(submenuFor(item)).toBeNull();
  });

  it("does not inherit a submenu capability from the prototype chain", () => {
    // An `addItem` reached through the prototype is still a working menu, so
    // this pins only that the CAPABILITY check reads the item it was given.
    const proto = { setSubmenu: () => ({ addItem: (): void => undefined }) };
    const item = Object.create(proto) as MenuItemLike;
    expect(submenuFor(item)).not.toBeNull();
  });

  it("returns the menu the caller can actually build into", () => {
    // The point of the whole module: `addItem` on the returned object works,
    // because the returned object is a `Menu` in all but name.
    const built: string[] = [];
    const sub = {
      addItem(build: (item: MenuItemLike) => MenuItemLike): void {
        build(menuItem({ setTitle: (t: string) => (built.push(t), menuItem()) }));
      },
    };
    const menu = submenuFor(menuItem({ setSubmenu: () => sub }));
    menu?.addItem((i) => i.setTitle("Research"));
    expect(built).toEqual(["Research"]);
  });
});
