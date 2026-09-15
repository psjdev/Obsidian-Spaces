import { Notice, PluginSettingTab, Setting, type App, type Plugin } from "obsidian";
import type { DefinitionStore } from "../definitions/DefinitionStore";
import type { SpacesDefinitions } from "../types";
import { deleteSpace, renameSpace, type SpaceLifecycleHooks } from "../actions/spaceLifecycle";
import { memberRows, missingCount, spaceRowSummary } from "./memberList";
import {
  MAX_PATTERNS,
  MAX_PATTERN_LENGTH,
  compileIgnore,
  type SkipReason,
} from "../visibility/glob";
import { isFolderSpace } from "../visibility/folderSpace";
import { ConfirmModal } from "./ConfirmModal";
import { SpaceContentsModal } from "./SpaceContentsModal";
import { activateTab, renderTabStrip, type TabPaneHost } from "./settingsTabs";
import {
  BlurCommitLedger,
  deleteWithConfirm,
  type BlurCommittedField,
} from "./settingsEdits";

/**
 * Where to send someone who wants to support the plugin, or `""` for
 * nowhere.
 *
 * Empty renders NO header at all, rather than a dead link or a placeholder —
 * an affordance that does nothing is worse than an absent one. Point it at
 * Ko-fi, Buy Me a Coffee, GitHub Sponsors or anything else; all of them are
 * just a URL, and the choice changes nothing here.
 *
 * Empty is what ships. Obsidian's developer policies treat a support prompt
 * inside the plugin's own interface as something a README has to disclose, and
 * `manifest.json`'s `fundingUrl` already does the same job the way Obsidian
 * intends: a Support link on the community-list entry, no code, and nothing
 * asking for money inside the settings tab. The renderer below stays because
 * the decision is a URL, not a rewrite.
 *
 * Whoever sets it must name an address `fundingUrl` also names.
 * `tests/manifest.test.ts` asserts exactly that, because the failure that
 * matters is a settings link the listing never offers.
 */
export const SUPPORT_URL = "";

/**
 * Whether something outside spaces's own toggle is standing in the way of
 * restoration. `reason` is present whenever the native-workspaces status is
 * not "disabled" — independent of the toggle's own value: a
 * user who reads the toggle as ON and stops reading must not be shown a
 * clean pane when core Workspaces already overrides it. Kept as a plain
 * accessor (rather than importing the detector) so this file never needs to
 * know about Obsidian's private `internalPlugins` API.
 */
export interface EffectiveRestoreState {
  reason?: string;
}

/**
 * Whether the file explorer still exposes the sort seam ordering rides on.
 * Kept as a plain accessor for the same reason as
 * `EffectiveRestoreState` above: this file must never need to know which
 * private method ordering rides on — that knowledge is quarantined to
 * `src/layout/nativeExplorerSort.ts`, and naming it here would defeat the
 * grep that checks the quarantine holds.
 *
 * `available: false` is surfaced rather than swallowed. Ordering depends on
 * private API, which is the most version-fragile thing in this plugin, and a
 * user whose Obsidian dropped the seam deserves to see why dragging stopped
 * working instead of concluding the feature is broken.
 */
interface OrderingStatus {
  available: boolean;
}

/**
 * The Ignored-paths box reduced to exactly what gets persisted. Shared by the
 * commit and the flush so both compare like with like: without one
 * canonical form, adding a trailing newline would read as a pending edit
 * forever and `hide()` would rewrite the same list on every close.
 */
