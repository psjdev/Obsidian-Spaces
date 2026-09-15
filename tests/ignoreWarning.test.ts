import { describe, expect, it } from "vitest";
import { ignoreSkipMessage } from "../src/ui/SettingsTab";
import { MAX_PATTERNS, compileIgnore, type SkipReason } from "../src/visibility/glob";

/**
 * An invalid pattern is reported and skipped. The warning's
 * DOM cannot be driven here — the stub's `new Setting()` throws on purpose,
 * because inventing Obsidian's setting subtree would make the assertion
 * meaningless — so what is pinned is the part with a decision in it: every
 * reason `compileIgnore` can emit has a sentence, and the sentence matches
 * the rule the compiler actually applies.
 */
describe("the ignore warning's copy", () => {
  const reasons: SkipReason[] = [
    "over-cap",
    "blank",
    "too-long",
    "traversal",
    "absolute",
    "uncompilable",
  ];

  it("has a distinct, non-empty sentence for every skip reason", () => {
    const messages = reasons.map(ignoreSkipMessage);
    expect(messages.every((m) => m.length > 0)).toBe(true);
    expect(new Set(messages).size).toBe(reasons.length);
  });

  it("names the cap the compiler enforces", () => {
    expect(ignoreSkipMessage("over-cap")).toContain(String(MAX_PATTERNS));
  });

  it("no longer tells the user that any two dots are banned", () => {
    // The old copy said 'Contains "..", ... Rename the folder or drop the
    // rule' — advice that was wrong the moment the guard became per-segment.
    const m = ignoreSkipMessage("traversal");
    expect(m).toContain('".." segment');
    expect(compileIgnore(["Acme..confidential/**"]).skipped).toEqual([]);
  });
});
