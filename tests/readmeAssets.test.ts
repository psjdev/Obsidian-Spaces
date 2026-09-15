import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * The README's screenshots, checked against the files on disk.
 *
 * A broken image is invisible from inside the repository: the markdown still
 * looks right, and the gap only appears once the page is rendered on GitHub,
 * which is the first thing anyone sees. Renaming or dropping a file is the
 * easy way to cause one, so both directions are asserted.
 */
const README = readFileSync("README.md", "utf8");
const MEDIA = "docs/media";

/** Every `docs/media/...` path the README points at, from both markdown and <img>. */
function referenced(): string[] {
  const hits = README.matchAll(/(?:\]\(|src=")(docs\/media\/[^)"\s]+)/g);
  return [...new Set([...hits].map((m) => m[1]))];
}

describe("README screenshots", () => {
  it("references at least one", () => {
    expect(referenced().length).toBeGreaterThan(0);
  });

  it("points only at files that exist", () => {
    const missing = referenced().filter((p) => !existsSync(p));
    expect(missing).toEqual([]);
  });

  it("ships no image the README never shows", () => {
    const used = new Set(referenced());
    const orphans = readdirSync(MEDIA).filter((f) => !used.has(`${MEDIA}/${f}`));
    expect(orphans).toEqual([]);
  });

  it("gives every image alternative text", () => {
    const markdown = [...README.matchAll(/!\[([^\]]*)\]\(docs\/media\//g)].map((m) => m[1]);
    const html = [...README.matchAll(/<img\b[^>]*>/g)].map((m) =>
      / alt="([^"]*)"/.exec(m[0])?.[1] ?? ""
    );
    for (const alt of [...markdown, ...html]) {
      expect(alt.trim().length).toBeGreaterThan(10);
    }
  });

  it("keeps the screenshots one width, so a table's columns line up", () => {
    // The rule is about the screenshots that sit side by side in a table: if
    // they differ in width they render at different zoom levels once the
    // column normalises them. The banner stands alone and is exempt.
    //
    // PNG puts width at byte 16 and height at byte 20 of the IHDR chunk.
    const widths = new Set(
      readdirSync(MEDIA)
        .filter((f) => f.endsWith(".png") && f !== "banner.png")
        .map((f) => readFileSync(join(MEDIA, f)).readUInt32BE(16))
    );
    expect([...widths]).toHaveLength(1);
  });

  it("has a banner that is wide enough to stay sharp at GitHub's width", () => {
    // GitHub renders a README at roughly 840px, so anything narrower than that
    // would be upscaled and soft.
    const width = readFileSync(join(MEDIA, "banner.png")).readUInt32BE(16);
    expect(width).toBeGreaterThanOrEqual(1680);
  });
});
