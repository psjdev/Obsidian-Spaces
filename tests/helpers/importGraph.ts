/**
 * A runtime-only import graph over `src/`, built by parsing the import and
 * export-from clauses.
 *
 * "Runtime-only" is the whole point. `import type { X } from "y"` and
 * `import { type X } from "y"` are erased by `tsc` before the bundle exists,
 * so they cannot put a module in another's temporal dead zone and are not
 * cycles in any sense that can fail at load. A graph that counted them would
 * report cycles the review already dismissed and would make the assertion in
 * `tests/moduleGraph.test.ts` meaningless.
 *
 * Regex rather than the TypeScript compiler API: `typescript` is not a
 * dependency of this project, and the import syntax actually used in `src/` is
 * the four forms handled below. `assertNoUnparsedImports` fails loudly if a
 * fifth form ever appears, so the parser cannot silently under-report an edge
 * (an under-reporting parser would make the cycle test pass by blindness).
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** Every `.ts` file under `src/`, keyed as a `src`-relative posix path. */
export function srcFiles(srcDir: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (full.endsWith(".ts")) out.push(rel(srcDir, full));
    }
  };
  walk(srcDir);
  return out;
}

function rel(srcDir: string, file: string): string {
  return relative(srcDir, file).split(sep).join("/");
}

/**
 * `import <clause> from "<spec>"` and `export <clause> from "<spec>"`, which
 * are the only two module-level forms present in `src/`. `import "x"` for side
 * effects and dynamic `import()` are not used and would be missed, which is
 * what `assertNoUnparsedImports` checks for.
 */
const CLAUSE = /(?:^|\n)[ \t]*(?:import|export)\s+([\s\S]*?)\s+from\s+["']([^"']+)["']/g;

/** True when the clause pulls at least one binding that survives to runtime. */
function isRuntimeClause(clause: string): boolean {
  const trimmed = clause.trim();
  // `import type { A, B } from "x"` / `export type { A } from "x"`.
  if (/^type\b/.test(trimmed)) return false;
  const braced = /\{([\s\S]*)\}/.exec(clause);
  // A default or namespace binding outside the braces is always runtime.
  const outside = clause.replace(/\{[\s\S]*\}/, "").replace(/,/g, "").trim();
  if (outside.length > 0) return true;
  if (!braced) return false;
  return braced[1]
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .some((s) => !/^type\b/.test(s));
}

export type ImportGraph = Map<string, string[]>;

/** Adjacency over `src`-relative paths; only relative specifiers are edges. */
export function buildRuntimeImportGraph(srcDir: string): ImportGraph {
  const graph: ImportGraph = new Map();
  for (const file of srcFiles(srcDir)) {
    const abs = join(srcDir, file);
    const text = readFileSync(abs, "utf8");
    const deps = new Set<string>();
    for (const m of text.matchAll(CLAUSE)) {
      const [, clause, spec] = m;
      if (!spec.startsWith(".")) continue;
      if (!isRuntimeClause(clause)) continue;
      const target = resolve(dirname(abs), spec.endsWith(".ts") ? spec : `${spec}.ts`);
      deps.add(rel(srcDir, target));
    }
    graph.set(file, [...deps].sort());
  }
  return graph;
}

/**
 * Module-level import forms the parser above does NOT understand. Returns
 * `file:line` for each, so a new form is a test failure rather than a silently
 * dropped edge.
 */
export function unparsedImportForms(srcDir: string): string[] {
  const out: string[] = [];
  for (const file of srcFiles(srcDir)) {
    const lines = readFileSync(join(srcDir, file), "utf8").split("\n");
    lines.forEach((line, i) => {
      // A bare side-effect import, or a dynamic one. Both would be runtime
      // edges this parser cannot see.
      if (/^\s*import\s+["']\./.test(line) || /\bimport\s*\(/.test(line)) {
        out.push(`${file}:${i + 1}`);
      }
    });
  }
  return out;
}

/** Tarjan's SCC. Components of size > 1 are the runtime cycles. */
export function runtimeCycles(graph: ImportGraph): string[][] {
  let counter = 0;
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const cycles: string[][] = [];

  const visit = (v: string): void => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of graph.get(v) ?? []) {
      if (!graph.has(w)) continue; // an edge out of src/, e.g. a missing file
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v) ?? 0, low.get(w) ?? 0));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v) ?? 0, index.get(w) ?? 0));
      }
    }
    if (low.get(v) === index.get(v)) {
      const comp: string[] = [];
      let w: string | undefined;
      do {
        w = stack.pop();
        if (w === undefined) break;
        onStack.delete(w);
        comp.push(w);
      } while (w !== v);
      if (comp.length > 1) cycles.push(comp.sort());
    }
  };

  for (const v of graph.keys()) if (!index.has(v)) visit(v);
  return cycles.sort();
}

/** `"a/b.ts"` → `"a"`; a file directly in `src/` is `"(root)"`. */
export function layerOf(file: string): string {
  const slash = file.indexOf("/");
  return slash === -1 ? "(root)" : file.slice(0, slash);
}

/** Every runtime edge from layer `from` into layer `to`, as `"a -> b"`. */
export function edgesBetween(graph: ImportGraph, from: string, to: string): string[] {
  const out: string[] = [];
  for (const [file, deps] of graph) {
    if (layerOf(file) !== from) continue;
    for (const dep of deps) if (layerOf(dep) === to) out.push(`${file} -> ${dep}`);
  }
  return out.sort();
}
