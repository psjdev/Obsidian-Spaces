# Changelog

## 0.1.1 — 2026-09-15

Drops the "Arc-style spaces:" prefix from the plugin's description, so the
directory listing leads with what it does rather than what it resembles. The
same text now sits in `package.json`, which had drifted to its own wording.

No behaviour change.

## 0.1.0 — 2026-09-15

The first public release. Everything below it predates publication: those
sections are the development record, not shipped versions.

Two new features — folder spaces and a rebuilt create-space panel — plus two review-driven
fix waves, closing out a Critical finding, all five Highs, and a set of Medium reliability
and release-engineering gaps found in a full adversarial review.

### Renamed

- **The plugin is now called Spaces.** It was Spacejam; the name it ships under, the folder
  it installs into and the commands it registers all use `spaces` now. Your spaces, their
  members and your settings are unaffected — those live in the plugin's own folder and move
  with it. The active space and each space's saved tabs are read back from where the old
  name stored them, once, so switching builds does not drop you into *All* with your tab
  layouts gone.

### Features

- **A space can now be a window onto a single folder.** Until now a space was a list of
  notes and folders you picked by hand. A *folder space* is instead pinned to one folder:
  its contents appear at the top level of the explorer, the folder itself is hidden, and
  anything you add to that folder shows up in the space without you doing anything. Notes
  created inside the space land in that folder. Right-click any folder in the file tree and
  choose **Create space from this folder** to make one in a click. Which kind a space is
  gets fixed when you create it.
- **The create-space panel has been rebuilt.** The icon now sits beside the name as a
  dashed placeholder you click to choose from; colour moved to a **Choose a theme** button
  whose brush shows the colour you picked. Two buttons, **Curate Items** and **Pin to
  Folder**, open a searchable tree of the vault in the panel itself — every file and folder,
  filtered as you type — so picking what goes in a space no longer means a separate dialog.
  Both are optional: a space with a name and nothing else is a valid empty space.
- **New spaces can be left uncoloured.** Spaces gives each new space the next colour in
  its palette, so consecutive spaces are easy to tell apart. If you would rather pick
  colours yourself — or have your spaces look like the rest of Obsidian's sidebar — the new
  **Assign a colour to new spaces** setting under Appearance turns that off, and new spaces
  start neutral instead. Spaces you have already made keep their colours either way.
- **New notes and folders land in a folder space's folder.** Creating something while you
  are in a folder space now puts it inside that space's folder, instead of wherever your
  "Default location for new notes" points. This covers every way of creating a file —
  Ctrl+N, the ribbon, the file explorer's own New note and New folder buttons,
  right-clicking the empty space below the file list, and following a link to a note that
  does not exist yet. Right-clicking a folder still creates inside that folder, as before. In *All* or a curated space nothing
  changes, and if the space's folder has been deleted you get a notice and your usual
  default instead.
- **A pinned space can show a pin.** A new setting, **Mark a pinned space with a pin**,
  adds a small pin to the right of the space name row for any space pinned to a folder;
  hover it to see which folder, and whether that folder has gone missing. Off by default,
  and it needs the space name row turned on, since that is where it sits.
- **A refused Create now says why.** The button used to grey out, leaving you to work out
  which control it was waiting on. It always submits now; if something is missing, the
  control turns red and Obsidian tells you what it needs.

### Reliability

- **Your space definitions are now protected against a corrupt `data.json`.** Previously, an
  unreadable or rejected file was silently replaced with defaults the moment you did anything
  else — hand-editing a colour or a member path wrong, an interrupted sync, or a stray schema
  mismatch could erase every space with no warning beyond a single Notice. Writes are now
  guarded so a document spaces could not understand is never overwritten.
- **The settings tab no longer loses an edit when closed with Escape.** The Ignored-paths field
  and the per-space rename field only committed on `blur`, and closing the settings modal with
  Escape removes focus without firing one. Both now flush pending edits when the pane closes, so
  a value you typed and dismissed with Escape is no longer silently discarded.

### Performance

