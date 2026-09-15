/**
 * Module structure, asserted mechanically.
 *
 * The review's finding was produced by running Tarjan over the parsed import
 * graph; this test is that run, kept. It exists because neither `tsc` nor
 * esbuild complains about a runtime import cycle: `membershipMenu.ts` and
 * `spaceAddTargets.ts` referenced each other for weeks with the suite green,
 * and worked only because both exports were hoisted `function` declarations.
 * Converting either to a `const` arrow — a routine lint-driven edit — puts one
 * module in the other's temporal dead zone at load, and nothing in the
 * toolchain would have said so.
 *
 * Layer 1: it reads source text, imports no module under test, and needs no
 * `obsidian`.
 */
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  buildRuntimeImportGraph,
  edgesBetween,
  runtimeCycles,
  unparsedImportForms,
} from "./helpers/importGraph";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

describe("src/ import graph", () => {
  it("has no runtime import cycle", () => {
    const cycles = runtimeCycles(buildRuntimeImportGraph(SRC));
    expect(cycles.map((c) => c.join(" <-> "))).toEqual([]);
  });

  it("has no runtime edge from actions/ up into ui/", () => {
    // The application layer must not import validation out of the view layer:
    // `spaceLifecycle.ts` took `isIconIdShape`/`normalizeHex` from `ui/`, and
    // five `ui/` modules import `actions/spaceLifecycle` back. Domain
    // validation for values written to `data.json` belongs beside
    // `isSafeVaultPath` in `definitions/`.
    expect(edgesBetween(buildRuntimeImportGraph(SRC), "actions", "ui")).toEqual([]);
  });

  it("uses only import forms the graph parser understands", () => {
    // Guards the two tests above against passing by blindness: a side-effect
    // or dynamic import would be a runtime edge the parser cannot see.
    expect(unparsedImportForms(SRC)).toEqual([]);
  });
});
