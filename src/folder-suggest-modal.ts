import { App, FuzzySuggestModal, TFolder } from "obsidian";

// Every folder in the vault, including the root - used to let the template
// kit installer (template-kit-installer.ts) pick where to extract a kit.
export function getAllFolders(app: App): TFolder[] {
    const folders: TFolder[] = [];
    function walk(folder: TFolder): void {
        folders.push(folder);
        for (const child of folder.children)
            if (child instanceof TFolder)
                walk(child);
    }
    walk(app.vault.getRoot());
    return folders;
}

// A fuzzy-searchable folder picker, mirroring FileSuggestModal.
export class FolderSuggestModal extends FuzzySuggestModal<TFolder> {

    private folders: TFolder[];
    private onChoose: (folder: TFolder) => void;

    constructor(app: App, folders: TFolder[], onChoose: (folder: TFolder) => void) {
        super(app);
        this.folders = folders;
        this.onChoose = onChoose;
        this.setPlaceholder("Type to search for a folder...");
        this.emptyStateText = "No matching folders found.";
    }

    getItems(): TFolder[] {
        return this.folders;
    }

    getItemText(folder: TFolder): string {
        return folder.path === "" ? "/ (vault root)" : folder.path;
    }

    onChooseItem(folder: TFolder): void {
        this.onChoose(folder);
    }
}

// Promise wrapper around FolderSuggestModal, mirroring file-suggest-modal.ts's
// pickFile - resolves to the chosen folder, or null if closed without one.
export function pickFolder(app: App): Promise<TFolder | null> {
    return new Promise(resolve => {
        let resolved = false;
        const modal = new FolderSuggestModal(app, getAllFolders(app), folder => {
            resolved = true;
            resolve(folder);
        });
        const onClose = modal.onClose.bind(modal);
        modal.onClose = () => {
            onClose();
            // See pickFile's identical comment - deferred so either firing
            // order between onChooseItem and close() resolves correctly.
            setTimeout(() => { if (!resolved) resolve(null); }, 0);
        };
        modal.open();
    });
}
