import { describe, expect, it } from "vitest";
import { canOfferCreateSpaceFromFolder } from "../src/actions/createSpaceMenu";

describe("canOfferCreateSpaceFromFolder", () => {
  it("offers the item for a real folder in All", () => {
    expect(canOfferCreateSpaceFromFolder({ path: "Projects/Work", isFolder: true }, null)).toBe(
      true
    );
  });

  it("refuses the vault root, spelled \"/\" — the empty explorer body's own file-menu target", () => {
    expect(canOfferCreateSpaceFromFolder({ path: "/", isFolder: true }, null)).toBe(false);
  });

  it("refuses the vault root, spelled \"\"", () => {
    expect(canOfferCreateSpaceFromFolder({ path: "", isFolder: true }, null)).toBe(false);
  });

  it("refuses a file", () => {
    expect(canOfferCreateSpaceFromFolder({ path: "Recipes.md", isFolder: false }, null)).toBe(
      false
    );
  });

  it("refuses inside a space — only offered in All", () => {
    expect(
      canOfferCreateSpaceFromFolder({ path: "Projects/Work", isFolder: true }, "lab")
    ).toBe(false);
  });
});
