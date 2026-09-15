// @vitest-environment jsdom
/**
 * The settings tab strip.
 *
 * Layer 1/3. `SettingsTab.ts` itself cannot be driven here — the obsidian
 * stub's `new Setting()` throws by design — so the strip lives in
 * `src/ui/settingsTabs.ts` and is exercised against real jsdom elements. What
 * that buys is genuine: focus, `document.activeElement` and keyboard event
 * dispatch are the standard's, not a fake's. What it does not buy is any
 * claim about Obsidian's own settings modal; nothing
 * here asserts computed style, and the three-line delegation inside
 * `SettingsTab.display()` is still only checked by `tsc`.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  activateTab,
  renderTabStrip,
  tabForKey,
  type TabDescriptor,
  type TabPaneHost,
} from "../src/ui/settingsTabs";

const TABS: readonly TabDescriptor[] = [
  { id: "preferences", label: "Preferences" },
  { id: "spaces", label: "Spaces" },
];

/** Three tabs, for the wrap and Home/End cases two cannot distinguish. */
const THREE: readonly TabDescriptor[] = [
  { id: "one", label: "One" },
  { id: "two", label: "Two" },
  { id: "three", label: "Three" },
];

/**
 * The settings pane reduced to what a tab switch touches: a container that is
 * emptied and redrawn, a ledger that has to be flushed before that happens,
 * and the focus that has to be put back afterwards.
 *
 * Deliberately the same shape as `SettingsTab.display()` / `paneHost`, so a
 * failure here is a failure there — including the part that matters most,
 * that the redraw destroys the element the click landed on.
 */
function pane(tabs: readonly TabDescriptor[] = TABS) {
  const containerEl = document.createElement("div");
  document.body.appendChild(containerEl);

  /** Every step a switch takes, in the order it took them. */
  const log: string[] = [];
  let active = tabs[0]!.id;
  let activeEl: HTMLElement | null = null;
  let panelEl: HTMLElement | null = null;

  const host: TabPaneHost = {
    flushEdits: () => {
      log.push("flush");
    },
    setActiveTab: (id) => {
      active = id;
    },
    render: () => {
      log.push("render");
      draw();
    },
    focusActiveTab: () => {
      log.push("focus");
      activeEl?.focus();
    },
  };

  function draw(): void {
    // What `containerEl.empty()` does: the element the user just clicked is
    // detached, and the HTML standard's focus fixup drops focus to the body
    // without firing anything (`tests/settingsBlurFlush.test.ts`).
    containerEl.replaceChildren();
    const strip = renderTabStrip(containerEl, {
      tabs,
      activeId: active,
      label: "Spaces settings",
      idPrefix: "spaces-settings",
      onActivate: (id) => activateTab(host, active, id),
    });
    activeEl = strip.activeEl;
    panelEl = strip.panelEl;
  }

  draw();

  return {
    containerEl,
    log,
    get active() {
      return active;
    },
    get panel() {
      return panelEl;
    },
    tablist: () => containerEl.querySelector('[role="tablist"]') as HTMLElement,
    buttons: () =>
      Array.from(containerEl.querySelectorAll('[role="tab"]')) as HTMLButtonElement[],
    button: (id: string) => {
      const i = tabs.findIndex((t) => t.id === id);
      return Array.from(containerEl.querySelectorAll('[role="tab"]'))[i] as HTMLButtonElement;
    },
    press: (key: string) => {
      (document.activeElement as HTMLElement).dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })
      );
    },
  };
}

beforeEach(() => {
  document.body.replaceChildren();
});

describe("a tab switch tears the pane down, so it must flush like hide()", () => {
  it("flushes pending edits BEFORE the redraw detaches the controls", () => {
    const p = pane();
    p.button("spaces").click();
    // Flushing after the redraw would be flushing a ledger `display()` has
    // already cleared, which writes nothing at all.
    expect(p.log).toEqual(["flush", "render", "focus"]);
  });

  it("does nothing at all when the open tab is re-selected", () => {
    const p = pane();
    p.button("preferences").click();
    expect(p.log).toEqual([]);
    expect(p.active).toBe("preferences");
  });
});

