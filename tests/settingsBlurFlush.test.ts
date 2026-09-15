// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { BlurCommitLedger, type BlurCommittedField } from "../src/ui/settingsEdits";

/**
 * the premise, run rather than asserted from memory: does emptying a
 * container fire `blur` on the focused input inside it?
 *
 * `PluginSettingTab.hide()` empties `containerEl`, and the settings modal
 * closes on Escape while an input still has focus. If removal fired `blur`,
 * the existing blur-only handlers would already be correct and no fix would
 * be needed. Layer 1/3: jsdom implements the HTML standard's focus-fixup
 * (focus falls back to the body, no event), which is the same behaviour
 * Chromium is reported to have — but jsdom is not Chromium, so this pins the
 * standard's behaviour, not the shipped app's. See FIX-REPORT.md.
 */
function focusedInputIn(html: string) {
  document.body.innerHTML = html;
  const host = document.getElementById("host") as HTMLElement;
  const input = document.getElementById("field") as HTMLTextAreaElement;
  const events: string[] = [];
  for (const name of ["blur", "focusout", "change"]) {
    input.addEventListener(name, () => events.push(name));
  }
  input.focus();
  return { host, input, events };
}

describe("what removing a focused element actually does", () => {
  it("fires no blur when the container is emptied under a focused input", () => {
    const { host, input, events } = focusedInputIn(
      `<div id="host"><textarea id="field"></textarea></div>`
    );
    expect(document.activeElement).toBe(input);

    input.value = "Attachments/**";
    host.innerHTML = ""; // what containerEl.empty() does

    expect(events).toEqual([]);
    expect(document.activeElement).toBe(document.body);
  });

  it("does fire blur when focus simply moves away, which is the case that works today", () => {
    const { input, events } = focusedInputIn(
      `<div id="host"><textarea id="field"></textarea></div>`
    );
    input.value = "Attachments/**";
    input.blur();

    expect(events).toContain("blur");
  });
});

describe("hide() flushes what blur never committed", () => {
  /** The two halves of the real tab: a control, and a store it writes to. */
  function tab() {
    const { host, input } = focusedInputIn(
      `<div id="host"><textarea id="field"></textarea></div>`
    );
    const persisted: string[] = [];
    const ledger = new BlurCommitLedger();
    const field: BlurCommittedField = {
      current: () => input.value.trim(),
      write: (v) => persisted.push(v),
    };
    ledger.track(field, "");
    input.addEventListener("blur", () => {
      ledger.commit(field);
    });
    return {
      input,
      persisted,
      /** The override this finding asks for: flush, then let the base empty. */
      hide() {
        ledger.flush();
        host.innerHTML = "";
      },
    };
  }

  it("keeps an edit typed and then abandoned with Escape", () => {
    const t = tab();
    t.input.value = "Attachments/**";
    t.hide();
    expect(t.persisted).toEqual(["Attachments/**"]);
  });

  it("writes once, not twice, when the user tabbed away first", () => {
    const t = tab();
    t.input.value = "Attachments/**";
    t.input.blur();
    t.hide();
    expect(t.persisted).toEqual(["Attachments/**"]);
  });
});
