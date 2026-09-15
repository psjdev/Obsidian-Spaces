// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { headerAnchor } from "../src/ui/headerPlacement";

/**
 * DOM built by hand rather than importing `SpaceHeaderView.ts`, which imports
 * `"obsidian"` — a types-only package with no runtime module — and would throw
 * at import time.
 */
function pane(): { root: HTMLElement; tree: HTMLElement } {
  const root = document.createElement("div");
  const navHeader = document.createElement("div");
  navHeader.className = "nav-header";
  const tree = document.createElement("div");
  tree.className = "nav-files-container";
  root.append(navHeader, tree);
  return { root, tree };
}

describe("headerAnchor", () => {
  it("anchors on the tree container, so the header lands above it", () => {
    const { root, tree } = pane();
    expect(headerAnchor(root, tree)).toBe(tree);
  });

  it("appends when there is no tree container at all", () => {
    // `changeLayout()` destroys and recreates `.nav-files-container` (8.3), so
    // a rebind can run while it is absent.
    const { root } = pane();
    expect(headerAnchor(root, null)).toBeNull();
  });

  it("appends rather than throwing when the container is not a direct child", () => {
    // `insertBefore` throws NotFoundError for a reference node that is not a
    // child of the parent. During a rebind that would abort the mount and
    // leave the pane with NO header — a missing feature rather than a
    // cosmetic one. This is the branch no manual check ever reaches.
    const { root } = pane();
    const wrapper = document.createElement("div");
    const nested = document.createElement("div");
    nested.className = "nav-files-container";
    wrapper.appendChild(nested);
    root.appendChild(wrapper);
    expect(headerAnchor(root, nested)).toBeNull();
  });

  it("survives a container whose parent is nothing at all", () => {
    // A node already detached by a rebind in flight.
    const { root } = pane();
    const orphan = document.createElement("div");
    expect(headerAnchor(root, orphan)).toBeNull();
  });

  it("insertBefore actually works on what it returns", () => {
    // The point of the function is a node `insertBefore` accepts; asserting
    // identity alone would not catch a return value that still throws.
    const { root, tree } = pane();
    const header = document.createElement("div");
    const anchor = headerAnchor(root, tree);
    expect(anchor).not.toBeNull();
    root.insertBefore(header, anchor);
    expect(Array.prototype.indexOf.call(root.children, header)).toBe(1);
    expect(root.children[0].className).toBe("nav-header");
    expect(root.children[2].className).toBe("nav-files-container");
  });
});