describe("review defect 1 — focus is lost when a tab is activated", () => {
  it("really does destroy the element the click landed on", () => {
    // The premise, run rather than asserted: without this the fix below would
    // be restoring focus to something that never lost it.
    const p = pane();
    const clicked = p.button("spaces");
    clicked.click();
    expect(clicked.isConnected).toBe(false);
  });

  it("puts focus on the newly activated tab control", () => {
    const p = pane();
    p.button("spaces").click();
    expect(document.activeElement).toBe(p.button("spaces"));
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("review defect 2 — role=tab without the rest of the pattern", () => {
  it("gives the tablist an accessible name", () => {
    const p = pane();
    expect(p.tablist().getAttribute("aria-label")).toBe("Spaces settings");
  });

  it("rolls tabindex: the selected tab is 0 and every other is -1", () => {
    const p = pane(THREE);
    expect(p.buttons().map((b) => b.getAttribute("tabindex"))).toEqual(["0", "-1", "-1"]);
  });

  it("renders a tabpanel the selected tab points at with aria-controls", () => {
    const p = pane();
    const panel = p.panel!;
    expect(panel.getAttribute("role")).toBe("tabpanel");
    const selected = p.button("preferences");
    expect(selected.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.id).not.toBe("");
    // And back the other way, so a screen reader in the panel can say which
    // tab it belongs to.
    expect(panel.getAttribute("aria-labelledby")).toBe(selected.id);
  });

  it("moves the aria-controls link with the selection", () => {
    const p = pane();
    p.button("spaces").click();
    expect(p.button("spaces").getAttribute("aria-controls")).toBe(p.panel!.id);
    expect(p.buttons().map((b) => b.getAttribute("aria-selected"))).toEqual(["false", "true"]);
  });

  it("ArrowRight moves to the next tab, taking focus and tabindex with it", () => {
    const p = pane(THREE);
    p.button("one").focus();
    p.press("ArrowRight");
    expect(p.active).toBe("two");
    expect(document.activeElement).toBe(p.button("two"));
    expect(p.buttons().map((b) => b.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
  });

  it("ArrowLeft moves back, and wraps from the first tab to the last", () => {
    const p = pane(THREE);
    p.button("one").focus();
    p.press("ArrowLeft");
    expect(p.active).toBe("three");
    expect(document.activeElement).toBe(p.button("three"));
  });

  it("ArrowRight wraps from the last tab to the first", () => {
    const p = pane(THREE);
    p.button("three").click();
    p.press("ArrowRight");
    expect(p.active).toBe("one");
  });

  it("Home and End jump to the ends", () => {
    const p = pane(THREE);
    p.button("two").click();
    p.press("End");
    expect(p.active).toBe("three");
    p.press("Home");
    expect(p.active).toBe("one");
  });

  it("leaves keys it does not own to the rest of the page", () => {
    const p = pane(THREE);
    p.button("one").focus();
    p.press("ArrowDown");
    p.press("a");
    expect(p.active).toBe("one");
  });

  it("keeps Home on the first tab inert rather than redrawing for nothing", () => {
    const p = pane(THREE);
    p.button("one").focus();
    p.press("Home");
    expect(p.log).toEqual([]);
    expect(document.activeElement).toBe(p.button("one"));
  });
});

describe("tabForKey — the arrow arithmetic, without a DOM", () => {
  it("steps and wraps in both directions", () => {
    expect(tabForKey("ArrowRight", 0, 3)).toBe(1);
    expect(tabForKey("ArrowRight", 2, 3)).toBe(0);
    expect(tabForKey("ArrowLeft", 1, 3)).toBe(0);
    expect(tabForKey("ArrowLeft", 0, 3)).toBe(2);
  });

  it("sends Home and End to the ends", () => {
    expect(tabForKey("Home", 2, 3)).toBe(0);
    expect(tabForKey("End", 0, 3)).toBe(2);
  });

  it("returns null for every key the strip does not own", () => {
    for (const key of ["ArrowUp", "ArrowDown", "Tab", "Enter", " ", "a"]) {
      expect(tabForKey(key, 1, 3)).toBeNull();
    }
  });
});
