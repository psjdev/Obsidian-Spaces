// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ExplorerAdapter } from "../src/explorer/ExplorerAdapter";
import { CLS, CLS_ELSEWHERE } from "../src/explorer/selectors";
import type { VisibilitySnapshot } from "../src/visibility/VisibilityEngine";
import type { VisibilityDecision } from "../src/types";

function row(path: string, kind: "file" | "folder"): string {
  return `<div class="tree-item nav-${kind}">
    <div class="tree-item-self nav-${kind}-title" data-path="${path}"></div>
  </div>`;
}

function makeContainer(): HTMLElement {
  document.body.innerHTML = `<div class="nav-files-container">
    ${row("Papers", "folder")}
    ${row("Papers/Attention.md", "file")}
    ${row("Recipes.md", "file")}
  </div>`;
  return document.querySelector(".nav-files-container") as HTMLElement;
}

function snapshotOf(map: Record<string, VisibilityDecision>): VisibilitySnapshot {
  return {
    decisionFor: (p) =>
      map[p] ?? {
        visible: false,
        reason: "hidden-nonmember",
        canRemoveMembership: false,
        overridesIgnore: false,
      },
    visiblePaths: () => new Set(Object.keys(map)),
  };
}

const visible = (reason: VisibilityDecision["reason"]): VisibilityDecision => ({
  visible: true,
  reason,
  canRemoveMembership: reason === "exact-member",
  overridesIgnore: false,
});

