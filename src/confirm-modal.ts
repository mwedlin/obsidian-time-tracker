import { App, Modal, ButtonComponent } from "obsidian";

// A small reusable "are you sure?" dialog, so destructive actions (like
// removing a recorded entry) aren't a single accidental click away.
export class ConfirmModal extends Modal {

    constructor(app: App, message: string, onConfirm: () => void) {
        super(app);
        this.contentEl.createEl("p", { text: message });

        const buttons = this.contentEl.createDiv({ cls: "time-tracker-bottom" });
        new ButtonComponent(buttons)
            .setButtonText("Cancel")
            .onClick(() => this.close());
        new ButtonComponent(buttons)
            .setButtonText("Remove")
            .setWarning()
            .onClick(() => {
                this.close();
                onConfirm();
            });
    }
}
