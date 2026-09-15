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
 * not have — the same trap `obsidian-stub.ts` documents at length. The
 * `DomElementInfo` fields below are exactly the ones `src/` passes.
 */

/** The part of a window this file touches. */
interface Patchable {
  Node?: { prototype: unknown };
  document?: Document;
}

/** The subset of `DomElementInfo` `src/` actually passes. */
interface ElInfo {
  cls?: string | string[];
  text?: string | DocumentFragment;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  parent?: Node;
  value?: string;
  type?: string;
  prepend?: boolean;
  placeholder?: string;
  href?: string;
}

/**
 * Applies the option bag, which is where the helpers earn their keep over
 * `createElement`. A bare string is shorthand for `{ cls }` — Obsidian accepts
 * both, and `src/` uses both.
 */
function applyInfo(el: HTMLElement, o?: ElInfo | string): void {
  if (o === undefined) return;
  const info: ElInfo = typeof o === "string" ? { cls: o } : o;
  if (info.cls !== undefined) {
    el.className = Array.isArray(info.cls) ? info.cls.join(" ") : info.cls;
  }
  if (info.text !== undefined) {
    // A fragment is MOVED in, exactly as `appendChild` would: same semantics
    // the `Notice` stub documents for its own fragment branch.
    if (typeof info.text === "string") el.textContent = info.text;
    else el.appendChild(info.text);
  }
  if (info.attr) {
    for (const [k, v] of Object.entries(info.attr)) {
      // `null` REMOVES, rather than writing the string "null".
      if (v === null) el.removeAttribute(k);
      else el.setAttribute(k, String(v));
    }
  }
  if (info.title !== undefined) el.title = info.title;
  if (info.value !== undefined) (el as HTMLInputElement).value = info.value;
  if (info.type !== undefined) (el as HTMLInputElement).type = info.type;
  if (info.placeholder !== undefined) (el as HTMLInputElement).placeholder = info.placeholder;
  if (info.href !== undefined) (el as HTMLAnchorElement).href = info.href;
  if (info.parent) {
    if (info.prepend) info.parent.insertBefore(el, info.parent.firstChild);
    else info.parent.appendChild(el);
  }
}

/** The shared body of every `createEl`/`createDiv`/`createSpan`. */
function build<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  o?: ElInfo | string,
  callback?: (el: HTMLElementTagNameMap[K]) => void
): HTMLElementTagNameMap[K] {
  const el = doc.createElement(tag);
  applyInfo(el, o);
  callback?.(el);
  return el;
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
  const proto = node.prototype as Record<string, unknown>;
  proto.instanceOf ??= instanceOfImpl;

  // `doc` and `win` on every node, which is how `src/` reaches the helpers:
  // `el.doc.win.createDiv()` builds in the window the element already lives
  // in. Getters because that is what they are; a plain field would be a
  // snapshot taken at patch time.
  if (!("doc" in proto)) {
    Object.defineProperty(proto, "doc", {
      configurable: true,
      get(this: Node): Document {
        // A Document IS a Node and owns itself; everything else reports its
        // owner, falling back to the global for a node built before any
        // document existed.
        return this.ownerDocument ?? (this as unknown as Document);
      },
    });
  }
  if (!("win" in proto)) {
    Object.defineProperty(proto, "win", {
      configurable: true,
      get(this: Node & { doc: Document }): Window {
        return this.doc.defaultView ?? globalThis.window;
      },
    });
  }

  // The window-level helpers. `obsidian.d.ts` does not declare these on
  // `Window`, but Obsidian installs them there and `src/obsidian-dom.d.ts`
  // says so; a harness that left them out would fail every converted call.
  const w = win as unknown as Record<string, unknown>;
  const docOf = (): Document => win.document ?? globalThis.document;
  w.createEl ??= function <K extends keyof HTMLElementTagNameMap>(
    tag: K,
    o?: ElInfo | string,
    cb?: (el: HTMLElementTagNameMap[K]) => void
  ) {
    return build(docOf(), tag, o, cb);
  };
  w.createDiv ??= (o?: ElInfo | string, cb?: (el: HTMLDivElement) => void) =>
    build(docOf(), "div", o, cb);
  w.createSpan ??= (o?: ElInfo | string, cb?: (el: HTMLSpanElement) => void) =>
    build(docOf(), "span", o, cb);
  w.createFragment ??= (cb?: (el: DocumentFragment) => void) => {
    const frag = docOf().createDocumentFragment();
    cb?.(frag);
    return frag;
  };

  // The node-level form, which creates AND appends. `src/` uses this shape too
  // (`containerEl.createDiv(...)`), and it builds in the parent document, so a
  // row added to a popout stays in the popout.
  const withParent = (self: Node, o?: ElInfo | string): ElInfo => ({
    parent: self,
    ...(typeof o === "string" ? { cls: o } : o),
  });
  proto.createEl ??= function <K extends keyof HTMLElementTagNameMap>(
    this: Node & { doc: Document },
    tag: K,
    o?: ElInfo | string,
    cb?: (el: HTMLElementTagNameMap[K]) => void
  ) {
    return build(this.doc, tag, withParent(this, o), cb);
  };
  proto.createDiv ??= function (
    this: Node & { doc: Document },
    o?: ElInfo | string,
    cb?: (el: HTMLDivElement) => void
  ) {
    return build(this.doc, "div", withParent(this, o), cb);
  };
  proto.createSpan ??= function (
    this: Node & { doc: Document },
    o?: ElInfo | string,
    cb?: (el: HTMLSpanElement) => void
  ) {
    return build(this.doc, "span", withParent(this, o), cb);
  };
}

// The environment this test file runs in. Node-environment suites have no DOM
// at all, and `installObsidianDom` finds nothing to patch.
installObsidianDom(globalThis as Patchable);
