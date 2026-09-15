import { Modal, Setting, type App } from "obsidian";
import type { ConfirmPrompt } from "./settingsEdits";

/**
 * A yes/no gate in front of a destructive action.
 *
 * `Modal` is public API, so no quarantine question arises. The
 * class is deliberately thin — the wording and the confirm/cancel outcome
 * live in `settingsEdits.ts`, which tests in plain node; all that is here is
 * the part that needs a real Obsidian modal.
 */
export class ConfirmModal extends Modal {
  private answered = false;
  private settle: ((confirmed: boolean) => void) | null = null;

  constructor(app: App, private prompt: ConfirmPrompt) {
    super(app);
  }

  /** Opens the modal and resolves once the user has answered, or dismissed. */
  ask(): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      this.settle = resolve;
      this.open();
    });
  }

  private answer(confirmed: boolean): void {
    if (this.answered) return;
    this.answered = true;
    this.settle?.(confirmed);
  }

  override onOpen(): void {
    this.titleEl.setText(this.prompt.title);
    this.contentEl.createEl("p", { text: this.prompt.body });

    let cancelEl: HTMLElement | null = null;
    new Setting(this.contentEl)
      .addButton((b) => {
        cancelEl = b.buttonEl;
        return b
          .setButtonText("Cancel")
          .setCta()
          .onClick(() => {
            this.close();
          });
      })
      .addButton((b) =>
        b
          .setButtonText(this.prompt.confirmLabel)
          .setWarning()
          .onClick(() => {
            this.answer(true);
            this.close();
          })
      );

    // Cancel takes the focus, so the Enter that dismisses a modal reflexively
    // cannot be the thing that deletes the space. Confirming is still one
    // click — that is the whole interaction budget allowed. Taken from the
    // component rather than looked up, so no selector string lives outside
    // `src/explorer/selectors.ts`.
    (cancelEl as HTMLElement | null)?.focus();
  }

  override onClose(): void {
    // Escape, the X, and a click outside all land here without an answer;
    // every one of them means "no".
    this.answer(false);
    this.contentEl.empty();
  }
}