function ignoreLines(raw: string): string[] {
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

/**
 * One sentence per skip reason, in the second person, saying what to do about
 * it. The reasons themselves come from `compileIgnore`; only the wording lives
 * here, because the wording is this control's business and the rule is the
 * compiler's.
 */
export function ignoreSkipMessage(reason: SkipReason): string {
  switch (reason) {
    case "over-cap":
      // "Maximum 100 patterns; beyond that, extras are ignored with a
      // notice." This is that notice.
      return `Only the first ${MAX_PATTERNS} patterns are used, and this one is past that limit.`;
    case "blank":
      return "Blank, so there is nothing to match.";
    case "too-long":
      // The cap bounds what one pattern can cost to match, so the
      // advice is to shorten it rather than to rewrite it.
      return `Longer than ${MAX_PATTERN_LENGTH} characters. Shorten it, or split it into separate rules.`;
    case "traversal":
      return 'Has a ".." segment, which patterns may not use. A folder whose name merely contains two dots is fine.';
    case "absolute":
      return 'Starts with "/". Patterns are vault-relative, so remove the leading slash.';
    case "uncompilable":
      return "Not a pattern this version can compile, so it hides nothing.";
  }
}

type TabId = "preferences" | "spaces";

/**
 * TWO tabs, not one per section.
 *
 * The pattern is borrowed from plugins like Copilot, but the split is not:
 * they have substantial content per category, and spaces has seven toggles
 * in total. One tab per section would have put two settings behind three of
 * them and ONE behind another, so finding a toggle would mean guessing which
 * tab it lived under — navigation added on top of a problem navigation does
 * not solve.
 *
 * What actually buried the toggles was the space list, which grows without
 * bound. Separating that is the whole win; the toggles stay on one screen,
 * grouped by their headings, scannable at a glance.
 */
const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: "preferences", label: "Preferences" },
  { id: "spaces", label: "Spaces" },
];

export class SpacesSettingTab extends PluginSettingTab {
  /**
   * The controls on this tab that persist from `blur` alone. Removing
   * a focused element does not fire `blur`, and closing the settings modal
   * with Escape removes it — so `hide()` flushes through this instead of
   * letting the edit go nowhere.
   */
  private readonly edits = new BlurCommitLedger();

  /** Where the rejected-pattern warning is (re)drawn. */
  private ignoreWarningEl: HTMLElement | null = null;

  constructor(
    app: App,
    plugin: Plugin,
    private defs: DefinitionStore,
    private hooks?: SpaceLifecycleHooks,
    private getEffectiveRestore?: () => EffectiveRestoreState,
    private getOrderingStatus?: () => OrderingStatus
  ) {
    super(app, plugin);
  }

  /**
   * Which panel is showing. An instance field, so it survives the `display()`
   * calls that deleting a space or flipping the reordering parent trigger —
   * being thrown back to Preferences after deleting one of eleven spaces
   * would be its own small insult.
   */
  private activeTab: TabId = "preferences";

  /**
   * Grouped into headed sections rather than one flat run of toggles.
   *
   * The tab had grown to seven unrelated switches followed by every member of
   * every space, so finding one setting meant reading all of them and
   * scrolling past a list nobody opened the tab to read. The groups are by
   * what a setting AFFECTS — what is drawn, what the tree shows, what a drag
   * does, what a switch carries — because that is what someone arriving with
   * a problem already knows.
   */
  override display(): void {
    const { containerEl } = this;
    containerEl.empty();
    // Every control below is about to be rebuilt; the previous
    // render's are detached, and a flush through one of those would write a
    // stale value.
    this.edits.clear();
    this.ignoreWarningEl = null;

    this.renderSupport(containerEl);

    // The sections go inside the strip's panel, not loose in `containerEl`:
    // the panel is what the selected tab's `aria-controls` points at, so it
    // has to be the element the content is actually in.
    const panel = this.renderTabStrip(containerEl);

    if (this.activeTab === "spaces") {
      this.renderSpaces(panel);
      return;
    }

    this.renderAppearance(panel);
    this.renderFileTree(panel);
    this.renderReordering(panel);
    this.renderSwitching(panel);
  }

  /**
   * The tab strip. Built by `settingsTabs.ts` rather than here, because
   * nothing in this file can be driven under Vitest — the obsidian stub's
   * `new Setting()` throws by design — and the strip's behaviour is worth
   * pinning. Returns the panel the selected tab's content belongs in.
   */
  private renderTabStrip(containerEl: HTMLElement): HTMLElement {
    const strip = renderTabStrip(containerEl, {
      tabs: TABS,
      activeId: this.activeTab,
      // Names what the strip switches between, rather than leaving a screen
      // reader to announce an unlabelled tablist.
      label: "Spaces settings",
      idPrefix: "spaces-settings",
      onActivate: (id) => {
        activateTab(this.paneHost, this.activeTab, id);
      },
    });
    // Kept so `focusActiveTab` can reach the control the NEXT render builds;
    // the one the user clicked is gone by then.
    this.activeTabEl = strip.activeEl;
    return strip.panelEl;
  }

