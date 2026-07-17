import { App, Modal, ButtonComponent, Notice, TFolder, TFile } from "obsidian";
import JSZip from "jszip";
import { pickFolder } from "./folder-suggest-modal";
import { sanitizeRelativePath } from "./zip-path-safety";

// Creates any missing folders along `path`, one level at a time - Obsidian's
// vault.createFolder throws if a folder already exists, so each level is
// checked first rather than assumed missing.
async function ensureFolder(app: App, path: string): Promise<void> {
    if (!path)
        return;
    if (app.vault.getAbstractFileByPath(path) instanceof TFolder)
        return;

    const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (parent)
        await ensureFolder(app, parent);

    try {
        await app.vault.createFolder(path);
    } catch (e) {
        // Lost a race with something else creating the same folder, or it
        // exists as something other than a folder - re-check rather than
        // assuming our own attempt was the cause of the failure.
        if (!(app.vault.getAbstractFileByPath(path) instanceof TFolder))
            throw e;
    }
}

// A minimal, purpose-built two-button prompt ("Overwrite" / "Skip existing")
// for the one conflict-resolution decision this feature needs - not reusing
// ConfirmModal (Cancel/Remove, styled for destructive single actions) since
// neither of its two outcomes maps cleanly onto "install only the new files".
// Resolves *before* calling close() (unlike the button in ConfirmModal, whose
// close()-then-callback order isn't safe to rely on from the outside) so the
// onClose fallback below - for Escape/click-outside - can't race with it:
// resolve() is a no-op on any call after the first.
function confirmOverwrite(app: App, existingCount: number): Promise<boolean> {
    return new Promise(resolve => {
        const modal = new Modal(app);
        modal.contentEl.createEl("p", {
            text: `${existingCount} file(s) already exist at the destination. Overwrite them, or ` +
                `install only the files that don't exist yet?`,
        });
        const buttons = modal.contentEl.createDiv({ cls: "time-tracker-bottom" });
        new ButtonComponent(buttons)
            .setButtonText("Skip existing")
            .onClick(() => { resolve(false); modal.close(); });
        new ButtonComponent(buttons)
            .setButtonText("Overwrite")
            .setWarning()
            .onClick(() => { resolve(true); modal.close(); });

        const onClose = modal.onClose.bind(modal);
        modal.onClose = () => { onClose(); resolve(false); };
        modal.open();
    });
}

// Lets the user install a "template kit" - a .zip of one or more Templater
// template files, possibly nested in folders - into a chosen vault folder.
// Whatever structure the zip has is preserved underneath the target folder:
// loose files at the zip's root land flat, a folder inside the zip becomes a
// subfolder, and so on - the kit's own author decides that shape by how they
// built the zip, not this installer. See design.md's "Template kit installer"
// section.
export class InstallTemplateKitModal extends Modal {

    private zip: JSZip | null = null;
    private targetFolder: TFolder;
    private statusEl: HTMLElement;
    private targetEl: HTMLElement;
    private installButton: ButtonComponent;

