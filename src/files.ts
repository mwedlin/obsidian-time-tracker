import { moment, App, MarkdownSectionInformation, ButtonComponent, TextComponent, obsidianApp } from "obsidian";
// import { loadTracker } from "src/tracker";
import { Tracker, loadTracker, isRunning, endRunningEntry } from "./tracker";

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
            endBlock = content.indexOf("\n```", startBlock-1);
            // console.log("Start: " + startBlock + "End: " + endBlock);
            if (endBlock > startBlock) {
                // console.log("Content: " + content.slice(startBlock, endBlock));
                var res: FileSection = {
                    file: files[i],
                    startPos: startBlock,
                    endPos: endBlock,
                    tracker: loadTracker(content.slice(startBlock, endBlock))
                };
                result.push(res);
            };
            nextBlock = content.indexOf("```time-tracker", endBlock+4); // Find start of next block
            // console.log("Next: " + nextBlock)
        };
    };
    return result;
}

// Stop all active counters.
export async function stopAll(): void {
    // console.log("Stopping all timers.")
    var allStopped: Boolean = false;
    while (!allStopped) {
        const sections = await readAll();
        allStopped = true;
        for (let i = 0; i<sections.length; i++) {
            if (isRunning(sections[i].tracker)) {
                // console.log("Stopping " + sections[i].file.path + " at " + sections[i].startPos);
                const content = await this.app.vault.read(sections[i].file);
                // console.log("\n\nStart text:\n" + content)
                endRunningEntry(sections[i].tracker);
                // console.log("\nNew content pre:\n" + content.slice(0, sections[i].startPos) + "\nTracker:\n" + JSON.stringify(sections[i].tracker) + "\nPost:\n" + content.slice(sections[i].endPos));
                if (!content.slice(sections[i].endPos+1, sections[i].endPos+4) == "---") { // File has changed
                    // console.log("File changed: " + content.slice(sections[i].endPos+1, sections[i].endPos+4));
                    allStopped = false;
                    break; // Have to reread all sections to get the positions right again
                };
                const newcontent = content.slice(0, sections[i].startPos) + 
                                   JSON.stringify(sections[i].tracker) +
                                   content.slice(sections[i].endPos);
                await this.app.vault.modify(sections[i].file, newcontent);
                allStopped = false;
                break; // Have to reread all sections to get the positions right again
            } else {
                // console.log(sections[i].file.path + " at " + sections[i].startPos + " is not running.");
            }
        };
    };
}