  /**
   * The tab control for the selected tab, as of the last render. Null only
   * before the first one.
   */
  private activeTabEl: HTMLElement | null = null;

  /**
   * The pane, as `activateTab` needs to see it. A field rather than a fresh
   * object per call so the identity is stable, which keeps it readable in a
   * debugger and costs nothing. `activateTab` owns the ORDER of these; see
   * its docstring for why each one sits where it does.
   */
  private readonly paneHost: TabPaneHost = {
    flushEdits: () => {
      this.edits.flush();
    },
    setActiveTab: (id) => {
      this.activeTab = id as TabId;
    },
    render: () => {
      this.display();
    },
    focusActiveTab: () => {
      this.activeTabEl?.focus();
    },
  };

  /**
   * The base implementation empties `containerEl`, which detaches the
   * focused input WITHOUT firing `blur` — the HTML standard's focus fixup
   * moves focus to the body silently (run in `tests/settingsBlurFlush.test.ts`).
   * The settings modal closes on Escape while an input is focused, so without
   * this the last thing typed into the ignore box or a rename field was
   * discarded, with the reopened pane showing the old value as confirmation
   * that the setting does not work.
   *
   * The ledger writes only what `blur` did not, so a normal tab-away is not
   * written twice.
   */
  override hide(): void {
    this.edits.flush();
    this.edits.clear();
    // A flush's write settles after this returns; by then the container is
    // emptied, so the warning has nowhere to go and must not be drawn into a
    // detached node.
    this.ignoreWarningEl = null;
    super.hide();
  }

  /**
   * Rendered only when `SUPPORT_URL` is set, so an undecided host
   * leaves no trace here.
   *
   * A text link, deliberately, and not the badge image Ko-fi and Buy Me a
   * Coffee both offer: a remote PNG means a network request every time this
   * tab opens, a broken image offline, and a third party learning when
   * someone opens their settings. None of that buys anything a styled link
   * does not.
   *
   * The README *does* carry support links, and that is not a contradiction:
   * they are text on a web page GitHub already serves, read by a browser
   * nobody is trusting with their vault. The rule here is about what the
   * PLUGIN fetches, which is nothing — see `tests/noNetwork.test.ts`.
   */
  private renderSupport(containerEl: HTMLElement): void {
    if (!SUPPORT_URL) return;
    const bar = containerEl.createDiv({ cls: "spaces-support" });
    bar.appendText("Spaces is free and made in spare time. ");
    const link = bar.createEl("a", {
      text: "Support its development",
      href: SUPPORT_URL,
    });
    link.setAttr("target", "_blank");
    // `noopener` because the link opens a third-party page in a new context
    // and that page has no business reaching back into ours.
    link.setAttr("rel", "noopener noreferrer");
  }