describe("ExplorerAdapter", () => {
  let container: HTMLElement;
  beforeEach(() => {
    container = makeContainer();
  });

  it("applies classes to the .tree-item wrapper, never the data-path element", () => {
    const a = new ExplorerAdapter();
    a.bind(container);
    a.apply(snapshotOf({ Papers: visible("scaffold") }));
    const title = container.querySelector('[data-path="Papers"]')!;
    const wrapper = title.parentElement!;
    expect(wrapper.classList.contains(CLS.scaffold)).toBe(true);
    expect(title.classList.contains(CLS.scaffold)).toBe(false);
  });

  it("marks scaffold and visitor rows distinctly", () => {
    const a = new ExplorerAdapter();
    a.bind(container);
    a.apply(
      snapshotOf({
        Papers: visible("scaffold"),
        "Papers/Attention.md": visible("visitor"),
      })
    );
    const wrapper = (p: string) =>
      container.querySelector(`[data-path="${p}"]`)!.parentElement!;
    expect(wrapper("Papers").classList.contains(CLS.scaffold)).toBe(true);
    expect(wrapper("Papers/Attention.md").classList.contains(CLS.visitor)).toBe(true);
  });

  it("classifies rows inserted after the initial pass", () => {
    // Pins the LAST link of the chain only
    // (MutationObserver → schedule → requestAnimationFrame → applyNow), because
    // it calls `applyNow()` by hand. The first three links are pinned by the
    // "MutationObserver lifecycle" describe below — keep both: this one
    // stays meaningful for the callers that drive `applyNow()` directly.
    const a = new ExplorerAdapter();
    a.bind(container);
    a.apply(
      snapshotOf({ Papers: visible("exact-member"), "Later.md": visible("visitor") })
    );
    container.insertAdjacentHTML("beforeend", row("Later.md", "file"));
    a.applyNow();
    const w = container.querySelector('[data-path="Later.md"]')!.parentElement!;
    expect(w.classList.contains(CLS.visitor)).toBe(true);
  });

  it("removes every owned class and preserves foreign ones on unbind", () => {
    const wrapper = container.querySelector(".tree-item") as HTMLElement;
    wrapper.classList.add("obsidian-hide-folders--hidden");
    wrapper.style.color = "red";

    const a = new ExplorerAdapter();
    a.bind(container);
    a.apply(snapshotOf({ Papers: visible("scaffold") }));
    a.unbind();

    expect(container.querySelectorAll(`.${CLS.scaffold}`)).toHaveLength(0);
    expect(wrapper.classList.contains("obsidian-hide-folders--hidden")).toBe(true);
    expect(wrapper.style.color).toBe("red");
  });

  it("reaches a fixed point: a repeat apply changes nothing", () => {
    const a = new ExplorerAdapter();
    a.bind(container);
    const snap = snapshotOf({ Papers: visible("scaffold") });
    const first = a.apply(snap);
    const second = a.apply(snap);
    expect(first).toBeGreaterThan(0);
    expect(second).toBe(0);
  });

  it("fails open when no path-bearing rows exist but the tree has content", () => {
    document.body.innerHTML = `<div class="nav-files-container">
      <div class="tree-item nav-file"><div class="tree-item-self"></div></div>
    </div>`;
    const c = document.querySelector(".nav-files-container") as HTMLElement;
    const a = new ExplorerAdapter();
    a.bind(c);
    a.apply(snapshotOf({}));
    expect(a.isHealthy()).toBe(false);
    expect(c.querySelectorAll(`.${CLS.scaffold}`)).toHaveLength(0);
  });

  it("stays healthy while Obsidian is still building the tree", () => {
    // The startup race behind "the file explorer layout was not recognised",
    // seen on a slow load. Measured against 1.13.7: `.nav-files-container`
    // holds ONE wrapper div, whose first child is a virtual-scroll spacer
    // carrying no `data-path`. That wrapper and spacer exist BEFORE any row is
    // populated, so a check on `children.length` alone cannot tell "Obsidian
    // changed its DOM contract" from "the tree is not built yet" and fires a
    // frightening Notice during a perfectly normal startup.
    //
    // No rows means nothing is being mis-presented, so there is nothing to
    // fail open from.
    document.body.innerHTML = `<div class="nav-files-container">
      <div><div style="width: 305px; height: 0.1px; margin-bottom: 0px;"></div></div>
    </div>`;
    const c = document.querySelector(".nav-files-container") as HTMLElement;
    const a = new ExplorerAdapter();
    const seen: boolean[] = [];
    a.onHealthChange((h) => seen.push(h));
    a.bind(c);
    a.apply(snapshotOf({}));

    expect(a.isHealthy()).toBe(true);
    expect(seen).toEqual([]);
  });

  it("still fails open once rows exist but carry no data-path", () => {
    // The condition the health check is actually FOR, kept distinct from the
    // one above: rows are on screen and we cannot say which file each is.
    document.body.innerHTML = `<div class="nav-files-container">
      <div><div style="height: 0.1px;"></div>
        <div class="tree-item nav-file"><div class="tree-item-self"></div></div>
      </div>
    </div>`;
    const c = document.querySelector(".nav-files-container") as HTMLElement;
    const a = new ExplorerAdapter();
    a.bind(c);
    a.apply(snapshotOf({}));

    expect(a.isHealthy()).toBe(false);
  });

  it("applying null clears owned classes (All mode)", () => {
    const a = new ExplorerAdapter();
    a.bind(container);
    a.apply(snapshotOf({ Papers: visible("scaffold") }));
    expect(container.querySelectorAll(`.${CLS.scaffold}`).length).toBeGreaterThan(0);
    a.apply(null);
    expect(container.querySelectorAll(`.${CLS.scaffold}`)).toHaveLength(0);
  });

  it("onHealthChange fires once on the healthy-to-unhealthy edge, not per apply", () => {
    document.body.innerHTML = `<div class="nav-files-container">
      <div class="tree-item nav-file"><div class="tree-item-self"></div></div>
    </div>`;
    const c = document.querySelector(".nav-files-container") as HTMLElement;
    const a = new ExplorerAdapter();
    const seen: boolean[] = [];
    a.onHealthChange((h) => seen.push(h));
    a.bind(c);
    a.apply(snapshotOf({}));
    a.apply(snapshotOf({}));
    a.applyNow();
    expect(seen).toEqual([false]);
  });

  it("onHealthChange fires again when health returns", () => {
    const a = new ExplorerAdapter();
    const seen: boolean[] = [];
    a.bind(container);
    a.onHealthChange((h) => seen.push(h));

    // Break health, then rebind to a healthy container.
    document.body.innerHTML = `<div class="nav-files-container">
      <div class="tree-item nav-file"><div class="tree-item-self"></div></div>
    </div>`;
    const broken = document.querySelector(".nav-files-container") as HTMLElement;
    a.bind(broken);
    a.apply(snapshotOf({}));
    expect(seen).toEqual([false]);

    a.bind(makeContainer());
    a.apply(snapshotOf({}));
    expect(seen).toEqual([false, true]);
  });
});

/**
 * The observer lifecycle itself.
 *
 * The windowed tree is one of the two Spike A facts in `ExplorerAdapter`'s own
 * docstring: rows detach when scrolled out of view and reattach later, so
 * application must run on row INSERTION, not only on the applies the plugin
 * initiates. That mechanism is `MutationObserver → schedule() →
 * requestAnimationFrame → applyNow()`, and until these tests existed both the
 * observer and its `disconnect()` could be deleted outright with the suite
 * green — every test reached `applyNow()` by hand.
 *
 * Nothing here sleeps. The first test polls the class it is
 * waiting for. The second cannot poll for an ABSENCE, so it uses a second,
 * still-bound adapter as a barrier: once the witness has classified its own
 * new row, a full observer→frame cycle has demonstrably completed, and the
 * unbound adapter's silence is a decision rather than a race.
 */
