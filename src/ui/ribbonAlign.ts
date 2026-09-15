/**
 * Whether the create panel's title gap should snap to a left-ribbon icon.
 *
 * **The plugin's own spacing is the design; the ribbon is an opportunity,
 * not an authority.** Taking the ribbon's position as the target and moving
 * however far it takes (measured against a theme shifting the ribbon down
 * 34px) drove the gap from 22px to 48px and the title-to-field space from
 * 32px to 58px — broken by something outside the panel moving.
 *
 * So it snaps with a tolerance: an icon within a few pixels of the design
 * gap is taken; otherwise the design value holds. A theme can decline to
 * line up with us; it cannot drag us out of shape. A hardcoded number fares
 * no better — the ribbon's pitch and phase come from values Obsidian does
 * not publish, so CSS `calc()` can't express them either.
 *
 * Pure on purpose: the caller measures, this decides.
 */

interface AlignInput {
  /** Viewport-relative centres of the ribbon's icons. Any order; may be empty. */
  ribbonCentres: readonly number[];
  /** Viewport-relative top of the row being aligned, at `currentGap`. */
  rowTop: number;
  /** The row's height, so its centre can be derived rather than guessed. */
  rowHeight: number;
  /** The gap currently in effect, which `rowTop` was measured under. */
  currentGap: number;
  /** What the panel's own design says the gap should be. */
  designGap: number;
  /** How far from `designGap` a snap may go. Small on purpose. */
  tolerance: number;
}

/**
 * The gap to apply, or `null` to leave the stylesheet's own value alone.
 *
 * `null` covers every case where this has no business having an opinion: no
 * ribbon on screen (it can be hidden from settings, and does not exist on
 * mobile), a measurement that has not settled, and — the common one — no icon
 * close enough to be worth moving for.
 */
export function alignmentGap(input: AlignInput): number | null {
  const { ribbonCentres, rowTop, rowHeight, currentGap, designGap, tolerance } = input;
  if (ribbonCentres.length === 0 || rowHeight <= 0) return null;
  if (!Number.isFinite(rowTop) || !Number.isFinite(currentGap)) return null;

  const rowCentre = rowTop + rowHeight / 2;

  // What the gap would have to be to put the row's centre on each icon. Solved
  // rather than searched: the row moves one-for-one with the gap, so the gap
  // that lands centre C is simply the current gap plus the distance to C.
  const reachable = ribbonCentres
    .map((c) => Math.round(currentGap + (c - rowCentre)))
    .filter((g) => Math.abs(g - designGap) <= tolerance);

  if (reachable.length === 0) return null;

  // Of the icons worth snapping to, the one that disturbs the design least.
  return reachable.reduce((best, g) =>
    Math.abs(g - designGap) < Math.abs(best - designGap) ? g : best
  );
}