    constructor(app: App) {
        super(app);
        this.targetFolder = app.vault.getRoot();
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Install template kit" });
        contentEl.createEl("p", {
            text: "Pick a template kit .zip - its files are extracted into the vault folder you " +
                "choose below, preserving whatever folder structure is inside the zip. Files that " +
                "would already exist at the destination are never silently overwritten.",
        });

        const dropZone = contentEl.createDiv({ cls: "time-tracker-kit-dropzone" });
        dropZone.setText("Drop a .zip here, or click to browse");
        const fileInput = contentEl.createEl("input", { type: "file", attr: { accept: ".zip" } });
        fileInput.style.display = "none";

        dropZone.addEventListener("click", () => fileInput.click());
        dropZone.addEventListener("dragover", e => {
            e.preventDefault();
            dropZone.addClass("time-tracker-kit-dropzone-active");
        });
        dropZone.addEventListener("dragleave", () => dropZone.removeClass("time-tracker-kit-dropzone-active"));
        dropZone.addEventListener("drop", async e => {
            e.preventDefault();
            dropZone.removeClass("time-tracker-kit-dropzone-active");
            const file = e.dataTransfer?.files?.[0];
            if (file)
                await this.loadZip(file);
        });
        fileInput.addEventListener("change", async () => {
            const file = fileInput.files?.[0];
            if (file)
                await this.loadZip(file);
        });

        this.statusEl = contentEl.createEl("p", { text: "No kit selected yet." });

        const targetRow = contentEl.createDiv({ cls: "time-tracker-bottom" });
        this.targetEl = targetRow.createSpan({ text: `Install into: ${this.folderLabel(this.targetFolder)}` });
        new ButtonComponent(targetRow)
            .setButtonText("Choose folder")
            .onClick(async () => {
                const folder = await pickFolder(this.app);
                if (folder) {
                    this.targetFolder = folder;
                    this.targetEl.setText(`Install into: ${this.folderLabel(folder)}`);
                }
            });

        const buttons = contentEl.createDiv({ cls: "time-tracker-bottom" });
        this.installButton = new ButtonComponent(buttons)
            .setButtonText("Install")
            .setCta()
            .setDisabled(true)
            .onClick(() => this.install());
    }

    onClose(): void {
        this.contentEl.empty();
    }

    private folderLabel(folder: TFolder): string {
        return folder.path === "" ? "/ (vault root)" : folder.path;
    }

    private async loadZip(file: File): Promise<void> {
        try {
            const bytes = await file.arrayBuffer();
            this.zip = await JSZip.loadAsync(bytes);
            let fileCount = 0;
            this.zip.forEach((_path, entry) => { if (!entry.dir) fileCount++; });
            this.statusEl.setText(`"${file.name}": ${fileCount} file(s) found.`);
        } catch (e) {
            this.zip = null;
            this.statusEl.setText(`Couldn't read "${file.name}" as a zip file.`);
            console.error("Time Tracker: failed to read template kit zip", e);
        }
        this.installButton.setDisabled(!this.zip);
    }

    private async install(): Promise<void> {
        if (!this.zip)
            return;
        const zip = this.zip;
        const targetBase = this.targetFolder.path;

        const entries: { path: string; obj: JSZip.JSZipObject }[] = [];
        let unsafeCount = 0;
        zip.forEach((_path, obj) => {
            if (obj.dir)
                return;
            const safe = sanitizeRelativePath(obj.name);
            if (safe === null) {
                unsafeCount++;
                return;
            }
            entries.push({ path: targetBase ? `${targetBase}/${safe}` : safe, obj });
        });

        if (unsafeCount > 0)
            console.warn(`Time Tracker: template kit install skipped ${unsafeCount} unsafe zip entr${unsafeCount === 1 ? "y" : "ies"} (would have escaped the target folder).`);

        if (entries.length === 0) {
            new Notice("Time Tracker: no files to install - the kit was empty, or every entry was unsafe.");
            return;
        }

        const existing = entries.filter(e => this.app.vault.getAbstractFileByPath(e.path) !== null);
        const overwrite = existing.length > 0 ? await confirmOverwrite(this.app, existing.length) : false;

        let installed = 0, skipped = 0;
        for (const { path, obj } of entries) {
            const existingFile = this.app.vault.getAbstractFileByPath(path);
            if (existingFile && !overwrite) {
                skipped++;
                continue;
            }
            const content = await obj.async("string");
            const parent = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
            await ensureFolder(this.app, parent);
            if (existingFile instanceof TFile)
                await this.app.vault.modify(existingFile, content);
            else
                await this.app.vault.create(path, content);
            installed++;
        }

        this.close();
        new Notice(
            `Time Tracker: installed ${installed} file(s) into "${this.folderLabel(this.targetFolder)}"` +
            (skipped ? `, skipped ${skipped} existing file(s)` : "") +
            (unsafeCount ? `, blocked ${unsafeCount} unsafe entr${unsafeCount === 1 ? "y" : "ies"}` : "") +
            "."
        );
    }
}
