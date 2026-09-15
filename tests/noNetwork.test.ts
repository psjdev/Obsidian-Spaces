/**
 * "No network, no telemetry" has to be true BY CONSTRUCTION, not by habit.
 *
 * Under public distribution it stops being an internal note and becomes a
 * claim a user may check. Today it holds: there is no
 * `fetch`, no `requestUrl`, no socket, nowhere. The risk is not the code as it
 * stands, it is the ordinary future change that adds an update check, an icon
 * CDN or a crash report without anyone noticing the promise it breaks.
 *
 * So this test fails the build rather than trusting review to catch it. It
 * reads the SOURCE rather than mocking a global, because the point is that the
 * capability is absent from the shipped artefact — a mock only proves the paths
 * a test happened to exercise did not call out.
 *
 * If you are here because this test failed and the network call is deliberate:
 * do not add an exception. Change the README's claim and this comment first,
 * so the promise and the code move together.
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Each pattern is a way out to the network from a renderer. `requestUrl` is
 * Obsidian's own helper and the most likely accidental route, since it is the
 * documented one and looks innocuous next to the other imports.
 */
const FORBIDDEN: ReadonlyArray<{ label: string; re: RegExp }> = [
  { label: "fetch(", re: /(^|[^.\w])fetch\s*\(/ },
  { label: "requestUrl", re: /\brequestUrl\b/ },
  { label: "XMLHttpRequest", re: /\bXMLHttpRequest\b/ },
  { label: "WebSocket", re: /\bWebSocket\b/ },
  { label: "EventSource", re: /\bEventSource\b/ },
  { label: "navigator.sendBeacon", re: /\bsendBeacon\b/ },
  { label: "dynamic import()", re: /(^|[^.\w])import\s*\(/ },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

/**
 * Comments are stripped before matching. Without this the test would forbid
 * *discussing* the network — including in this file's own reasoning — which
 * would push the explanation out of the code to satisfy the check.
 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

describe("the plugin cannot reach the network", () => {
  const files = sourceFiles("src");

  it("finds source files to check, so a bad glob cannot pass vacuously", () => {
    expect(files.length).toBeGreaterThan(40);
  });

  for (const { label, re } of FORBIDDEN) {
    it(`has no \`${label}\` anywhere in src/`, () => {
      const offenders = files.filter((f) => re.test(stripComments(readFileSync(f, "utf8"))));
      expect(offenders).toEqual([]);
    });
  }

  it("declares no runtime dependencies that could carry one in", () => {
    // Zero `dependencies` is what makes the source check sufficient: with none,
    // the bundle contains only this repo's code plus the `obsidian` shim.
    const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
