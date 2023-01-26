import { moment, App, MarkdownSectionInformation, ButtonComponent, TextComponent, obsidianApp } from "obsidian";
import { loadTracker } from "src/tracker";
import { Tracker, loadTracker } from "./tracker";

export interface FileSection {
    file: TFile;
    startPos: Number;
    endPos: Number;
    tracker: Tracker;
}

// Read all time-tracker sections in all files.
export async function readAll(): FileSection[] {
    var result: FileSection[] = [];
    const files :String[]  = this.app.vault.getMarkdownFiles()

    for (let i = 0; i < files.length; i++) {
        // console.log("File: " + files[i].path);
        const content :String = await this.app.vault.cachedRead(files[i])
        var startBlock;
        var endBlock;
        var nextBlock = content.indexOf("```time-tracker");
        while (nextBlock != -1) {
            // console.log("nextBlock: %d", nextBlock)
            startBlock = content.indexOf("\n", nextBlock) + 1;
            endBlock = content.indexOf("\n```", startBlock);
            // console.log("Content: " + content.slice(startBlock, endBlock));
            var res: FileSection = {
                file: files[i],
                startPos: startBlock,
                endPos: endBlock,
                tracker: loadTracker(content.slice(startBlock, endBlock))
            };
            result.push(res);
            nextBlock = content.indexOf("```time-tracker", endBlock+4); // Find start of next block
        };
    };
    return result;
}

// Stop all active counters.
export async function stopAll(): void {
    const sections = readAll();

    console.log("Stopping all timers.")
    for (let i = 0; i<sections.length; i++) {
        if (isRunning(sections[i].tracker)) {
            console.log("Stopping " + sections[i].file.path + " at " + sections[i].startPos);
            const content = await this.app.vault.Read(sections[i].file);
            endRunningEntry(sections[i].tracker);
        }
    }
}