  /** Settings that change only what is drawn — no data, no gesture. */
  private renderAppearance(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Appearance").setHeading();

    // Purely a display choice, and the only setting here that changes
    // nothing but what is drawn — no data, no gesture, no layout behaviour.
    new Setting(containerEl)
      .setName("Show the space name above the file tree")
      .setDesc(
        "Shows the active space's icon and name at the top of the file explorer. " +
          "Turn it off if the icon strip along the bottom is orientation enough."
      )
      .addToggle((t) =>
        t.setValue(this.defs.get().settings.showSpaceHeader).onChange((v) => {
          this.save((d) => {
            d.settings.showSpaceHeader = v;
          });
        })
      );

    // Deliberately left visible and enabled when the header is off,
    // rather than hidden or disabled: the row above says what it depends on,
    // and making it react to its neighbour would need re-render machinery in
    // the one file the obsidian stub cannot drive. With the header off it
    // simply has nowhere to draw, which is what the copy says.
    new Setting(containerEl)
      .setName("Mark folder pinned spaces with a pin")
      .setDesc(
        "When the space name row above is shown, a folder pinned space gets a pin " +
          "on the right. Hover it to see which folder."
      )
      .addToggle((t) =>
        t.setValue(this.defs.get().settings.showPinnedFolder).onChange((v) => {
          this.save((d) => {
            d.settings.showPinnedFolder = v;
          });
        })
      );

    // Like the toggles above, purely a display choice — but defaulted OFF
    // rather than on, because it rearranges a strip existing users already
    // read fluently. Turning that on unasked during an update reads as a bug.
    new Setting(containerEl)
      // Led by "All" rather than "Pin All …": sentence case is linted, and
      // mid-sentence the view's own label is indistinguishable from the
      // quantifier — "Pin all …" would read as pinning every icon.
      .setName("All stays at the left of the space strip")
      .setDesc(
        "Keeps All in place while the other space icons scroll past it, " +
          "the way the + button stays pinned to the right."
      )
      .addToggle((t) =>
        t.setValue(this.defs.get().settings.pinAllSpace).onChange((v) => {
          this.save((d) => {
            d.settings.pinAllSpace = v;
          });
        })
      );

    // Governs only what a NEW space starts on — an existing space keeps
    // the colour it was created with either way, so turning this off does not
    // drain the colour out of a vault someone has already arranged.
    //
    // The decision itself is `startingSpaceColor` (spaceLifecycle.ts), not
    // here: `display()` cannot be driven under the obsidian stub, so
    // this reads a boolean and hands it over, and the rule stays testable.
    new Setting(containerEl)
      .setName("Assign a colour to new spaces")
      .setDesc(
        "New spaces take the next colour in the palette, so consecutive " +
          "spaces are easy to tell apart. Turn this off to start every new " +
          "space neutral and pick its colour yourself."
      )
      .addToggle((t) =>
        t.setValue(this.defs.get().settings.autoAssignColor).onChange((v) => {
          this.save((d) => {
            d.settings.autoAssignColor = v;
          });
        })
      );
  }

  /** Settings that change which rows the explorer shows. */
  private renderFileTree(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("File tree").setHeading();

    // Deliberately independent of the restore toggle: one
    // governs tabs, this one governs which rows appear. Coupling them through
    // the visitor set leaves a user reading two independent-sounding toggles
    // unable to predict the behaviour.
    //
    // The two live in separate sections, which makes that independence
    // structural rather than something the wording has to carry.
    new Setting(containerEl)
      .setName("Show files you open that are not in this space")
      .setDesc(
        // This governs ROWS, so it must not reach for tabs,
        // layouts or switching to explain itself — those belong to the
        // restore toggle. It says opening a file reveals it and stops there:
        // a revealed row can outlive its tab (the carry), so any wording that
        // promises a row-to-tab equivalence overstates the semantics.
        "A file you open appears dimmed and italic even when it is not a member, " +
          "so you can see it and add it to the space. Turn this off to show only members."
      )
      .addToggle((t) =>
        t.setValue(this.defs.get().settings.revealVisitors).onChange((v) => {
          this.save((d) => {
            d.settings.revealVisitors = v;
          });
        })
      );

    const ignore = new Setting(containerEl)
      .setName("Ignored paths")
      .setDesc(
        "One glob per line. Supports * within a segment and ** across segments. " +
          "Hidden in every space; an explicit member overrides this."
      )
      .addTextArea((t) => {
        t.setValue(this.defs.get().settings.globalIgnore.join("\n"));
        t.inputEl.rows = 6;
        // The commit path is shared with `hide()` rather than living
        // in the blur handler, so an edit abandoned with Escape still lands
        // and one that blurred normally is not written twice.
        const field: BlurCommittedField = {
          current: () => ignoreLines(t.getValue()).join("\n"),
          write: (value) => {
            const lines = value ? value.split("\n") : [];
            this.defs
              .mutate((d) => {
                d.settings.globalIgnore = lines;
              })
              // Two-argument `then`, not `.then().catch()`: a throw from the
              // warning render must not be reported as a failure to save
              // something that already reached disk.
              .then(
                // The verdict on what the user just typed belongs next
                // to the box while they are still looking at it.
                () => this.renderIgnoreWarning(),
                (e: unknown) => {
                  new Notice(`Spaces: could not save ignored paths (${String(e)})`);
                }
              );
          },
        };
        this.edits.track(field, this.defs.get().settings.globalIgnore.join("\n"));
        t.inputEl.addEventListener("blur", () => {
          this.edits.commit(field);
        });
      });

    // An over-cap or invalid pattern must be REPORTED, not dropped in
    // silence: otherwise the box shows the rule, `data.json` stores it, and it
    // hides nothing. Inside the setting's own description for the same reason
    // the restore warning is — it is a fact about this control, not a loose
    // paragraph.
    this.ignoreWarningEl = ignore.descEl.createDiv();
    this.renderIgnoreWarning();
  }

