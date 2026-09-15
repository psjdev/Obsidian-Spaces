import { describe, expect, it } from "vitest";
import {
  BlurCommitLedger,
  deleteConfirmPrompt,
  deleteWithConfirm,
  type BlurCommittedField,
  type ConfirmPrompt,
} from "../src/ui/settingsEdits";

/**
 * A stand-in for an Obsidian TextComponent: the ledger only ever reads the
 * control through `current()`, which is why the real one needs no adapter.
 */
function field(initial: string, opts?: { accepts?: (v: string) => boolean }) {
  const writes: string[] = [];
  let value = initial;
  const f: BlurCommittedField = {
    current: () => value,
    write: (v) => writes.push(v),
    ...(opts?.accepts ? { accepts: opts.accepts } : {}),
  };
  return {
    field: f,
    writes,
    type(next: string) {
      value = next;
    },
  };
}

describe("BlurCommitLedger", () => {
  it("flushes an edit whose blur never fired", () => {
    const ta = field("");
    const ledger = new BlurCommitLedger();
    ledger.track(ta.field, "");

    ta.type("Attachments/**"); // typed, then Escape: no blur

    expect(ledger.flush()).toBe(1);
    expect(ta.writes).toEqual(["Attachments/**"]);
  });

  it("does not double-write when blur did fire normally", () => {
    const ta = field("");
    const ledger = new BlurCommitLedger();
    ledger.track(ta.field, "");

    ta.type("Attachments/**");
    expect(ledger.commit(ta.field)).toBe(true); // the blur handler

    expect(ledger.flush()).toBe(0);
    expect(ta.writes).toEqual(["Attachments/**"]);
  });

  it("writes nothing when the control was never touched", () => {
    const ta = field("Templates/**");
    const ledger = new BlurCommitLedger();
    ledger.track(ta.field, "Templates/**");

    expect(ledger.flush()).toBe(0);
    expect(ta.writes).toEqual([]);
  });

  it("writes again when the value changes after a committed blur", () => {
    const ta = field("a");
    const ledger = new BlurCommitLedger();
    ledger.track(ta.field, "a");

    ta.type("b");
    ledger.commit(ta.field);
    ta.type("c");

    expect(ledger.flush()).toBe(1);
    expect(ta.writes).toEqual(["b", "c"]);
  });

  it("respects `accepts` — an emptied rename box is not a rename", () => {
    const name = field("Research", { accepts: (v) => v.length > 0 });
    const ledger = new BlurCommitLedger();
    ledger.track(name.field, "Research");

    name.type("");

    expect(ledger.flush()).toBe(0);
    expect(name.writes).toEqual([]);
  });

  it("flushes every tracked field, and one failure does not strand the rest", () => {
    const ok = field("");
    const bad: BlurCommittedField = {
      current: () => "boom",
      write: () => {
        throw new Error("write failed");
      },
    };
    const ledger = new BlurCommitLedger();
    ledger.track(bad, "");
    ledger.track(ok.field, "");
    ok.type("Attachments/**");

    expect(ledger.flush()).toBe(1);
    expect(ok.writes).toEqual(["Attachments/**"]);
  });

  it("forgets its fields on clear, so a re-render cannot write through a dead control", () => {
    const ta = field("");
    const ledger = new BlurCommitLedger();
    ledger.track(ta.field, "");
    ta.type("Attachments/**");

    ledger.clear();

    expect(ledger.flush()).toBe(0);
    expect(ta.writes).toEqual([]);
  });
});

describe("delete confirmation", () => {
  it("names the space and its member count", () => {
    const p = deleteConfirmPrompt({ name: "Research", memberCount: 200, missingCount: 0 });
    expect(p.title).toContain("Research");
    expect(p.body).toContain("200");
    expect(p.confirmLabel).toBe("Delete");
  });

  it("says 'member' in the singular for one member", () => {
    const p = deleteConfirmPrompt({ name: "Solo", memberCount: 1, missingCount: 0 });
    expect(p.body).toContain("1 member");
    expect(p.body).not.toContain("1 members");
  });

  it("mentions missing members so the count is not read as a lie", () => {
    const p = deleteConfirmPrompt({ name: "Old", memberCount: 12, missingCount: 3 });
    expect(p.body).toContain("3 missing");
  });

  it("deletes and re-renders when confirmed", async () => {
    const calls: string[] = [];
    const deleted = await deleteWithConfirm(
      { name: "Research", memberCount: 2, missingCount: 0 },
      {
        confirm: async (p: ConfirmPrompt) => {
          calls.push(`confirm:${p.title}`);
          return true;
        },
        remove: async () => {
          calls.push("remove");
        },
        onDeleted: () => calls.push("rerender"),
        onError: (m) => calls.push(`error:${m}`),
      }
    );
    expect(deleted).toBe(true);
    expect(calls).toEqual(['confirm:Delete "Research"?', "remove", "rerender"]);
  });

  it("deletes nothing when cancelled", async () => {
    const calls: string[] = [];
    const deleted = await deleteWithConfirm(
      { name: "Research", memberCount: 2, missingCount: 0 },
      {
        confirm: async () => false,
        remove: async () => {
          calls.push("remove");
        },
        onDeleted: () => calls.push("rerender"),
        onError: (m) => calls.push(`error:${m}`),
      }
    );
    expect(deleted).toBe(false);
    expect(calls).toEqual([]);
  });

  it("reports a failed delete instead of rejecting into the click handler", async () => {
    const calls: string[] = [];
    const deleted = await deleteWithConfirm(
      { name: "Research", memberCount: 2, missingCount: 0 },
      {
        confirm: async () => true,
        remove: async () => {
          throw new Error("disk full");
        },
        onDeleted: () => calls.push("rerender"),
        onError: (m) => calls.push(m),
      }
    );
    expect(deleted).toBe(false);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("Research");
    expect(calls[0]).toContain("disk full");
  });
});
