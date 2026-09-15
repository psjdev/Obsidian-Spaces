/**
 * The revealed set: paths temporarily shown in a space because
 * they are open, even though they are not members.
 *
 * This is STATE spaces owns, not a derivation from whichever leaves happen
 * to be open, and that distinction matters because layout restoration closes
 * leaves; if the set were purely derived, switching into a space would destroy
 * the visitor that made the switch worth anything, and a setting about tabs
 * would silently govern visibility.
 *
 * Never persisted. A restart clears it.
 */
interface SyncOptions {
  /**
   * True for an ordinary sync: a path no longer backing a live leaf means the
   * user closed it, so it leaves the set.
   *
   * False when spaces's own layout restoration caused the change. A vanished
   * leaf then proves nothing — spaces closed it, not the user, and
   * spaces's own actions must not mutate spaces's own bookkeeping.
   */
  pruneClosed: boolean;
}

export class RevealedSet {
  private revealed = new Set<string>();
  /**
   * Dismissals outlive the path still being live — otherwise "Stop showing
   * here" would do nothing at all while the tab is open, which is exactly when
   * a user reaches for it.
   */
  private dismissed = new Set<string>();
  /**
   * Paths that dropped out of the live set on a `pruneClosed: false` sync —
   * i.e. spaces's own layout restoration closed the leaf, not the user.
   * `pruneClosed: false` protects only the ONE sync in which the leaf
   * vanishes; every later ordinary sync sees the same shrunken live set with
   * no way to tell "user closed it" from "restore closed it" unless that
   * distinction is remembered here.
   *
   * The protection is scoped to ONE space visit: `releaseCarried()` empties
   * this set at the start of the next switch. Nothing drained it before, and
   * an indefinite carry contradicted the definition of a visitor as "a
   * path open in a qualifying leaf" — a path revealed in one space stayed
   * revealed in a space it was never opened in, every open-then-switch cycle
   * left a phantom row backed by no leaf, and "Remove from space" appeared
   * to fail because the row came straight back as a visitor.
   *
   * Also cleared when the path is genuinely live again (an ordinary path once
   * more) or dismissed (final).
   */
  private carried = new Set<string>();

  /**
   * Paths that entered via `noteOpened` — i.e. the user opened the file, as
   * opposed to `sync`'s self-healing clause revealing whatever happens to
   * back a live leaf. Only a deliberate open may be carried past a
   * restore; a path revealed solely because a layout restore made it live
   * was never the user's doing.
   *
   * Without provenance, the carry loop below cannot tell those two cases
   * apart and would protect every revealed-but-not-live path — but at the
   * moment a restoring `sync` runs, that set IS the visitor set of the space
   * just being LEFT, whose leaves the incoming space's restore just closed.
   * Switching A → B → A would then carry B's visitor into A: neither an
   * indefinite carry nor a per-visit carry alone records *how* a path became
   * revealed. Recording it here is the missing input; `releaseCarried`'s
   * timing is already correct.
   *
   * Must not outlive the reveal it describes: cleared wherever a path leaves
   * `revealed` (the ordinary prune loop, `dismiss`, `releaseCarried`) or is
   * forgotten (`forget`). Otherwise the flag would survive its path's exit
   * from `revealed`, and a later re-reveal of the same path by `sync` alone
   * would be wrongly treated as deliberate.
   */
  private deliberate = new Set<string>();

  /**
   * End the restore-carry protection. Called at the START of a
   * switch, before the transition runs: the carry exists so that a reveal
   * survives the restore which closed it for the duration of that space
   * visit, and the next switch ends that visit — from then on the path
   * prunes like any other closed tab.
   *
   * It drops only the reveals that exist BECAUSE of the carry (see below). A
   * reveal backed by a live leaf must survive a switch, and `dismissed`
   * is not touched at all — a dismissal is final.
   */
  releaseCarried(): void {
    // A path still carried here has not appeared in `livePaths` on any sync
    // since the restore that closed it — `sync` un-carries anything live — so
    // it survives in `revealed` only through this protection. Ending the
    // visit therefore ends the reveal: dropping it now is what "prunes
    // normally" means for a path with no leaf left to close (a visitor is a
    // path open in a qualifying leaf). Clearing the flag alone would not
    // do it — the next switch's own restoring `sync` re-carries every
    // non-live revealed path, so the protection would renew itself forever,
    // which is exactly the defect. Harmless in the one racy case (a leaf
    // opened while a switch suppressed the sync that would have un-carried
    // it): the post-commit `sync` re-adds every live path unconditionally.
    for (const p of this.carried) {
      this.revealed.delete(p);
      // The reveal this flag described is gone, same reason as the ordinary
      // prune loop: a later re-reveal of this path by `sync` alone must not
      // inherit a stale "deliberate" marking.
      this.deliberate.delete(p);
    }
    this.carried.clear();
  }