  /**
   * The notice for patterns past the cap, and for an invalid pattern that is
   * reported and skipped. Same visual treatment as the
   * ordering warning below rather than a third style, and no colours of its
   * own — `.spaces-setting-warning` is built from `--text-error` and
   * `--background-modifier-error`.
   */
  private renderIgnoreWarning(): void {
    const host = this.ignoreWarningEl;
    if (!host) return;
    host.empty();

    // `IgnoreMatcher.skipped` carries `{ pattern, index, reason }`, so this
    // reads the compiler's own verdict. Re-deriving the reason from the
    // pattern text and pairing it back onto a line by searching for the string
    // would be two copies of one rule set, and would blame a duplicate pushed
    // past the cap on the first copy.
    const { skipped } = compileIgnore(this.defs.get().settings.globalIgnore);
    if (skipped.length === 0) return;

    const warn = host.createDiv({ cls: "spaces-setting-warning" });
    warn.createEl("strong", {
      text:
        skipped.length === 1
          ? "1 pattern is not being applied. "
          : `${skipped.length} patterns are not being applied. `,
    });
    warn.appendText("They are still saved, but they hide nothing:");
    for (const s of skipped) {
      const line = warn.createDiv();
      line.appendText(`Line ${s.index + 1}: `);
      line.createEl("code", { text: s.pattern.trim() || "(blank)" });
      line.appendText(` — ${ignoreSkipMessage(s.reason)}`);
    }
  }

  /** The two booleans, the second subordinate to the first. */
  private renderReordering(containerEl: HTMLElement): void {
    new Setting(containerEl).setName("Reordering").setHeading();

    const allowReordering = this.defs.get().settings.allowReordering;

    // Defaults on, because the drag interception is additive — it
    // claims a drop only between rows and leaves folder drops,
    // drag-into-editor and drag-out-of-app untouched — and a feature
    // defaulted off is a feature nobody finds.
    const ordering = new Setting(containerEl)
      .setName("Allow reordering of space items")
      .setDesc(
        "Drag rows in the file explorer to arrange them, remembered separately " +
          "for each space and for All. Turn this off to sort the tree normally; " +
          "any orders you have set are kept, not discarded."
      )
      .addToggle((t) =>
        t.setValue(allowReordering).onChange((v) => {
          // Re-rendered, unlike every other toggle here, because the child
          // setting below reads this value to decide whether it is enabled.
          this.save((d) => {
            d.settings.allowReordering = v;
          }, true);
        })
      );

    // The second boolean, which can only ever NARROW the first — it can
    // never re-enable what the parent switched off.
    //
    // Expressed by BEHAVIOUR and WORDS, not by indenting the row: disabled
    // while the parent is off, with a description that says so. Rows stay full
    // width: indenting the `.setting-item` breaks the alignment of the row's
    // bubble against every other row, and indenting its content behind an
    // accent spine singles the row out without telling the reader anything the
    // disabled toggle and its copy are not already saying.
    new Setting(containerEl)
      // "outside spaces" for the same sentence-case reason as the setting
      // above. All is the only thing outside a space, and the description
      // below still names it.
      .setName("Allow reordering outside spaces")
      .setDesc(
        allowReordering
          ? "Drag rows to arrange them in All as well as in spaces. Turn this off to leave " +
              "All sorted the way Obsidian sorts it; any order you have set for All is kept, " +
              "not discarded."
          : "Reordering is off above, so this has no effect. Any order you have set for All " +
              "is kept, and this applies again when you turn reordering back on."
      )
      .addToggle((t) =>
        t
          .setValue(this.defs.get().settings.allowReorderingAll)
          .setDisabled(!allowReordering)
          .onChange((v) => {
            this.save((d) => {
              d.settings.allowReorderingAll = v;
            });
          })
      );

    if (this.getOrderingStatus && !this.getOrderingStatus().available) {
      // Same treatment as a restore blocked from outside: say so where
      // the toggle is, not in a console nobody reads.
      const warn = ordering.descEl.createDiv({ cls: "spaces-setting-warning" });
      warn.createEl("strong", { text: "Unavailable in this Obsidian version. " });
      warn.appendText(
        "Spaces filters and orders the tree through the file explorer's own sort, " +
          "and this version does not expose it. Spaces can no longer filter, so the " +
          "whole vault shows; nothing you have set has been lost, and it will apply " +
          "again when Obsidian restores it."
      );
    }
  }

