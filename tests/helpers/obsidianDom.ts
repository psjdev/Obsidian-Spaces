/**
 * Obsidian's own additions to the DOM prototypes.
 *
 * Distinct from `jsdomGaps.ts`, which fills in Web Platform APIs jsdom does
 * not implement. Nothing here is a browser API: these are methods Obsidian
 * installs on `Node` and friends at runtime, so a plugin that calls one is
 * calling Obsidian, not the platform. Under Vitest nobody installs them, and
 * the call is a `TypeError` inside whatever handler made it.
 *
 * Installed PER WINDOW rather than once, because that is what Obsidian does:
 * every window it opens gets its own prototypes patched, and a popout's
 * `Node.prototype` is a different object from the main window's. A setup file
 * that patched only the global would leave a test's second window without the
 * method — which is how this file came to be written this way.
 *
 * Kept deliberately small. Modelling more of Obsidian's DOM surface than the
 * source actually uses would let a test pass against a shape Obsidian does
 * not have — the same trap `obsidian-stub.ts` documents at length.
 */

/** The part of a window this file touches. */
interface Patchable {
  Node?: { prototype: unknown };
}

/**
 * Cross-window `instanceof`.
 *
 * The reason it exists: an element inside a popped-out window is built by that
 * window's constructors, so `el instanceof HTMLElement` compares it against the
 * MAIN window's `HTMLElement` and is false for an element that plainly is one.
 * Resolving the constructor by name against the node's own window is what makes
 * the answer independent of which window the bundle was evaluated in.
 *
 * Falls back to a plain `instanceof` when the node has no view of its own
 * (a detached node, or a type the window does not name), which is the same
 * answer the operator would have given.
 */
function instanceOfImpl<T>(this: Node, type: { new (...data: never[]): T }): boolean {
  const win = this.ownerDocument?.defaultView ?? globalThis.window;
  const ctor = (win as unknown as Record<string, unknown>)[type.name];
  if (typeof ctor === "function") return this instanceof (ctor as { new (): unknown });
  return this instanceof (type as unknown as { new (): unknown });
}

/**
 * Patches one window's DOM prototypes.
 *
 * Exported so a test that opens a second window can say "Obsidian patched
 * this one too", which is the only arrangement in which a cross-window
 * assertion means anything.
 */
export function installObsidianDom(win: Patchable): void {
  const node = win.Node;
  if (!node) return;
  // `??=` rather than an assignment: a real Obsidian runtime would already
  // have installed these, and a harness that overwrites the thing it is
  // standing in for stops being a stand-in.
  const proto = node.prototype as { instanceOf?: unknown };
  proto.instanceOf ??= instanceOfImpl;
}

// The environment this test file runs in. Node-environment suites have no DOM
// at all, and `installObsidianDom` finds nothing to patch.
installObsidianDom(globalThis as Patchable);
