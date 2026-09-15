/**
 * @vitest-environment jsdom
 *
 * The harness's stand-in for Obsidian's DOM prototype methods.
 *
 * Worth testing rather than trusting because the whole point of `instanceOf`
 * is the case a plain `instanceof` gets WRONG, and a stand-in that simply
 * forwards to `instanceof` would pass every test written against one window
 * while telling the source a lie about the case it was adopted for.
 */
import { describe, it, expect } from "vitest";
import { installObsidianDom } from "./helpers/obsidianDom";

describe("instanceOf", () => {
  it("agrees with instanceof for a node in this window", () => {
    const el = document.createElement("div");
    expect(el.instanceOf(HTMLElement)).toBe(true);
    expect(el.instanceOf(HTMLInputElement)).toBe(false);
  });

  it("is true for an element built by ANOTHER window, where instanceof is false", () => {
    // A whole second window, not `createHTMLDocument`: documents made through
    // `document.implementation` share this window's constructors, so the first
    // version of this test asserted nothing and said so when it failed. A
    // separate JSDOM is the popout case reduced to the property that matters.
    // An iframe, not `document.implementation.createHTMLDocument`: documents
    // made that way share this window's constructors, so the first version of
    // this test asserted nothing and said so when it failed. An iframe has a
    // window of its own, which is the property a popout has too.
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const popout = frame.contentWindow;
    if (!popout) throw new Error("iframe has no window");
    // Obsidian patches every window it opens; the harness has to as well, or
    // the element under test has no `instanceOf` to call and the failure is
    // about the fixture rather than about the behaviour.
    installObsidianDom(popout as unknown as { Node?: { prototype: unknown } });
    const foreign = popout.document.createElement("div");

    // The bug being prevented, stated as an assertion. If this ever becomes
    // true the test below has stopped covering the popout case, and failing
    // here is how that gets noticed.
    expect(
      foreign instanceof HTMLElement,
      "jsdom now shares HTMLElement across windows; this test no longer covers the popout case"
    ).toBe(false);

    expect(foreign.instanceOf(HTMLElement)).toBe(true);
  });

  it("still answers for a node whose document has no window", () => {
    const orphan = document.implementation.createDocument(null, "x", null);
    const node = orphan.createElement("y");
    // No `defaultView` on an XML document created this way: the fallback is
    // the plain operator, not a throw.
    expect(() => node.instanceOf(Element)).not.toThrow();
  });
});