- **The file tree is dramatically faster on large vaults.** Activating a space used to answer
  every "what are this folder's children/descendants" question with a full linear scan of the
  vault, which could take seconds on a vault with thousands of notes. The vault index is now
  structured so these lookups don't re-scan everything, cutting snapshot time by two to three
  orders of magnitude on large vaults.
- **Bulk vault changes no longer stall the UI.** Creating, deleting, or renaming many files at
  once (a large paste, a git checkout touching many notes) used to re-run a full re-index, a full
  visibility snapshot, and a forced explorer re-sort for *every single event*. Vault events are
  now coalesced into a single pass per burst, so bulk operations no longer freeze the explorer.

## 0.9.0 — 2026-09-03

**Not a release.** Pre-1.0: the feature set below works and is verified against Obsidian
1.13.7, but more work was wanted before a release candidate. A 1.0.0 tag was briefly
created at this point and withdrawn.

### Spaces as a lens

- **Tree filtering.** A space shows its member folders and notes plus the parent folders
  needed to reach them. Non-member parents render as dimmed *scaffolding* — de-emphasis
  applies to the row itself, never cascading to its children, so a member inside a
  scaffold folder still reads as a member.
- **The switcher strip** at the bottom of the file explorer, with **All** for the
  unfiltered vault.
- **Membership actions** in the row context menu, and space-scoped note and folder
  creation.
- **Ignored paths** as globs, hidden from every space.
- Ownership and membership stay separate: a note has one real vault path and belongs to
  zero or more spaces. Nothing here moves, renames, or deletes a file.

### Per-space tab layouts

- Each space keeps its own tab and sidebar layout, restored on entry.
- A space with no stored layout **adopts** the layout you already have, so entering a new
  space never disrupts what you were doing.
- If a restore produces an unusable workspace, the previous layout is re-applied; if that
  also fails, spaces fails open rather than leaving you stranded.
- Restoration can be turned off, and **turning it off does not change which rows are
  visible** — layout and visibility are independent (invariant I8).

### Visitors

- Open a note that is not a member of the active space and it appears dimmed and italic
  rather than staying hidden, so a link never leads nowhere.
- The revealed set is spaces's own state, independent of layout restoration. A file you
  deliberately opened survives a space switch that closes its tab; a file that was only
  open because a restore put it there does not.
- Can be turned off entirely.

### Inline space creation

- A **`+`** pinned to the right of the switcher strip turns the explorer pane into a
  creation form: name, preset icon, colour swatch, and a folder autocomplete building a
  chip list.
- The new space is **seeded with the folders you chose**, so you land in a populated tree
  instead of an empty one. This closes the discoverability dead end where a new space had
  no reachable route to its first member.
- The form covers the whole pane and makes everything behind it non-interactive while it
  is open, unwinding cleanly on every exit path.
- Also available as the **Create space** command, replacing a `window.prompt`.

### Reliability

- If the explorer's DOM is not recognised, filtering stops and says so, leaving a complete
  tree (invariant I7).
- Disabling the plugin removes every trace: no leftover classes, no leftover attributes,
  and scroll position and folder expansion intact (invariant I4).
- Renames and deletions repair member paths; a corrupt `data.json` never causes stored
  layouts to be deleted.
- Private Obsidian API is confined to two adapter modules; all detection failures collapse
  to "unknown", which counts as not-disabled.

### Known limitations

- A visitor row has no "pin to space" action yet; use the context menu.
- Settings' "Add space" still creates an empty space, deliberately — the `+` is the
  populated path.
- The creation form's vertical layout does not yet match its Arc reference.
- Per-space custom row ordering is specified (§20) but not implemented; planned for 1.1.0.
- Desktop and main window only. Pop-out windows are not filtered.

### Verification

213 automated tests across three layers, plus an in-app pass driven through the Obsidian
CLI against the real application. Facts that cannot be established below the real app were
measured there: the creation panel does not
trip the explorer's health check while open, the `+` survives an overflowing switcher
strip, focus cannot reach the covered tree, and disabling mid-creation leaves a clean tree.

The testing model, including why a passing test is not automatically evidence, is spec
§10.5–10.8.
