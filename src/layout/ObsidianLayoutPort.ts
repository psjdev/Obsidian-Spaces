import type { App } from "obsidian";
import type { LayoutBlob } from "../types";
import type { WorkspaceLayoutPort } from "./LayoutCoordinator";

/**
 * The only place `getLayout`/`changeLayout` are called. Everything above this
 * line is testable without Obsidian.
 *
 * The blob is opaque: it contains `main`, `left`, `right`, `left-ribbon` and
 * `active`, and spaces replays it whole. A space therefore owns its sidebars
 * as well as its tabs.
 */
export function createObsidianLayoutPort(app: App): WorkspaceLayoutPort {
  return {
    capture: () => app.workspace.getLayout() as LayoutBlob,
    restore: (layout: LayoutBlob) => app.workspace.changeLayout(layout),
    mainLeafCount: () => {
      let n = 0;
      app.workspace.iterateRootLeaves(() => {
        n++;
      });
      return n;
    },
  };
}
