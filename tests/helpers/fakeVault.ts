import type { MemberKind } from "../../src/types";
import type { VaultIndex } from "../../src/visibility/VaultIndex";
import { isUnder } from "../../src/visibility/VaultIndex";

export function buildFakeVault(
  entries: Record<string, MemberKind>
): VaultIndex {
  const paths = Object.keys(entries);
  return {
    exists: (p) => p in entries,
    kindOf: (p) => entries[p] ?? null,
    childrenOf: (p) =>
      paths.filter(
        (c) => isUnder(c, p) && !c.slice(p === "" ? 0 : p.length + 1).includes("/")
      ),
    descendantsOf: (p) => paths.filter((c) => isUnder(c, p)),
    allPaths: () => [...paths],
  };
}
