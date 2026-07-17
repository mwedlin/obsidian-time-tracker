import { App, TFile } from "obsidian";
import { Tracker } from "./types";
import { loadTracker, isRunning, endRunningEntry } from "./model";

export interface FileSection {
    file: TFile;
    lineStart: number; // line of the opening ```time-tracker fence
    lineEnd: number;   // line of the closing ``` fence
    tracker: Tracker;
}

// Read all time-tracker sections in all files, using Obsidian's own parsed
// metadata (rather than scanning file text for the fence marker) so a
// ```time-tracker string appearing outside an actual code block can't be
// mistaken for one.
export async function readAll(app: App): Promise<FileSection[]> {
    const result: FileSection[] = [];

    for (const file of app.vault.getMarkdownFiles()) {
        const cache = app.metadataCache.getFileCache(file);
        if (!cache?.sections)
            continue;

        const content = await app.vault.cachedRead(file);
        const lines = content.split("\n");

        for (const section of cache.sections) {
            if (section.type !== "code")
                continue;

            const lineStart = section.position.start.line;
            const lineEnd = section.position.end.line;
            if (lines[lineStart].trim() !== "```time-tracker")
                continue;

            const json = lines.slice(lineStart + 1, lineEnd).join("\n");
            result.push({
                file,
                lineStart,
                lineEnd,
                tracker: loadTracker(json),
            });
        }
    }
    return result;
}

// Stop all active counters, vault-wide.
export async function stopAll(app: App): Promise<void> {
    let allStopped = false;
    while (!allStopped) {
        const sections = await readAll(app);
        allStopped = true;
        for (const section of sections) {
            if (isRunning(section.tracker)) {
                endRunningEntry(section.tracker);

                const content = await app.vault.read(section.file);
                const lines = content.split("\n");
                const newLines = [
                    ...lines.slice(0, section.lineStart + 1),
                    JSON.stringify(section.tracker),
                    ...lines.slice(section.lineEnd),
                ];
                await app.vault.modify(section.file, newLines.join("\n"));

                allStopped = false;
                break; // file content changed under us; re-scan from scratch
            }
        }
    }
}
