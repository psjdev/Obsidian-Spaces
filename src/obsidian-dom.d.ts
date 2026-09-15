/**
 * Obsidian's DOM helpers, as they exist on a WINDOW.
 *
 * `obsidian.d.ts` declares `createEl`, `createDiv`, `createSpan` and
 * `createFragment` twice: as bare global functions, and as methods on `Node`
 * that create AND append. It does not declare them on `Window`, even though
 * Obsidian installs them there — verified in 1.13.7, where
 * `typeof window.createDiv` is `"function"` for all four.
 *
 * That gap matters because the bare globals are bound to the MAIN window. An
 * element built with a global `createDiv()` and inserted into a popped-out
 * window belongs to the wrong document, which is the same class of bug
 * `instanceOf` and `window.requestAnimationFrame` exist to avoid. Reaching the
 * helpers through the owning document (`el.doc.win.createDiv()`) keeps the
 * element in the window it is going to live in, and it is what
 * `obsidianmd/prefer-create-el` asks for by name.
 *
 * This file declares nothing that was not observed on a live window, and
 * nothing beyond the four names `src/` calls. It is a type-level statement
 * about a documented API that is under-declared, NOT an entry into Obsidian's
 * internals: no `app.*` private field, no prototype patching, and nothing here
 * changes at runtime. The private-API quarantine (`nativeWorkspaces.ts`,
 * `nativeExplorerSort.ts`, `nativeMenuSubmenu.ts`, `nativeNewFileParent.ts`)
 * stays the place for anything that does.
 *
 * If a future `obsidian.d.ts` declares these on `Window` itself, delete this
 * file: identical declarations merge, but a changed signature would collide,
 * and that collision is the intended way to find out.
 */
export {};

declare global {
  interface Window {
    createEl<K extends keyof HTMLElementTagNameMap>(
      tag: K,
      o?: DomElementInfo | string,
      callback?: (el: HTMLElementTagNameMap[K]) => void
    ): HTMLElementTagNameMap[K];
    createDiv(o?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void): HTMLDivElement;
    createSpan(
      o?: DomElementInfo | string,
      callback?: (el: HTMLSpanElement) => void
    ): HTMLSpanElement;
    createFragment(callback?: (el: DocumentFragment) => void): DocumentFragment;
  }
}
