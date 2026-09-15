/**
 * Globals Obsidian's Chromium has and jsdom does not.
 *
 * Loaded for every test file. Without this the jsdom suites throw asynchronously
 * inside event handlers, where Vitest reports the failure as an unhandled error
 * rather than a failing test, so the tests stay green while the handler under
 * test dies half way through. Two keyboard tests sat in that state.
 *
 * Only genuine environment gaps belong here. Anything modelling Obsidian's own
 * API belongs in `obsidian-stub.ts`.
 */

/**
 * The backslash, built from its code point.
 *
 * Deliberate: the first version of this file used a `"$&"` replacement string
 * and shipped one backslash too few, which JavaScript reads as the identity
 * replacement. It escaped nothing while claiming in a comment that it did, and
 * no test noticed because the paths the suites use need no escaping. Keeping
 * backslashes out of the source removes that whole class of mistake.
 */
const BACKSLASH = String.fromCharCode(92);

/** Anything outside an unescaped CSS identifier. Over-escaping is still valid. */
const UNSAFE = /[^a-zA-Z0-9_-]/g;

// `CSS.escape` is a Web Platform API jsdom does not implement.
if (typeof globalThis.CSS === "undefined") {
  (globalThis as { CSS?: unknown }).CSS = {};
}
const css = globalThis.CSS as { escape?: (v: string) => string };
css.escape ??= (value: string): string =>
  String(value).replace(UNSAFE, (ch) => BACKSLASH + ch);
