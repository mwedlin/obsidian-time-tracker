import { App, FuzzySuggestModal, TFile, TFolder } from "obsidian";

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
