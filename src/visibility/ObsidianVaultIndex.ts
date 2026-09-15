import { TFolder, type TAbstractFile, type Vault } from "obsidian";
import type { MemberKind } from "../types";
import type { VaultIndex } from "./VaultIndex";
import { createTreeVaultIndex } from "./VaultIndex";

/**
 * Snapshot of the vault tree. Rebuilt on create/rename/delete rather than
 * queried live, so the engine always sees a consistent picture.
 *
 * The tree structure is built eagerly here, during the walk that already
 * happens, and is discarded with the snapshot — so there is no cache to
 * invalidate.
 */
export function createObsidianVaultIndex(vault: Vault): VaultIndex {
  const kinds = new Map<string, MemberKind>();

  const walk = (f: TAbstractFile): void => {
    if (f.path !== "/" && f.path !== "") {
      kinds.set(f.path, f instanceof TFolder ? "folder" : "file");
    }
    if (f instanceof TFolder) for (const c of f.children) walk(c);
  };
  walk(vault.getRoot());

  return createTreeVaultIndex(kinds);
}
