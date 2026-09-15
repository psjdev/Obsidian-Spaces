import { describe, expect, it } from "vitest";

/**
 * The `CSS.escape` stand-in the jsdom suites rely on.
 *
 * Worth its own test because the first version was the identity function: the
 * replacement string it used was one backslash short, which JavaScript reads as
 * re-inserting the match unchanged. Nothing failed, because the paths the suites
 * feed it contain no character that needs escaping - so the gap would only have
 * surfaced the day one did.
 *
 * Expectations are built from `String.fromCharCode(92)` rather than written as
 * backslash literals, for the same reason the implementation is.
 */
const BS = String.fromCharCode(92);

describe("CSS.escape in jsdom", () => {
  it("is available at all", () => {
    expect(typeof CSS.escape).toBe("function");
  });

  it("escapes characters that would break an attribute selector", () => {
    expect(CSS.escape('a"b')).toBe(`a${BS}"b`);
    expect(CSS.escape("a.b")).toBe(`a${BS}.b`);
    expect(CSS.escape("Projects/Work.md")).toBe(`Projects${BS}/Work${BS}.md`);
  });

  it("is not the identity function", () => {
    const path = "Notes/A.md";
    expect(CSS.escape(path)).not.toBe(path);
  });

  it("leaves plain identifier characters alone", () => {
    expect(CSS.escape("Projects")).toBe("Projects");
    expect(CSS.escape("a-b_c1")).toBe("a-b_c1");
  });
});
