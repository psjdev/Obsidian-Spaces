import { describe, expect, it } from "vitest";
import { RevealedSet } from "../src/visibility/RevealedSet";

const S = (...p: string[]) => new Set(p);

describe("RevealedSet", () => {
  it("reveals an opened path", () => {
    const r = new RevealedSet();
    r.noteOpened("a.md");
    expect(r.paths()).toEqual(S("a.md"));
  });

  it("reveals paths backing live leaves, so startup self-heals", () => {
    const r = new RevealedSet();
    r.sync(S("a.md", "b.md"), { pruneClosed: true });
    expect(r.paths()).toEqual(S("a.md", "b.md"));
  });

  it("drops a path the user closed", () => {
    const r = new RevealedSet();
    r.sync(S("a.md", "b.md"), { pruneClosed: true });
    r.sync(S("a.md"), { pruneClosed: true });
    expect(r.paths()).toEqual(S("a.md"));
  });

  it("KEEPS a path whose leaf vanished during spaces's own restore", () => {
    const r = new RevealedSet();
    r.noteOpened("opened-in-all.md");
    r.sync(S("space-tab.md"), { pruneClosed: false });
    expect(r.paths()).toEqual(S("opened-in-all.md", "space-tab.md"));
  });

  // `pruneClosed: false` protects a path only for the one sync in which the
  // restore closed its leaf; an ordinary refresh() afterward has no way to
  // tell "user closed it" from "restore closed it" and would delete it
  // anyway. `carried` fixes that, so the reveal survives.
  it("SURVIVES the next ordinary sync after a restore", () => {
    const r = new RevealedSet();
    r.noteOpened("opened-in-all.md");
    r.sync(S("space-tab.md"), { pruneClosed: false });
    r.sync(S("space-tab.md"), { pruneClosed: true });
    expect(r.paths()).toEqual(S("opened-in-all.md", "space-tab.md"));
  });

  it("survives several ordinary syncs, not just one", () => {
    const r = new RevealedSet();
    r.noteOpened("opened-in-all.md");
    r.sync(S("space-tab.md"), { pruneClosed: false });
    r.sync(S("space-tab.md"), { pruneClosed: true });
    r.sync(S("space-tab.md"), { pruneClosed: true });
    r.sync(S("space-tab.md"), { pruneClosed: true });
    expect(r.paths()).toEqual(S("opened-in-all.md", "space-tab.md"));
  });

  it("prunes a carried path normally once it becomes live again and the user closes it", () => {
    const r = new RevealedSet();
    r.noteOpened("opened-in-all.md");
    r.sync(S("space-tab.md"), { pruneClosed: false }); // restore: carried
    r.sync(S("opened-in-all.md", "space-tab.md"), { pruneClosed: true }); // live again: ordinary
    r.sync(S("space-tab.md"), { pruneClosed: true }); // user closes it: prunes
    expect(r.paths()).toEqual(S("space-tab.md"));
  });

  // `carried`'s protection is scoped to one space visit —
  // `releaseCarried()` runs at the start of the next switch, so it expires.
  // The "still protected during the visit it was carried into" half is
  // already pinned, byte for byte, by "SURVIVES the next ordinary sync after
  // a restore" above, so this test covers only the expiry half.
  it("releaseCarried expires the protection, so the next ordinary sync prunes it", () => {
    const r = new RevealedSet();
    r.noteOpened("opened-in-all.md");
    r.sync(S("space-tab.md"), { pruneClosed: false }); // switch 1 restores
    r.releaseCarried(); // switch 2 begins: the visit that carried it is over
    r.sync(S("space-tab.md"), { pruneClosed: false }); // switch 2 restores
    r.sync(S("space-tab.md"), { pruneClosed: true }); // ordinary refresh
    // No leaf anywhere backs it, and no restore since has closed one: a
    // visitor is a path open in a qualifying leaf.
    expect(r.paths()).toEqual(S("space-tab.md"));
  });

  it("releaseCarried does not touch a path that is live at that moment", () => {
    const r = new RevealedSet();
    r.noteOpened("live.md");
    r.releaseCarried(); // a switch begins while the file is genuinely open
    r.sync(S("live.md"), { pruneClosed: false });
    r.sync(S("live.md"), { pruneClosed: true });
    expect(r.paths()).toEqual(S("live.md"));
  });

  it("releaseCarried does not clear dismissals", () => {
    const r = new RevealedSet();
    r.sync(S("a.md"), { pruneClosed: true });
    r.dismiss("a.md");
    r.releaseCarried();
    r.sync(S("a.md"), { pruneClosed: true });
    expect(r.paths()).toEqual(S());
  });

  // On a restoring sync, a path that is dismissed AND live has its
  // dismissal cleared — a file open in front of the user with no row is the
  // hiding-a-real-file failure that must never happen.
  //
  // Note the honest scope, which this scenario is what it is because of: the
  // input is "dismissed ∧ live at a restoring sync", NOT "the restore
  // reopened it". `live` never changes here, and no sync observes the
  // intermediate closed state, so a restore that reopened the tab and a
  // restore that never closed it are the same input at this interface.
  it("clears a dismissal for a path that is dismissed AND live on a restoring sync", () => {
    const r = new RevealedSet();
    r.sync(S("a.md"), { pruneClosed: true });
    r.dismiss("a.md");
    expect(r.paths()).toEqual(S());
    r.sync(S("a.md"), { pruneClosed: false }); // a restoring sync, path live
    expect(r.paths()).toEqual(S("a.md"));
  });

  it("an ORDINARY sync leaves a dismissal alone even while the path is live", () => {
    // Only spaces's own restore clears a dismissal. Otherwise "Stop showing
    // here" would do nothing at all while the tab is open, which is exactly
    // when a user reaches for it.
    const r = new RevealedSet();
    r.sync(S("a.md"), { pruneClosed: true });
    r.dismiss("a.md");
    r.sync(S("a.md"), { pruneClosed: true });
    expect(r.paths()).toEqual(S());
  });

  it("dismiss defeats carrying", () => {
    const r = new RevealedSet();
    r.noteOpened("opened-in-all.md");
    r.sync(S("space-tab.md"), { pruneClosed: false }); // restore: carried
    r.dismiss("opened-in-all.md");
    expect(r.paths()).toEqual(S("space-tab.md"));
    // Confirm the dismissal is final, not merely masking a still-carried path.
    r.sync(S("space-tab.md"), { pruneClosed: true });
    expect(r.paths()).toEqual(S("space-tab.md"));
  });

  it("does not carry a path that was never revealed", () => {
    const r = new RevealedSet();
    r.sync(S("space-tab.md"), { pruneClosed: false });
    expect(r.paths().has("never.md")).toBe(false);
    r.sync(S("space-tab.md"), { pruneClosed: true });
    expect(r.paths().has("never.md")).toBe(false);
  });

  it("dismisses a path even while its leaf is still live", () => {
    const r = new RevealedSet();
    r.sync(S("a.md"), { pruneClosed: true });
    r.dismiss("a.md");
    expect(r.paths()).toEqual(S());
    r.sync(S("a.md"), { pruneClosed: true });
    expect(r.paths()).toEqual(S());
  });

  it("un-dismisses when the user deliberately opens it again", () => {
    const r = new RevealedSet();
    r.sync(S("a.md"), { pruneClosed: true });
    r.dismiss("a.md");
    r.noteOpened("a.md");
    expect(r.paths()).toEqual(S("a.md"));
  });

  it("returns a copy, so callers cannot mutate internal state", () => {
    const r = new RevealedSet();
    r.noteOpened("a.md");
    r.paths().add("injected.md");
    expect(r.paths()).toEqual(S("a.md"));
  });

  it("dismissing an unknown path is harmless", () => {
    const r = new RevealedSet();
    r.dismiss("nope.md");
    expect(r.paths()).toEqual(S());
  });

  // --- The carry must only protect DELIBERATELY-opened paths -------------
  //
  // The carry loop above used to protect every revealed-but-not-live path.
  // At the moment a restoring sync runs that set is the visitor set of the
  // space just being LEFT, so switching A -> B -> A carried B's visitor
  // into A. The fix adds `deliberate` as the missing input. The tests
  // below pin that condition directly, at this layer, before the
  // controller-level reproduction.

  it("does NOT carry a path revealed only by sync's self-healing clause — this is the bug", () => {
    const r = new RevealedSet();
    // Revealed the way startup / the self-healing clause does it: backing a
    // live leaf, never via `noteOpened`. Nothing the user did marked this a
    // deliberate open.
    r.sync(S("self-healed.md"), { pruneClosed: true });
    // A restoring sync: its leaf just vanished because spaces closed it.
    // This must already be gone on THIS call —
    // the restoring branch used to `return` before its own prune loop, so a
    // non-carried reveal survived one extra recompute. Assert here, before
    // any ordinary sync, so a regression of that `return` cannot hide behind
    // the trailing sync below silently doing the pruning instead.
    r.sync(S(), { pruneClosed: false });
    expect(r.paths()).toEqual(S());
    // A following ordinary sync must not change anything — it was already
    // gone, not merely masked.
    r.sync(S(), { pruneClosed: true });
    expect(r.paths()).toEqual(S());
  });

  it("prunes a non-deliberate reveal on the restoring sync itself, not one recompute later", () => {
    // Isolates this from the surrounding scenario as narrowly as possible:
    // one restoring sync, checked immediately, no trailing ordinary sync at
    // all. If the restoring branch's early `return` regresses, this path
    // stays in `revealed` (unpruned) and only the shape of a LATER sync
    // would remove it — invisible to this assertion, which is the point.
    const r = new RevealedSet();
    r.sync(S("self-healed.md"), { pruneClosed: true });
    r.sync(S(), { pruneClosed: false });
    expect(r.paths()).toEqual(S());
  });

  it("DOES carry a path revealed by noteOpened and survives the next ordinary sync — must not regress", () => {
    const r = new RevealedSet();
    r.noteOpened("deliberate.md");
    r.sync(S(), { pruneClosed: false }); // restoring sync: its leaf vanished
    expect(r.paths()).toEqual(S("deliberate.md")); // must already survive THIS frame
    r.sync(S(), { pruneClosed: true }); // ordinary sync: must still survive
    expect(r.paths()).toEqual(S("deliberate.md"));
  });

  it("at this layer: X revealed by sync only falls out, Y becomes live — X is gone, Y remains", () => {
    const r = new RevealedSet();
    r.sync(S("X.md"), { pruneClosed: true }); // X revealed only by self-healing
    r.sync(S("Y.md"), { pruneClosed: false }); // restoring sync: X's leaf closes, Y's opens
    // Immediate frame first — X must be gone on THIS call.
    expect(r.paths()).toEqual(S("Y.md"));
    r.sync(S("Y.md"), { pruneClosed: true }); // ordinary sync: must not change anything
    expect(r.paths()).toEqual(S("Y.md"));
  });

  it("a deliberate path that becomes live again prunes normally once the user closes it", () => {
    const r = new RevealedSet();
    r.noteOpened("deliberate.md");
    r.sync(S("other.md"), { pruneClosed: false }); // restore: carried
    r.sync(S("deliberate.md", "other.md"), { pruneClosed: true }); // live again: ordinary path
    r.sync(S("other.md"), { pruneClosed: true }); // user closes it: prunes
    expect(r.paths()).toEqual(S("other.md"));
  });

  // dismiss() must clear `deliberate`, not just `carried` — otherwise a
  // dismissal that later lapses (a restoring sync clears a dismissal for a path that is
  // live at a restoring sync) leaves a stale "deliberate" flag on a path
  // whose current reveal is purely self-healed, and a later restore would
  // wrongly carry it past a close it never earned protection for.
  it("dismiss clears the deliberate marking, so a self-healed reveal that follows is not wrongly carried once dismissal lapses", () => {
    const r = new RevealedSet();
    r.noteOpened("d.md"); // deliberate
    r.dismiss("d.md"); // dismissed; carried AND deliberate must clear
    r.sync(S("d.md"), { pruneClosed: false }); // restoring sync, now live: the stale dismissal is cleared
    expect(r.paths()).toEqual(S("d.md")); // visible again — purely self-healed now, not deliberate
    r.sync(S(), { pruneClosed: false }); // restoring sync: this leaf just closed
    // Immediate frame: gone on THIS call, not one recompute later.
    expect(r.paths()).toEqual(S());
    r.sync(S(), { pruneClosed: true }); // ordinary sync: must not change anything
    expect(r.paths()).toEqual(S());
  });

  it("deliberate does not outlive its reveal: pruned, then re-revealed by sync alone, is not carried", () => {
    const r = new RevealedSet();
    r.noteOpened("d.md"); // deliberate
    r.sync(S(), { pruneClosed: true }); // ordinary sync: not live, not carried -> pruned
    expect(r.paths()).toEqual(S());
    r.sync(S("d.md"), { pruneClosed: true }); // re-revealed by self-healing ALONE, no noteOpened
    expect(r.paths()).toEqual(S("d.md"));
    r.sync(S(), { pruneClosed: false }); // restoring sync: its leaf just closed
    // Must NOT be carried, and gone on THIS frame: the stale
    // deliberate flag from the original noteOpened must not have survived
    // the earlier prune.
    expect(r.paths()).toEqual(S());
    r.sync(S(), { pruneClosed: true }); // ordinary sync: must not change anything
    expect(r.paths()).toEqual(S());
  });
});