  /** What a space switch carries with it. */
  private renderSwitching(containerEl: HTMLElement): void {
    // "Switching", not "Switching spaces": a settings heading that repeats the
    // plugin name reads as a label inside its own tab, and Obsidian lints for
    // it (`obsidianmd/settings-tab/no-problematic-settings-headings`). The
    // settings below say what is being switched.
    new Setting(containerEl).setName("Switching").setHeading();

    const restore = new Setting(containerEl)
      .setName("Restore tabs when switching spaces")
      .setDesc(
        "Off, switching changes only the file tree. On, each space also " +
          "remembers its own tabs, sidebars and active pane, and switching " +
          "restores them."
      )
      .addToggle((t) =>
        t.setValue(this.defs.get().settings.restoreLayouts).onChange((v) => {
          this.save((d) => {
            d.settings.restoreLayouts = v;
          });
        })
      );

    // Show the effective state and why, not just the configured value —
    // otherwise a user with core Workspaces enabled sees the toggle ON with
    // no explanation, and learns about the override only from a transient
    // Notice on their next switch.
    const info = this.getEffectiveRestore?.();
    if (info?.reason) {
      // Inside the setting's own description, not a loose paragraph after it:
      // the override is a fact ABOUT this toggle, and a user who reads the
      // toggle and stops has read the wrong thing.
      const warn = restore.descEl.createDiv({ cls: "spaces-restore-warning" });
      warn.createEl("strong", { text: "Restoration is unavailable:" });
      warn.appendText(` ${info.reason}.`);
    }
  }

