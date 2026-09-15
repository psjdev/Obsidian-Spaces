import { describe, expect, it } from "vitest";
import { MAX_SPACE_NAME_LENGTH, normalizeSpaceName } from "../src/ui/renameSpaceForm";

describe("normalizeSpaceName", () => {
  it("trims, because a trailing space is invisible in the field", () => {
    expect(normalizeSpaceName("  Work  ")).toBe("Work");
  });

  it("keeps interior spacing untouched", () => {
    expect(normalizeSpaceName("R & D  notes")).toBe("R & D  notes");
  });

  it("rejects empty, and whitespace-only, as the same thing (9.9)", () => {
    // Empty is a CANCEL, not an error: the caller keeps the old name. A space
    // with no name is unreachable in the switcher, whose only affordance is a
    // 28px icon carrying the name as its aria-label (9.6).
    expect(normalizeSpaceName("")).toBeNull();
    expect(normalizeSpaceName("   ")).toBeNull();
    expect(normalizeSpaceName("\t\n")).toBeNull();
  });

  it("accepts a name exactly at the limit", () => {
    const at = "x".repeat(MAX_SPACE_NAME_LENGTH);
    expect(normalizeSpaceName(at)).toBe(at);
  });

  it("rejects a name past the limit rather than truncating it", () => {
    // Truncating would write something the user did not type and did not see.
    expect(normalizeSpaceName("x".repeat(MAX_SPACE_NAME_LENGTH + 1))).toBeNull();
  });

  it("measures the limit AFTER trimming", () => {
    // Otherwise a paste with trailing newlines is rejected for a length the
    // stored name would never have had.
    const padded = `  ${"x".repeat(MAX_SPACE_NAME_LENGTH)}  `;
    expect(normalizeSpaceName(padded)).toBe("x".repeat(MAX_SPACE_NAME_LENGTH));
  });

  it("agrees with the schema's own limit", () => {
    // The guard exists to keep a bad name out of `validateSpace`; a limit that
    // drifted from the schema's would either reject valid names or let the
    // whole write fail, which is the failure 9.9 exists to prevent.
    expect(MAX_SPACE_NAME_LENGTH).toBe(100);
  });
});
