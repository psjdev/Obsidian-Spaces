import { describe, expect, it } from "vitest";
import {
  canonicalPath,
  compileIgnore,
  MAX_PATTERNS,
  MAX_PATTERN_LENGTH,
  patternToRegExp,
} from "../src/visibility/glob";

describe("compileIgnore", () => {
  it("matches on segment boundaries, not string prefixes", () => {
    const m = compileIgnore(["Papers/**"]);
    expect(m.matches("Papers/a.md")).toBe(true);
    expect(m.matches("Papers-old/a.md")).toBe(false);
  });

  it("trailing /** matches descendants but not the folder node", () => {
    const m = compileIgnore(["Templates/**"]);
    expect(m.matches("Templates/t.md")).toBe(true);
    expect(m.matches("Templates")).toBe(false);
  });

  it("** matches zero or more complete segments", () => {
    const m = compileIgnore(["**/attachments/**"]);
    expect(m.matches("attachments/img.png")).toBe(true);
    expect(m.matches("Papers/deep/attachments/img.png")).toBe(true);
    expect(m.matches("Papers/notes.md")).toBe(false);
  });

  it("* stays within one segment", () => {
    const m = compileIgnore(["*.excalidraw.md"]);
    expect(m.matches("diagram.excalidraw.md")).toBe(true);
    expect(m.matches("Papers/diagram.excalidraw.md")).toBe(false);
  });

  /**
   * The policy is case-insensitive, matching this vault's filesystem.
   * Pinned deliberately, both directions, because dropping the flag would
   * matter either way: a hiding control that stops matching fails OPEN,
   * and an ignore rule the user still sees in the box would silently stop
   * hiding.
   */
  it("matches case-insensitively in both directions", () => {
    const m = compileIgnore(["Templates/**"]);
    expect(m.matches("templates/T.MD")).toBe(true);
    expect(compileIgnore(["templates/**"]).matches("Templates/T.md")).toBe(true);
  });

  it("agrees with canonicalPath, the policy membership shares", () => {
    const m = compileIgnore(["Notes/Archive/**"]);
    const live = "Notes/ARCHIVE/secret.md";
    expect(canonicalPath(live)).toBe(canonicalPath("notes/archive/SECRET.md"));
    expect(m.matches(live)).toBe(true);
  });

  it("skips invalid patterns without throwing", () => {
    const m = compileIgnore(["", "   ", "Papers/**"]);
    expect(m.skipped.length).toBe(2);
    expect(m.matches("Papers/a.md")).toBe(true);
  });

  it("bounds the pattern count", () => {
    const many = Array.from({ length: MAX_PATTERNS + 10 }, (_, i) => `p${i}/**`);
    const m = compileIgnore(many);
    expect(m.skipped.length).toBe(10);
  });

  it("matches nothing when empty", () => {
    expect(compileIgnore([]).matches("anything.md")).toBe(false);
  });
});

/**
 * The traversal guard was `p.includes("..")`, which rejects a legitimate
 * folder name as well as a traversal, and `skipped` carried bare strings, so
 * the settings warning had to re-derive both the reason and the line.
 */
describe("what compileIgnore refuses, and what it says about it", () => {
  it("compiles a pattern whose segment merely contains two dots", () => {
    const m = compileIgnore(["Clients/Acme..confidential/**"]);
    expect(m.skipped).toEqual([]);
    expect(m.matches("Clients/Acme..confidential/notes.md")).toBe(true);
    expect(m.matches("Clients/Acme/notes.md")).toBe(false);
  });

  it("still refuses a segment that IS a traversal", () => {
    const m = compileIgnore(["Clients/../Secret/**", "../Secret/**", ".."]);
    expect(m.skipped.map((s) => s.reason)).toEqual([
      "traversal",
      "traversal",
      "traversal",
    ]);
  });

  it("reports the pattern, its index and the reason", () => {
    const m = compileIgnore(["Templates/**", "/Archive/**", "   "]);
    expect(m.skipped).toEqual([
      { pattern: "/Archive/**", index: 1, reason: "absolute" },
      { pattern: "   ", index: 2, reason: "blank" },
    ]);
  });

  it("indexes a duplicate pushed past the cap by position, not by content", () => {
    // The case that forced the settings tab to pair heuristically: the copy at
    // the end is the one dropped, and the index says so without a search.
    const patterns = Array.from({ length: MAX_PATTERNS + 1 }, (_, i) =>
      i === MAX_PATTERNS ? "f0/**" : `f${i}/**`
    );
    const m = compileIgnore(patterns);
    expect(m.skipped).toEqual([
      { pattern: "f0/**", index: MAX_PATTERNS, reason: "over-cap" },
    ]);
  });

  it("keeps the raw pattern, untrimmed, so the warning can echo what was typed", () => {
    const m = compileIgnore(["  /Archive/**  "]);
    expect(m.skipped[0].pattern).toBe("  /Archive/**  ");
  });
});

/**
 * `escapeSeg` expanded every `*` independently, so an in-segment `**`
 * emitted adjacent `[^/]*[^/]*` over the same class: two quantifiers that can
 * split the same text in n ways, which the engine enumerates on a failing
 * match. Measured on this branch, `a**a**a**a**b` against an `a`-run costs
 * 22 ms at 23 characters and 187 ms at 37 — roughly doubling every four —
 * against ~0.1 ms once collapsed.
 *
 * The collapse cannot be observed through `matches`, since it never changed
 * which paths a pattern accepts. These assertions are therefore on the
 * compiled source, plus an equivalence check so the collapse cannot quietly
 * change the grammar.
 */
describe("the compiled source carries no redundant quantifiers", () => {
  it("collapses a run of * inside a segment", () => {
    expect(patternToRegExp("**Draft**.md").source).toBe(String.raw`^[^/]*Draft[^/]*\.md$`);
    expect(patternToRegExp("a**b").source).not.toContain("[^/]*[^/]*");
    expect(patternToRegExp("a**a**a**a**b").source).not.toContain("[^/]*[^/]*");
  });

  it("collapses consecutive ** segments", () => {
    expect(patternToRegExp("**/**/**/*.md").source).toBe(
      patternToRegExp("**/*.md").source
    );
    expect(patternToRegExp("Archive/**/**").source).toBe(
      patternToRegExp("Archive/**").source
    );
    expect(patternToRegExp("**/**").source).toBe(patternToRegExp("**").source);
  });

  it("accepts exactly the same paths after collapsing", () => {
    const m = compileIgnore(["**Draft**.md", "**/**/attachments/**", "Archive/**/**"]);
    expect(m.matches("My Draft copy.md")).toBe(true);
    expect(m.matches("Papers/My Draft copy.md")).toBe(false);
    expect(m.matches("a/b/attachments/img.png")).toBe(true);
    expect(m.matches("attachments/img.png")).toBe(true);
    expect(m.matches("Archive/Old/Note.md")).toBe(true);
    expect(m.matches("Archive")).toBe(false);
  });

  it("skips a pattern longer than the cap instead of compiling it", () => {
    const long = "a**".repeat(MAX_PATTERN_LENGTH) + "b";
    const m = compileIgnore(["Papers/**", long]);
    expect(m.skipped).toEqual([
      { pattern: long, index: 1, reason: "too-long" },
    ]);
    expect(m.matches("Papers/a.md")).toBe(true);
  });

  it("leaves a pattern at the cap alone", () => {
    const atCap = "a".repeat(MAX_PATTERN_LENGTH - 3) + "/**";
    expect(atCap.length).toBe(MAX_PATTERN_LENGTH);
    expect(compileIgnore([atCap]).skipped).toEqual([]);
  });
});