  /**
   * The first exit condition: the path became a member of the active
   * space, so it is no longer a visitor. NOT a dismissal (`dismissed` is
   * untouched) and not final — `sync` re-reveals it while a leaf still backs
   * it, so a member that is still open becomes a visitor again the moment its
   * membership ends.
   */
  forget(path: string): void {
    this.revealed.delete(path);
    this.carried.delete(path);
    // Same reason as everywhere else this method's siblings drop a reveal:
    // the flag must not survive to wrongly mark a later, purely self-healed
    // re-reveal of this same path as deliberate.
    this.deliberate.delete(path);
  }

  noteOpened(path: string): void {
    // Deliberately re-opening a file is a clear signal you want to see it.
    this.dismissed.delete(path);
    this.carried.delete(path);
    this.revealed.add(path);
    this.deliberate.add(path);
  }

  sync(livePaths: Set<string>, opts: SyncOptions): void {
    for (const p of livePaths) {
      this.revealed.add(p);
      // Live again: an ordinary path, not a restoration artifact — it must
      // prune normally the next time the user actually closes it.
      this.carried.delete(p);
    }
    if (!opts.pruneClosed) {
      for (const p of livePaths) {
        // spaces's own restore just put this tab back, so a dismissal on it
        // is stale: the file is open in front of the user, and an open file
        // with no row in the tree is exactly the hiding-a-real-file failure
        // must never happen — worse still if it is the active leaf, since there is
        // then no row to reach for. The dismissal drops one reveal; it is
        // not a permanent block. Only a RESTORING sync does this: on an
        // ordinary sync a dismissal survives its leaf staying open, which is
        // precisely when "Stop showing here" is reached for.
        this.dismissed.delete(p);
      }
      // A restoring sync: whatever just fell out of the live set here MIGHT
      // be spaces's doing (closing leaves to restore a layout), not the
      // user's — but only if the user put it there in the first
      // place. `!livePaths.has(p)` alone is not enough to tell that: at this
      // exact moment `this.revealed` also contains the OUTGOING space's
      // visitors, which are equally not-live and would otherwise all be
      // carried into the space just entered.
      // `deliberate` is the missing input: only a path the user opened via
      // `noteOpened` may survive the restore that closed it; a path revealed
      // solely because `sync`'s self-healing clause saw it backing a live
      // leaf was never the user's doing, so losing it here is not a loss to
      // protect.
      for (const p of this.revealed) {
        if (!livePaths.has(p) && this.deliberate.has(p)) this.carried.add(p);
      }
      // NO early return here. Returning before the prune loop below would
      // leave a non-deliberate reveal that just went non-live (the case the
      // carry step above just declined to protect) sitting in `revealed` for
      // this entire recompute, with only the FOLLOWING ordinary sync
      // removing it. `recompute` feeds `revealed.paths()` straight into the
      // snapshot it renders for THIS switch, so that path would show for one
      // frame — the outgoing space's visitor visible in the incoming space
      // on the very screen the switch produced, then vanishing on the next
      // tick (measured: identical to the ablation that drops the
      // `deliberate` condition entirely). A visitor is a path open in a
      // qualifying leaf; after a restore that closes its leaf without the
      // carry protecting it, it is open nowhere, and that must be true on
      // the frame the switch renders, not one recompute later. Falling
      // through to the same prune loop the ordinary branch uses is what
      // makes that true immediately, and it is exactly right here: the
      // carry step just above has already added every path the user
      // deliberately opened to `carried`, so this prune only ever removes a
      // reveal nothing protects.
    }
    for (const p of [...this.revealed]) {
      if (!livePaths.has(p) && !this.carried.has(p)) {
        this.revealed.delete(p);
        // The reveal is gone; the provenance describing it must go with it,
        // or a later purely self-healed re-reveal of this path would be
        // wrongly treated as deliberate.
        this.deliberate.delete(p);
      }
    }
  }

  dismiss(path: string): void {
    this.dismissed.add(path);
    // A dismissal is final: it must not be revivable merely because
    // the path is still sitting in `carried` from an earlier restore, or
    // because `deliberate` still remembers it was once opened on purpose.
    this.carried.delete(path);
    this.deliberate.delete(path);
  }

  paths(): Set<string> {
    const out = new Set<string>();
    for (const p of this.revealed) if (!this.dismissed.has(p)) out.add(p);
    return out;
  }
}
