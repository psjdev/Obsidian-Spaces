/**
 * Keeping the active switcher control in view. Pure — no DOM, no
 * `"obsidian"` import, just the arithmetic.
 *
 * The strip scrolls horizontally rather than wrapping, so a
 * space must never be unreachable because it does not fit. That holds for
 * reaching a space by scrolling to it, but not for the space you are already
 * in: switching by command, by the header's dropdown or by creating a
 * space would light up a control sitting outside the visible range, with
 * nothing bringing it back.
 *
 * Deliberately NOT `Element.scrollIntoView()`. That walks every scrollable
 * ancestor and can move elements spaces does not own, which spaces must not do —
 * the rail is ours, its ancestors are the host's. Arithmetic on one element is
 * both contained and testable.
 */

/** Breathing room either side, so a revealed control is not flush to the edge. */
export const PAD = 8;

/**
 * The `scrollLeft` the rail should have, given where the active item sits.
 *
 * Returns the CURRENT `scrollLeft` unchanged whenever the item is already
 * wholly visible. That is the important case rather than an optimisation:
 * `SwitcherView.render()` runs on every switch and every definitions change,
 * so a function that always recentred would leave the rail drifting under the
 * user's hand.
 *
 * `itemOffset` is the item's start in the rail's own content coordinates —
 * measured from rects plus the live `scrollLeft`, never `offsetLeft`, which is
 * relative to the nearest *positioned* ancestor and is not guaranteed to be
 * the rail.
 */
export function railScrollLeft(args: {
  scrollLeft: number;
  clientWidth: number;
  itemOffset: number;
  itemWidth: number;
}): number {
  const { scrollLeft, clientWidth, itemOffset, itemWidth } = args;
  // A collapsed sidebar reports a zero width. Any answer but "leave it alone"
  // would fabricate a scroll position for something nobody can see.
  if (!(clientWidth > 0)) return scrollLeft;
  if (!Number.isFinite(itemOffset) || !Number.isFinite(itemWidth)) return scrollLeft;
  if (!Number.isFinite(scrollLeft)) return 0;

  // An item that cannot fit WITH its padding gets its start aligned, and that
  // branch has to come first for two reasons. It picks the half that matters —
  // the icon is at the start, so revealing the end would show the wrong half.
  // And it is the only stable answer: fall through to the two edge tests below
  // and an item nearly as wide as the rail satisfies "starts too early" and
  // "ends too late" on alternate calls, so `render()` would flip `scrollLeft`
  // between two values forever.
  if (itemWidth + PAD * 2 > clientWidth) return Math.max(0, itemOffset - PAD);
  if (itemOffset - PAD < scrollLeft) return Math.max(0, itemOffset - PAD);
  const end = itemOffset + itemWidth + PAD;
  if (end > scrollLeft + clientWidth) return Math.max(0, end - clientWidth);
  return scrollLeft;
}
