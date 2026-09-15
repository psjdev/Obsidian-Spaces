import { describe, expect, it } from "vitest";
import {
  CURATED_ICONS,
  iconSearchResults,
  isIconIdShape,
  normalizeIconId,
  renderableIcon,
} from "../src/ui/iconPicker";
import { PRESET_ICONS } from "../src/ui/createSpaceForm";

/** Stands in for `getIconIds()`, prefixed the way Obsidian reports them. */
const ALL = [
  "lucide-box",
  "lucide-book",
  "lucide-bookmark",
  "lucide-book-open",
  "lucide-flask-conical",
  "lucide-folder",
  "lucide-folder-open",
  "lucide-star",
  "some-plugin-icon",
];

describe("normalizeIconId", () => {
  it("strips Obsidian's lucide- prefix, because stored icons are bare", () => {
    expect(normalizeIconId("lucide-box")).toBe("box");
  });

  it("leaves an already-bare id alone", () => {
    expect(normalizeIconId("box")).toBe("box");
  });

  it("does not strip a mere substring match", () => {
    expect(normalizeIconId("my-lucide-thing")).toBe("my-lucide-thing");
  });
});

describe("isIconIdShape", () => {
  it("accepts lucide-style ids", () => {
    for (const ok of ["box", "flask-conical", "gamepad-2"]) {
      expect(isIconIdShape(ok)).toBe(true);
    }
  });

  it("rejects anything that could not be an id", () => {
    for (const bad of ["", "Box", "has space", "trailing-", "-leading", "a".repeat(70)]) {
      expect(isIconIdShape(bad)).toBe(false);
    }
  });
});

describe("iconSearchResults", () => {
  it("shows the curated shelf before anything is typed", () => {
    // The full set is ~1500: opening into all of them is a wall, and picking
    // from a wall is worse than picking from a shelf.
    const out = iconSearchResults({ query: "", allIds: ALL });
    expect(out.slice(0, PRESET_ICONS.length)).toEqual([...PRESET_ICONS]);
  });

  it("searches the WHOLE set once a query is typed, not just the shelf", () => {
    // flask-conical is not in the presets; it must still be findable.
    const out = iconSearchResults({ query: "flask", allIds: ALL });
    expect(out).toEqual(["flask-conical"]);
  });

  it("returns bare ids even though the input is prefixed", () => {
    expect(iconSearchResults({ query: "star", allIds: ALL })).toEqual(["star"]);
  });

  it("ranks a prefix match first, then shorter, then alphabetically", () => {
    // Shorter before alphabetical is deliberate and mirrors `folderCandidates`:
    // `bookmark` (8) precedes `book-open` (9) even though the alphabetical
    // order is the reverse. One ranking idiom across the codebase beats two.
    const out = iconSearchResults({ query: "book", allIds: ALL });
    expect(out).toEqual(["book", "bookmark", "book-open"]);
  });

  it("matches a substring anywhere, not only a prefix", () => {
    expect(iconSearchResults({ query: "conical", allIds: ALL })).toContain("flask-conical");
  });

  it("is case-insensitive", () => {
    expect(iconSearchResults({ query: "BOOK", allIds: ALL })).toContain("book");
  });

  it("de-duplicates ids that normalise to the same name", () => {
    const out = iconSearchResults({ query: "box", allIds: ["lucide-box", "box"] });
    expect(out).toEqual(["box"]);
  });

  it("caps the result count, so a one-letter query is not the whole set", () => {
    const many = Array.from({ length: 300 }, (_, i) => `lucide-aa${i}`);
    expect(iconSearchResults({ query: "a", allIds: many, limit: 60 })).toHaveLength(60);
  });

  it("returns nothing for a query that matches nothing", () => {
    expect(iconSearchResults({ query: "zzzznope", allIds: ALL })).toEqual([]);
  });

  it("does not mutate its inputs", () => {
    const ids = [...ALL];
    iconSearchResults({ query: "book", allIds: ids });
    expect(ids).toEqual(ALL);
  });
});

describe("renderableIcon", () => {
  const known = new Set(["box", "book", "flask-conical"]);

  it("passes through an icon this build can draw", () => {
    expect(renderableIcon("flask-conical", known)).toBe("flask-conical");
  });

  it("falls back for an id this build does not know", () => {
    // setIcon draws NOTHING for an unknown name, leaving a blank switcher
    // button with no clue why — reachable from a hand-edited data.json or a
    // space written by a newer version.
    expect(renderableIcon("from-the-future", known)).toBe("box");
  });

  it("falls back for a missing icon", () => {
    expect(renderableIcon(undefined, known)).toBe("box");
    expect(renderableIcon("", known)).toBe("box");
  });

  it("normalises before deciding", () => {
    expect(renderableIcon("lucide-book", known)).toBe("book");
  });

  it("trusts the stored value when the known set is empty", () => {
    // An empty set means the caller could not enumerate icons; replacing every
    // icon with the fallback would be worse than trusting what is stored.
    expect(renderableIcon("anything", new Set())).toBe("anything");
  });
});

describe("CURATED_ICONS", () => {
  it("leads with the create panel's presets, so the two surfaces agree", () => {
    expect(CURATED_ICONS.slice(0, PRESET_ICONS.length)).toEqual([...PRESET_ICONS]);
  });

  it("contains no duplicates", () => {
    expect(new Set(CURATED_ICONS).size).toBe(CURATED_ICONS.length);
  });

  it("is all well-formed ids", () => {
    expect(CURATED_ICONS.every(isIconIdShape)).toBe(true);
  });
});