describe("ExplorerAdapter — MutationObserver lifecycle", () => {
  function addContainer(): HTMLElement {
    const el = document.createElement("div");
    el.className = "nav-files-container";
    document.body.appendChild(el);
    return el;
  }

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("classifies a row the tree inserts on its own, with no explicit apply", async () => {
    const container = addContainer();
    container.innerHTML = row("Papers", "folder");

    const a = new ExplorerAdapter();
    a.bind(container);
    a.apply(
      snapshotOf({ Papers: visible("exact-member"), "Scrolled-in.md": visible("visitor") })
    );

    // What Obsidian's virtualisation does when the row scrolls back into view.
    container.insertAdjacentHTML("beforeend", row("Scrolled-in.md", "file"));

    await vi.waitFor(() => {
      const w = container.querySelector('[data-path="Scrolled-in.md"]')?.parentElement;
      expect(w?.classList.contains(CLS.visitor)).toBe(true);
    });

    a.unbind();
  });

  it("coalesces a burst of insertions into a single frame", async () => {
    const container = addContainer();
    container.innerHTML = row("Papers", "folder");

    const a = new ExplorerAdapter();
    a.bind(container);
    a.apply(snapshotOf({ "A.md": visible("visitor"), "B.md": visible("visitor") }));

    const real = window.requestAnimationFrame;
    let frames = 0;
    window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
      frames++;
      return real.call(window, cb);
    }) as typeof window.requestAnimationFrame;

    try {
      container.insertAdjacentHTML("beforeend", row("A.md", "file"));
      container.insertAdjacentHTML("beforeend", row("B.md", "file"));

      await vi.waitFor(() => {
        const w = container.querySelector('[data-path="B.md"]')?.parentElement;
        expect(w?.classList.contains(CLS.visitor)).toBe(true);
      });
      expect(frames).toBe(1);
    } finally {
      window.requestAnimationFrame = real;
      a.unbind();
    }
  });

  it("schedules nothing more once unbound, so the observer is really disconnected", async () => {
    const container = addContainer();
    container.innerHTML = row("Papers", "folder");

    const a = new ExplorerAdapter();
    a.bind(container);
    a.apply(snapshotOf({ Papers: visible("scaffold"), "Late.md": visible("visitor") }));

    const real = window.requestAnimationFrame;
    let frames = 0;
    window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
      frames++;
      return real.call(window, cb);
    }) as typeof window.requestAnimationFrame;

    try {
      // Positive control: while bound, an insertion reaches the frame request.
      container.insertAdjacentHTML("beforeend", row("Late.md", "file"));
      await vi.waitFor(() => expect(frames).toBe(1));

      a.unbind();
      const beforeUnboundMutation = frames;

      // The barrier described in the block comment above.
      const witnessEl = addContainer();
      const witness = new ExplorerAdapter();
      witness.bind(witnessEl);
      witness.apply(snapshotOf({ "Witness.md": visible("visitor") }));

      container.insertAdjacentHTML("beforeend", row("Orphan.md", "file"));
      witnessEl.insertAdjacentHTML("beforeend", row("Witness.md", "file"));

      await vi.waitFor(() => {
        const w = witnessEl.querySelector('[data-path="Witness.md"]')?.parentElement;
        expect(w?.classList.contains(CLS.visitor)).toBe(true);
      });

      // Exactly one frame — the witness's. An adapter that never disconnected
      // would have requested a second one off the very same mutation batch.
      expect(frames).toBe(beforeUnboundMutation + 1);
      witness.unbind();
    } finally {
      window.requestAnimationFrame = real;
    }
  });
});