  /**
   * Rename, open its contents, delete.
   *
   * The per-member rows live in `SpaceContentsModal`, not here. They are not
   * noise — a space keeps an entry whose file has gone so the path can be
   * reoccupied, and that list is the only place to see or clear one — but
   * making every user scroll past every member of every space to reach a
   * toggle is the wrong price for it.
   */
  private renderSpaces(containerEl: HTMLElement): void {
    // No "Spaces" heading here: the tab above already says it, and a
    // heading repeating its own tab is noise.
    const spaces = this.defs.get().spaces;
    if (spaces.length === 0) {
      containerEl.createEl("p", {
        cls: "spaces-settings-empty",
        text: "No spaces yet. Use the + button at the bottom of the file explorer to make one.",
      });
      return;
    }

    for (const space of spaces) {
      // `members.length` alone overstates a space that has lost files,
      // because an entry whose path no longer resolves is kept.
      // `rows`/`missing` still feed the delete-confirmation prompt below,
      // which is about MEMBERS regardless of kind. `memberRows` reads
      // `space.members` directly, and a folder space's rendering ignores
      // that field but validation does not clear it — so
      // for the ordinary folder space `rows` is empty (it never had members
      // to begin with) and the prompt correctly asks about nothing to lose,
      // but for one that gained a `root` while keeping a stored `members`
      // (a hand-edited `data.json`, or a curated space repointed at a
      // folder) `rows` reflects that real, if invisible, list — which is the
      // right thing for the prompt to warn about, since deleting the space
      // still deletes that data.
      const exists = (path: string): boolean =>
        this.app.vault.getAbstractFileByPath(path) !== null;
      const rows = memberRows(space, exists);
      const missing = missingCount(rows);

      // The row's own description, for either kind of space — a
      // curated space's member count, or a folder space's root (and the
      // missing-root wording when it cannot be honoured). See
      // `spaceRowSummary` for why `exists` is never asked about a root of ""
      // or "/".
      const setting = new Setting(containerEl)
        .setName(space.name)
        .setDesc(spaceRowSummary(space, exists))
        .addText((t) => {
          t.setValue(space.name);
          // As for the ignore box above: the rename must survive an
          // Escape that closes the pane while this field still has focus.
          const field: BlurCommittedField = {
            current: () => t.getValue().trim(),
            // An emptied box is not a rename — and rejecting it leaves the
            // baseline alone, so typing a real name afterwards still commits.
            accepts: (v) => v.length > 0,
            write: (v) => {
              void renameSpace(this.defs, space.id, v);
            },
          };
          this.edits.track(field, space.name);
          t.inputEl.addEventListener("blur", () => {
            this.edits.commit(field);
          });
        });

      // A folder space has no per-member list — its "contents" is a
      // whole real folder, already browsable in All by opening that folder —
      // so a modal that only ever shows "No members" would be a second,
      // redundant way to look at the same folder rather than a useful view
      // onto anything this space actually stores.
      if (!isFolderSpace(space)) {
        setting.addButton((b) =>
          b
            .setButtonText("Contents…")
            .setTooltip(`See and manage what is in ${space.name}`)
            .onClick(() => {
              new SpaceContentsModal(this.app, this.defs, space.id).open();
            })
        );
      }

      setting.addButton((b) =>
        b
          .setButtonText("Delete")
          .setDestructive()
          .onClick(async () => {
            // This tab is bulk management, and this button
            // sits a couple of clicks right of the rename field. Deletion
            // takes the members, the root, the colour, the order map and
            // the captured layout with it, and nothing at any layer keeps a
            // copy — so it is asked about first. Exactly one confirm, no
            // undo prompt.
            await deleteWithConfirm(
              { name: space.name, memberCount: rows.length, missingCount: missing },
              {
                confirm: (prompt) => new ConfirmModal(this.app, prompt).ask(),
                remove: () => deleteSpace(this.defs, space.id, this.hooks),
                onDeleted: () => this.display(),
                onError: (message) => {
                  new Notice(message);
                },
              }
            );
          })
      );
    }

    // There is deliberately NO "Add space" here. Such a row produces a space
    // named "New space" with no icon, no colour and `members: []` — precisely
    // the empty, unnamed space this plugin is meant not to leave lying around,
    // and a direct route into the dead end where the membership menu is empty
    // in All and there is no obvious way to a first member.
    //
    // What remains on this tab is rename, contents and delete, which
    // genuinely are bulk management: you delete several in a sitting. Adding
    // is not bulk — you add one space and immediately want to name and fill
    // it, which is what `+` and the `Create space` command both do.
  }

  /**
   * Every toggle on this tab writes the same way and reports failure the same
   * way, so the shape lives here once rather than nine times.
   *
   * `rerender` exists for the one setting whose value changes another
   * setting's enabled state; everywhere else redrawing the tab under the
   * user's cursor would be a cost with no benefit.
   */
  private save(fn: (d: SpacesDefinitions) => void, rerender = false): void {
    this.defs
      .mutate(fn)
      .then(() => {
        if (rerender) this.display();
      })
      .catch((e: unknown) => {
        new Notice(`Spaces: could not save setting (${String(e)})`);
      });
  }
}
