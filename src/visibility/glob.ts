export const MAX_PATTERNS = 100;

/**
 * A bound on the cost of ONE pattern, which `MAX_PATTERNS` does not
 * give: it caps how many patterns compile, not how big each may be. With the
 * two collapses below the pathological shapes are gone, so this is the belt
 * to their braces — it keeps the compiled source proportional to something a
 * person could plausibly type. A realistic ignore pattern runs well under
 * 20 characters, so 200 is not a limit anyone meets by accident.
 */
export const MAX_PATTERN_LENGTH = 200;

/**
 * The one definition of how spaces decides that two vault paths are
 * the same path. The policy is case-insensitive, matching this vault's
 * filesystem, and the case-only-rename row ("canonicalized,
 * compared case-insensitively") defers to it, so the ignore matcher's
 * `i` flag below is deliberate rather than an accident.
 *
 * It lives here, exported, because every other comparison site was deciding
 * for itself: `exact.has(path)`, `vault.exists(...)`,
 * `m.path === f.path`. A site that adopts the policy imports this instead of
 * re-typing `.toLowerCase()`, so there is one place to change if the policy
 * ever moves.
 *
 * `toLowerCase`, not `toLocaleLowerCase`: the fold must not depend on the
 * user's locale, or a Turkish-locale device would disagree with every other
 * device about `I` — the same cross-device split this finding is about.
 */
export function canonicalPath(path: string): string {
  return path.toLowerCase();
}

/**
 * Why `compileIgnore` refused a pattern. Both "extras are ignored with a
 * notice" and "an invalid pattern is reported and skipped" are required, so
 * the reason is part of the compiler's output rather than something the
 * settings tab re-derives from the pattern text.
 */
export type SkipReason =
  | "over-cap"
  | "blank"
  | "too-long"
  | "traversal"
  | "absolute"
  | "uncompilable";

interface SkippedPattern {
  /** Exactly as the user typed it, untrimmed, so a warning can echo the line. */
  pattern: string;
  /** Position in the list handed to `compileIgnore`; the line in the box. */
  index: number;
  reason: SkipReason;
}

export interface IgnoreMatcher {
  matches(path: string): boolean;
  skipped: readonly SkippedPattern[];
}

function escapeSeg(seg: string): string {
  return (
    seg
      // Collapse the run FIRST. `a**b` and `a*b` accept the same paths
      // — `[^/]*` already spans any run of non-separators — but expanding each
      // `*` separately emits adjacent `[^/]*[^/]*`, two quantifiers that can
      // divide the same text n ways. On a failing match the engine enumerates
      // every division, so cost grows super-linearly in the filename length
      // while the accepted language does not change at all.
      .replace(/\*+/g, "*")
      .replace(/[.+^${}()|[\]\\?]/g, "\\$&")
      .replace(/\*/g, "[^/]*")
  );
}

/**
 * Deliberately small grammar (spec section 5.4):
 *   literal segments, `*` within a segment, `**` spanning zero or more segments.
 * No negation, braces, or character classes. Matching is always anchored at both
 * ends and always on segment boundaries.
 *
 * Exported for the tests, which pin the SHAPE of the compiled source and
 * not only the language it accepts: the collapsing below is invisible to any
 * behavioural assertion, because `a**b` and `a*b` already matched the same
 * paths — badly in one case and well in the other.
 */
export function patternToRegExp(pattern: string): RegExp {
  // The segment-level twin of the collapse in `escapeSeg`: `**/**/x`
  // and `**/x` are the same language, but each extra `**` adds another
  // `(?:[^/]+/)*`, and a chain of those partitions the path combinatorially.
  const segs = pattern
    .split("/")
    .filter((seg, i, all) => !(seg === "**" && all[i - 1] === "**"));
  let out = "^";
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const isLast = i === segs.length - 1;
    if (seg === "**") {
      if (isLast) {
        // "a/**" requires at least one following segment, so it never
        // matches the folder node "a" itself.
        out += "[^/]+(?:/[^/]+)*";
      } else {
        // "**/x" spans zero or more complete segments, separator included.
        out += "(?:[^/]+/)*";
        continue;
      }
    } else {
      out += escapeSeg(seg);
    }
    if (!isLast) out += "/";
  }
  // `i` because the path-comparison policy is case-insensitive; see
  // `canonicalPath` for why, and what else has to agree with it.
  return new RegExp(out + "$", "i");
}

export function compileIgnore(patterns: string[]): IgnoreMatcher {
  const skipped: SkippedPattern[] = [];
  const compiled: RegExp[] = [];

  patterns.forEach((raw, index) => {
    const skip = (reason: SkipReason): void => {
      skipped.push({ pattern: raw, index, reason });
    };
    if (index >= MAX_PATTERNS) return skip("over-cap");
    const p = raw.trim();
    if (!p) return skip("blank");
    if (p.length > MAX_PATTERN_LENGTH) return skip("too-long");
    // Per segment, not `p.includes("..")`. A traversal is a segment
    // that IS `..`; `Clients/Acme..confidential/**` is an ordinary folder
    // name, and the blanket check made it impossible to ignore that folder at
    // all. This is the same per-segment shape `isSafeVaultPath` uses for
    // stored paths (`schema.ts:38`) — it rejects a segment that IS `..`, not
    // one that contains those characters — and the two guards disagreed for
    // no stated reason.
    if (p.split("/").some((seg) => seg === "..")) return skip("traversal");
    if (p.startsWith("/")) return skip("absolute");
    try {
      compiled.push(patternToRegExp(p));
    } catch {
      skip("uncompilable");
    }
  });

  return {
    skipped,
    matches(path: string): boolean {
      return compiled.some((re) => re.test(path));
    },
  };
}
