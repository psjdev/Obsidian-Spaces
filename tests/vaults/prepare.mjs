#!/usr/bin/env node
/**
 * Materialises the fixture vault described by `fixture.json` into a fresh
 * temp directory, installs the CURRENT build of spaces into it, and
 * enables the plugin — so a real Obsidian can open it and be driven by the
 * CLI without ever touching the user's vault.
 *
 * Why this exists: spec §10.6.2 forbids running an automated Layer 4 suite
 * against the user's real vault, and §20.9 records that a cross-folder drag
 * moves a real note, so §20's central gesture cannot be verified any other
 * way. §11.1 makes this a prerequisite for public distribution too.
 *
 * SAFETY, and it is the whole point of this file:
 *  - It writes ONLY under the OS temp directory. The destination is derived
 *    from `os.tmpdir()` and is refused if it resolves anywhere else.
 *  - It never reads, writes, moves or deletes anything in the user's vault.
 *    The only thing it reads outside the repo is nothing at all.
 *  - It refuses to run if the destination is inside a real vault (detected
 *    by an existing `.obsidian` above the target), so a mistyped path
 *    cannot seed files into somewhere Obsidian is indexing.
 *
 * Usage:
 *   node tests/vaults/prepare.mjs              # fresh temp dir, prints the path
 *   node tests/vaults/prepare.mjs --keep       # reuse/overwrite a stable path
 */

import { mkdtemp, mkdir, writeFile, rm, readFile, copyFile, access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..", "..");
const VAULT_NAME = "spacejam-fixture";

/** The three files Obsidian needs to load a plugin, plus the built bundle. */
const PLUGIN_FILES = ["main.js", "manifest.json", "styles.css"];

async function assertSafeDestination(dest) {
  const real = path.resolve(dest);
  const tmp = path.resolve(tmpdir());
  if (!real.startsWith(tmp)) {
    throw new Error(
      `Refusing to write outside the temp directory.\n  target: ${real}\n  tmpdir: ${tmp}`
    );
  }
  // A `.obsidian` in any ancestor means we are inside a vault Obsidian indexes.
  let dir = path.dirname(real);
  while (dir !== path.dirname(dir)) {
    if (existsSync(path.join(dir, ".obsidian"))) {
      throw new Error(
        `Refusing to write inside an existing vault (found .obsidian at ${dir}).`
      );
    }
    dir = path.dirname(dir);
  }
}

function noteBody(title, why) {
  const lines = [`# ${title}`, ""];
  if (why) lines.push(`> Fixture note. ${why}`, "");
  lines.push("Deterministic fixture content. Edited only by the fixture generator.", "");
  return lines.join("\n");
}

async function writeGroup(root, group) {
  await mkdir(path.join(root, group.path), { recursive: true });
  for (const f of group.files ?? []) {
    const p = path.join(root, group.path, f);
    await writeFile(p, noteBody(path.basename(f, ".md"), group.why), "utf8");
  }
  if (group.generate) {
    const { count, pattern } = group.generate;
    for (let i = 1; i <= count; i++) {
      const name = pattern.replace("%02d", String(i).padStart(2, "0"));
      await writeFile(
        path.join(root, group.path, name),
        noteBody(path.basename(name, ".md"), group.why),
        "utf8"
      );
    }
  }
  for (const child of group.children ?? []) await writeGroup(root, child);
}

async function installPlugin(root) {
  const dir = path.join(root, ".obsidian", "plugins", "spaces");
  await mkdir(dir, { recursive: true });
  for (const f of PLUGIN_FILES) {
    const src = path.join(REPO, f);
    try {
      await access(src);
    } catch {
      throw new Error(
        `${f} is missing — run \`npm run build\` first. The fixture must carry the ` +
          `build under test, not a stale one.`
      );
    }
    await copyFile(src, path.join(dir, f));
  }
  // Enabling the plugin is what makes the fixture usable without clicking
  // through Settings on every fresh run.
  await writeFile(
    path.join(root, ".obsidian", "community-plugins.json"),
    JSON.stringify(["spaces"], null, 2) + "\n",
    "utf8"
  );
  // A known-good starting config: no spaces, defaults on. Tests that need
  // spaces create them through the plugin's own paths, so this file never
  // has to encode the schema.
  await writeFile(
    path.join(dir, "data.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        settings: { globalIgnore: [], restoreLayouts: true, revealVisitors: true },
        spaces: [],
      },
      null,
      2
    ) + "\n",
    "utf8"
  );
  return dir;
}

async function main() {
  const keep = process.argv.includes("--keep");
  const dest = keep
    ? path.join(tmpdir(), VAULT_NAME)
    : await mkdtemp(path.join(tmpdir(), `${VAULT_NAME}-`));

  await assertSafeDestination(dest);
  if (keep && existsSync(dest)) await rm(dest, { recursive: true, force: true });
  await mkdir(dest, { recursive: true });

  const spec = JSON.parse(await readFile(path.join(HERE, "fixture.json"), "utf8"));
  for (const group of spec.folders) await writeGroup(dest, group);
  for (const f of spec.rootFiles ?? []) {
    await writeFile(path.join(dest, f), noteBody(path.basename(f, ".md")), "utf8");
  }
  const pluginDir = await installPlugin(dest);

  const counts = { folders: 0, notes: 0 };
  const walk = (g) => {
    counts.folders++;
    counts.notes += (g.files ?? []).length + (g.generate?.count ?? 0);
    (g.children ?? []).forEach(walk);
  };
  spec.folders.forEach(walk);
  counts.notes += (spec.rootFiles ?? []).length;

  console.log(`vault:   ${dest}`);
  console.log(`plugin:  ${pluginDir}`);
  console.log(`content: ${counts.folders} folders, ${counts.notes} notes`);
  console.log("");
  console.log("Open it in Obsidian, then drive it with the CLI's vault= option:");
  console.log(`  Obsidian.com vault="${path.basename(dest)}" dev:dom selector=".spaces-switcher"`);
}

main().catch((e) => {
  console.error(String(e.message ?? e));
  process.exit(1);
});
