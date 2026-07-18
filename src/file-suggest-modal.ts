import { App, FuzzySuggestModal, TAbstractFile, TFile, TFolder } from "obsidian";

// A fuzzy-searchable file picker over an explicit list of candidates - used
// both by the Templater path settings (browsing the whole vault) and, when a
// configured template path is a folder rather than a single file, by
// pickFile below (browsing just that folder's template files).
export class FileSuggestModal extends FuzzySuggestModal<TFile> {

    private files: TFile[];
    private onChoose: (file: TFile) => void;

    constructor(app: App, files: TFile[], onChoose: (file: TFile) => void) {
        super(app);
        this.files = files;
        this.onChoose = onChoose;
        this.setPlaceholder("Type to search for a template file...");
        this.emptyStateText = "No matching files found.";
    }

    getItems(): TFile[] {
        return this.files;
    }

    getItemText(file: TFile): string {
        return file.path;
    }

    onChooseItem(file: TFile): void {
        this.onChoose(file);
    }
}

// A fuzzy-searchable picker over a mix of files and folders - used by the
// Templater path settings' "Browse" button, since a path setting can be
// pointed at either a single template file or a folder of them (see
// pickFile below and design.md's Templater integration section).
export class PathSuggestModal extends FuzzySuggestModal<TAbstractFile> {

    private items: TAbstractFile[];
    private onChoose: (item: TAbstractFile) => void;

    constructor(app: App, items: TAbstractFile[], onChoose: (item: TAbstractFile) => void) {
        super(app);
        this.items = items;
        this.onChoose = onChoose;
        this.setPlaceholder("Type to search for a template file or folder...");
        this.emptyStateText = "No matching files or folders found.";
    }

    getItems(): TAbstractFile[] {
        return this.items;
    }

    getItemText(item: TAbstractFile): string {
        // A trailing "/" marks a folder in the list, distinguishing it from
        // a same-named file at a glance.
        return item instanceof TFolder ? `${item.path}/` : item.path;
    }

    onChooseItem(item: TAbstractFile): void {
        this.onChoose(item);
    }
}

// All markdown files under a folder, recursing into subfolders - used to
// list the candidates when a Templater path setting points at a folder of
// templates rather than a single file.
export function getMarkdownFilesInFolder(folder: TFolder): TFile[] {
    const files: TFile[] = [];
    for (const child of folder.children) {
        if (child instanceof TFile && child.extension === "md")
            files.push(child);
        else if (child instanceof TFolder)
            files.push(...getMarkdownFilesInFolder(child));
    }
    return files;
}

// Promise wrapper around FileSuggestModal so callers can just `await` the
// user's choice - resolves to the chosen file, or null if the modal was
// closed without choosing one (Escape, clicking outside, ...).
export function pickFile(app: App, files: TFile[]): Promise<TFile | null> {
    return new Promise(resolve => {
        let resolved = false;
        const modal = new FileSuggestModal(app, files, file => {
            resolved = true;
            resolve(file);
        });
        const onClose = modal.onClose.bind(modal);
        modal.onClose = () => {
            onClose();
            // Deferred rather than checked synchronously here: Obsidian's own
            // SuggestModal calls onChooseItem and close() as part of the same
            // selection, and this file doesn't control - or rely on - which
            // one it fires first. A macrotask delay lets either ordering
            // settle `resolved` before this runs, so a real selection can't
            // be misread as a cancel.
            setTimeout(() => { if (!resolved) resolve(null); }, 0);
        };
        modal.open();
    });
}
