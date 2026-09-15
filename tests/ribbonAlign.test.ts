import { describe, expect, it } from "vitest";
import { alignmentGap } from "../src/ui/ribbonAlign";

/**
 * Layer 1: the snap rule, with the measuring left to the caller.
 *
 * Numbers are the ones measured in the fixture (Obsidian 1.13.7, default
 * theme): ribbon icons on a 32px pitch with centres at 61, 93, 125, 157, and a
 * 30px-tall name row. Realistic inputs, not assumptions — the reason this is
 * computed at runtime is that none of them is fixed.
 */
const RIBBON = [61, 93, 125, 157, 189];
const base = {
  ribbonCentres: RIBBON,
  rowTop: 110,
  rowHeight: 30,
  currentGap: 22,
  designGap: 22,
  tolerance: 6,
};

describe("alignmentGap", () => {
  it("keeps a gap that is already aligned", () => {
    // rowTop 110 + 15 = centre 125, an icon centre, and already the design gap.
    expect(alignmentGap(base)).toBe(22);
  });

  it("snaps when an icon is within tolerance", () => {
    // centre 121: 4px short of the icon at 125, so worth taking.
    expect(alignmentGap({ ...base, rowTop: 106 })).toBe(26);
  });

  it("snaps upward as readily as downward", () => {
    expect(alignmentGap({ ...base, rowTop: 114 })).toBe(18);
  });

  /**
   * The regression that matters, and the one my first attempt at this test got
   * wrong. A theme that shifted the ribbon down 34px used to drag the gap from
   * 22px to 48px, because the old rule chased the nearest icon anywhere inside
   * a 16-60px range.
   *
   * The guarantee is NOT that a shifted ribbon is ignored — a ribbon has a
   * repeating pitch, so shifting it by 34 with a 32px pitch just brings the
   * next icon round to almost the same place. The guarantee is that whatever
   * it does, it cannot move us more than the tolerance.
   */
  it("cannot be dragged out of shape by a shifted ribbon", () => {
    const shifted = RIBBON.map((c) => c + 34);
    const out = alignmentGap({ ...base, ribbonCentres: shifted });
    expect(out).not.toBeNull();
    expect(Math.abs(out! - base.designGap)).toBeLessThanOrEqual(base.tolerance);
    // The old rule's answer here, for contrast: it would have been 56.
    expect(out!).toBeLessThan(30);
  });

  it("ignores a ribbon whose icons are nowhere near", () => {
    // Far enough that no icon is a candidate at all — a docked panel elsewhere
    // on screen, or a ribbon pushed far down.
    expect(alignmentGap({ ...base, ribbonCentres: [400, 460] })).toBeNull();
  });

  it("takes the icon closest to the design gap when two are in range", () => {
    // Gaps of 20 and 26 are both legal; 20 is nearer to the design's 22.
    expect(alignmentGap({ ...base, ribbonCentres: [123, 129] })).toBe(20);
  });

  it("never moves further than the tolerance allows", () => {
    for (let shift = -40; shift <= 40; shift++) {
      const out = alignmentGap({ ...base, ribbonCentres: RIBBON.map((c) => c + shift) });
      if (out !== null) expect(Math.abs(out - base.designGap)).toBeLessThanOrEqual(base.tolerance);
    }
  });

  it("leaves the stylesheet alone when there is no ribbon", () => {
    // Hidden ribbon, or mobile: nothing to align to, so nothing to say.
    expect(alignmentGap({ ...base, ribbonCentres: [] })).toBeNull();
  });

  it("leaves it alone mid-layout, when the row has no height yet", () => {
    expect(alignmentGap({ ...base, rowHeight: 0 })).toBeNull();
  });

  it("survives a non-finite measurement", () => {
    expect(alignmentGap({ ...base, rowTop: Number.NaN })).toBeNull();
  });

  it("does not care about the ribbon's order", () => {
    const odd = [200, 125, 40, 93];
    expect(alignmentGap({ ...base, ribbonCentres: odd })).toBe(22);
  });
});