describe("ExplorerAdapter across several containers", () => {
  function pane(): HTMLElement {
    const el = document.createElement("div");
    el.className = "nav-files-container";
    el.innerHTML = `${row("Papers", "folder")}${row("Papers/Attention.md", "file")}`;
    document.body.appendChild(el);
    return el;
  }

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  const scaffolded = (el: HTMLElement): boolean =>
    el.querySelector('[data-path="Papers"]')!.parentElement!.classList.contains(CLS.scaffold);

  it("classes rows in every bound container from the one snapshot", () => {
    // One selection, applied to every file-explorer leaf in the main
    // window. A second pane used to render unclassed and unfiltered.
    const a = new ExplorerAdapter();
    const left = pane();
    const split = pane();
    a.bindAll([left, split]);
    a.apply(snapshotOf({ Papers: visible("scaffold") }));
    expect(scaffolded(left)).toBe(true);
    expect(scaffolded(split)).toBe(true);
    a.unbind();
  });

  it("counts a changed row in each container", () => {
    const a = new ExplorerAdapter();
    a.bindAll([pane(), pane()]);
    expect(a.apply(snapshotOf({ Papers: visible("scaffold") }))).toBe(2);
    a.unbind();
  });

  it("clears owned classes from every container on unbind", () => {
    const a = new ExplorerAdapter();
    const left = pane();
    const split = pane();
    a.bindAll([left, split]);
    a.apply(snapshotOf({ Papers: visible("scaffold") }));
    a.unbind();
    expect(scaffolded(left)).toBe(false);
    expect(scaffolded(split)).toBe(false);
  });

  it("observes every container, not only the first", async () => {
    const a = new ExplorerAdapter();
    const left = pane();
    const split = pane();
    a.bindAll([left, split]);
    a.apply(snapshotOf({ "Scrolled-in.md": visible("visitor") }));
    // Obsidian's virtualisation reattaching a row in the SECOND pane.
    split.insertAdjacentHTML("beforeend", row("Scrolled-in.md", "file"));
    await vi.waitFor(() => {
      const w = split.querySelector('[data-path="Scrolled-in.md"]')?.parentElement;
      expect(w?.classList.contains(CLS.visitor)).toBe(true);
    });
    a.unbind();
  });

  it("drops a duplicate container rather than observing it twice", () => {
    const a = new ExplorerAdapter();
    const left = pane();
    a.bindAll([left, left]);
    // One observer and one pass: a doubled container would double the count.
    expect(a.apply(snapshotOf({ Papers: visible("scaffold") }))).toBe(1);
    a.unbind();
  });

  it("stays bound to the survivors when rebinding a shrunken set", () => {
    // changeLayout() replaces containers wholesale, so the rebind is wholesale
    // too: the pane that went away must lose its classes, the one that stayed
    // must keep working.
    const a = new ExplorerAdapter();
    const left = pane();
    const split = pane();
    a.bindAll([left, split]);
    a.apply(snapshotOf({ Papers: visible("scaffold") }));
    a.bindAll([left]);
    a.apply(snapshotOf({ Papers: visible("scaffold") }));
    expect(scaffolded(left)).toBe(true);
    expect(scaffolded(split)).toBe(false);
    a.unbind();
  });
});

describe("ExplorerAdapter — the elsewhere group's boundary (P4 ruling)", () => {
  // `apply(snapshot)` alone carries no ordering (a snapshot has no order), so
  // the CALLER — which computed the elsewhere group's order — hands the
  // adapter the one path to mark, and the adapter stays a renderer.
  let container: HTMLElement;
  beforeEach(() => {
    container = makeContainer();
  });

  function wrapperOf(path: string): HTMLElement {
    return container.querySelector(`[data-path="${path}"]`)!.parentElement!;
  }

  it("classes only the named path", () => {
    const a = new ExplorerAdapter();
    a.bind(container);
    a.apply(snapshotOf({ "Recipes.md": visible("visitor") }), "Recipes.md");
    expect(wrapperOf("Recipes.md").classList.contains(CLS_ELSEWHERE)).toBe(true);
    expect(wrapperOf("Papers").classList.contains(CLS_ELSEWHERE)).toBe(false);
    expect(wrapperOf("Papers/Attention.md").classList.contains(CLS_ELSEWHERE)).toBe(false);
  });

  it("classes nothing when the elsewhere group is empty (omitted / null)", () => {
    const a = new ExplorerAdapter();
    a.bind(container);
    a.apply(snapshotOf({ "Recipes.md": visible("visitor") }));
    expect(container.querySelectorAll(`.${CLS_ELSEWHERE}`)).toHaveLength(0);
  });

  it("moves the marker when a later apply names a different path", () => {
    const a = new ExplorerAdapter();
    a.bind(container);
    a.apply(snapshotOf({ "Recipes.md": visible("visitor") }), "Recipes.md");
    a.apply(snapshotOf({ "Papers/Attention.md": visible("visitor") }), "Papers/Attention.md");
    expect(wrapperOf("Recipes.md").classList.contains(CLS_ELSEWHERE)).toBe(false);
    expect(wrapperOf("Papers/Attention.md").classList.contains(CLS_ELSEWHERE)).toBe(true);
  });

  it("clears the marker along with every other owned class on unbind", () => {
    const a = new ExplorerAdapter();
    a.bind(container);
    a.apply(snapshotOf({ "Recipes.md": visible("visitor") }), "Recipes.md");
    a.unbind();
    expect(container.querySelectorAll(`.${CLS_ELSEWHERE}`)).toHaveLength(0);
  });

  it("classes a marked row inserted after the initial pass", () => {
    // Same shape as the scaffold/visitor case above: the tree is windowed, so
    // classing must run again on row insertion, not just at apply() time.
    const a = new ExplorerAdapter();
    a.bind(container);
    a.apply(snapshotOf({ "Later.md": visible("visitor") }), "Later.md");
    container.insertAdjacentHTML("beforeend", row("Later.md", "file"));
    a.applyNow();
    expect(wrapperOf("Later.md").classList.contains(CLS_ELSEWHERE)).toBe(true);
  });
});
