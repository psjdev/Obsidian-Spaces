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

describe("the DOM helpers", () => {
  it("builds in the window it was reached through, not the main one", () => {
    const frame = document.createElement("iframe");
    document.body.appendChild(frame);
    const popout = frame.contentWindow;
    if (!popout) throw new Error("iframe has no window");
    installObsidianDom(popout as unknown as Parameters<typeof installObsidianDom>[0]);

    // The whole reason `src/` says `el.doc.win.createDiv()` rather than the
    // bare global: reached through a popout node, the element must belong to
    // the popout's document.
    const host = popout.document.body;
    const made = host.doc.win.createDiv();
    expect(made.ownerDocument).toBe(popout.document);
    expect(made.ownerDocument).not.toBe(document);
  });

  it("applies the option bag", () => {
    const el = window.createEl("input", {
      cls: ["a", "b"],
      attr: { "data-x": "1", "aria-hidden": true },
      title: "t",
      type: "text",
      placeholder: "p",
      value: "v",
    });
    expect(el.className).toBe("a b");
    expect(el.getAttribute("data-x")).toBe("1");
    expect(el.getAttribute("aria-hidden")).toBe("true");
    expect(el.title).toBe("t");
    expect(el.type).toBe("text");
    expect(el.placeholder).toBe("p");
    expect(el.value).toBe("v");
  });

  it("treats a bare string as the class, like Obsidian does", () => {
    expect(window.createDiv("solo").className).toBe("solo");
  });

  it("removes an attribute given null rather than writing the word", () => {
    const el = window.createDiv();
    el.setAttribute("keep", "yes");
    const again = window.createEl("div", { attr: { keep: null } });
    expect(again.hasAttribute("keep")).toBe(false);
    expect(el.getAttribute("keep")).toBe("yes");
  });

  it("appends when built through a parent node, and prepends when asked", () => {
    const parent = document.createElement("div");
    parent.appendChild(document.createElement("hr"));
    const appended = parent.createDiv({ cls: "last" });
    const prepended = parent.createSpan({ cls: "first", prepend: true });
    expect(parent.firstElementChild).toBe(prepended);
    expect(parent.lastElementChild).toBe(appended);
    // Built through the parent, so it belongs to the parent's document.
    expect(appended.ownerDocument).toBe(parent.ownerDocument);
  });

  it("moves a fragment given as text, rather than stringifying it", () => {
    const frag = window.createFragment();
    frag.appendChild(window.createSpan({ text: "inner" }));
    const el = window.createDiv({ text: frag });
    expect(el.textContent).toBe("inner");
    expect(el.querySelector("span")).not.toBeNull();
    expect(frag.childNodes.length).toBe(0);
  });

  it("runs the callback with the finished element", () => {
    const seen: string[] = [];
    const el = window.createDiv({ cls: "c" }, (made) => seen.push(made.className));
    expect(seen).toEqual(["c"]);
    expect(el.className).toBe("c");
  });
});
