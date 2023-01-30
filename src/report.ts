import { App, Modal, ButtonComponent, TextComponent } from "obsidian";
import { setUncaughtExceptionCaptureCallback } from "process";
import { TimeTrackerSettingsTab } from "./settings-tab";
import { TimeTrackerSettings } from "./settings";
import { parseDate, Entry } from "./tracker";
import { FileSection, readAll } from "./files";
import * as moment from "moment";

async function createMarkdownTable(entries: Entry[]): string {
    console.log("Table with " + entries.length + " entries.")
    let table = [["Project", "Start time", "End time", "Duration"]];
    for (let entry of entries)
        await table.push(...createTableSection(entry));

    let ret = "";
    // calculate the width every column needs to look neat when monospaced
    let widths = Array.from(Array(4).keys()).map(i => Math.max(...table.map(a => a[i].length)));
    for (let r = 0; r < table.length; r++) {
        // add separators after first row
        if (r == 1)
            ret += "---|---|---|---\n";

        let row: string[] = [];
        for (let i = 0; i < 4; i++)
            row.push(table[r][i]);
        ret += row.join(" | ") + "\n";
    }
    return ret;
}

function createTableSection(entry: Entry): string[][] {
    let ret: string[][] = [[
        entry.name,
        entry.startTime ? moment.unix(entry.startTime).format("YYYY-MM-DD HH:mm:ss") : "",
        entry.endTime ? moment.unix(entry.endTime).format("YYYY-MM-DD HH:mm:ss") : "",
        ((entry.endTime - entry.startTime)/3600).toLocaleString(undefined, { maximumFractionDigits: 2})
    ]];
   
    return ret;
}

// Return true if tracking time is within the duration.
function isWithin(trStart, trEnd, durStart, durEnd): boolean {
    if (trEnd < durStart) return false; // Before duration
    if (trStart > durEnd) return false; // After duration
    return true;
}

// Construct a name from project and client
function toName(project: String, client: String): String {
    if (project && client) return project + "/" + client;
    if (project) return project;
    if (client) return client;
    return "(no project)";
}

// Make a list of all time entries between the to entries.
async function allTracks(start: number, end: number): Entry[] {
    let ret: Entry = [];
    let allEntries = await readAll();

    console.log("AllTracks with " + allEntries.length + " entries.")
    var i, j, k;
    for (i=0; i<allEntries.length; i++) {
        console.log("Reading file: " + allEntries[i].file.path)
        for (j=0; j<allEntries[i].tracker.entries.length; j++){
            if (allEntries[i].tracker.entries[j].subEntries) { // Loop through subEntries.
                for (k=0; k<allEntries[i].tracker.entries[j].subEntries.length;k++) {
                    if (isWithin(allEntries[i].tracker.entries[j].subEntries[k].startTime,
                        allEntries[i].tracker.entries[j].subEntries[k].endTime,
                        start, end)) {
                        // Add this timestamp
                        let thisStart = allEntries[i].tracker.entries[j].subEntries[k].startTime;
                        let thisEnd = allEntries[i].tracker.entries[j].subEntries[k].endTime;
                        if (thisStart < start) thisStart = start;
                        if (thisEnd > end) thisEnd = end;
                        let name = toName(allEntries[i].tracker.project, allEntries[i].tracker.client);
                        let e:Entry = {name: name, startTime: thisStart,
                                       endTime: thisEnd, subEntries: undefined };
                        ret.push(e);
                        console.log("Subentry from " + allEntries[i].file.path +
                        ": " + name +
                        " " + moment.unix(thisStart).format("YYYY-MM-DD HH:mm:ss") +
                        " -- " + moment.unix(thisEnd).format("YYYY-MM-DD HH:mm:ss"));
                    }
                }
            } else { // No subentries
                if (isWithin(allEntries[i].tracker.entries[j].startTime,
                             allEntries[i].tracker.entries[j].endTime,
                             start, end)) {
                    let thisStart = allEntries[i].tracker.entries[j].startTime;
                    let thisEnd = allEntries[i].tracker.entries[j].endTime;
                    if (thisStart < start) thisStart = start;
                    if (thisEnd > end) thisEnd = end;
                    let name = toName(allEntries[i].tracker.project, allEntries[i].tracker.client);
                    let e:Entry = {name: name, startTime: thisStart,
                                   endTime: thisEnd, subEntries: undefined };
                    ret.push(e);
                    console.log("Entry from " + allEntries[i].file.path +
                    ": " + name +
                    " " + moment.unix(thisStart).format("YYYY-MM-DD HH:mm:ss") +
                    " -- " + moment.unix(thisEnd).format("YYYY-MM-DD HH:mm:ss"));
                }
            }
        }
    }
    return ret;
}
// Return a project time list in clipboard
export class ReportModal extends Modal {
  constructor(app: App) {
    super(app);
  }

  onOpen() {
    const settings = app.settings;
    console.log("app: " + Object.keys(app));
    
    const { contentEl } = this;
    let hdr = contentEl.createEl("H2").setText("Report as table")
    let tbl = contentEl.createEl("table", { cls: "time-tracker-table" });
    let row1 = tbl.createEl("tr");
 
    // Start time
    let td1 = row1.createEl("td");
    let newStartDiv = td1.createEl("div", {cls: "time-tracker-txt"})
    let newStart = newStartDiv.createEl("span", { cls: "time-tracker-txt" });
    let newStartNameBox = new TextComponent(newStart)
        .setPlaceholder("From time");
    newStartDiv.createEl("span", { text: "From" });

    // End time
    let td2 = row1.createEl("td");
    let newEndDiv = td2.createEl("div", {cls: "time-tracker-txt"})
    let newEnd = newEndDiv.createEl("span", { cls: "time-tracker-txt" });
    let newEndNameBox = new TextComponent(newEnd)
        .setPlaceholder("To time");
    newEndDiv.createEl("span", { text: "To" });

    // add Calculate buttons
    let buttons = contentEl.createEl("div", { cls: "time-tracker-bottom" });

    new ButtonComponent(buttons)
        .setButtonText("Check dates")
        .onClick(() => {
            var format = "YYYY-MM-DD"

            let startDate = parseDate(newStartNameBox.getValue(), format);
            let endDate = parseDate(newEndNameBox.getValue(), format);
            if (startDate.isValid()) {
                console.log("Start OK: " + startDate.format("YYYY-MM-DD"));
                newStartNameBox.setValue(startDate.format("YYYY-MM-DD"));
            };
            if (endDate.isValid()) {
                console.log("End OK: " + endDate.format("YYYY-MM-DD"));
                newEndNameBox.setValue(endDate.format("YYYY-MM-DD"));
            };
            navigator.clipboard.writeText("Copied text");
        });

        new ButtonComponent(buttons)
        .setButtonText("Append table at cursor")
        .onClick(async () => {
            var format = "YYYY-MM-DD"

            let startDate = parseDate(newStartNameBox.getValue(), format);
            let endDate = parseDate(newEndNameBox.getValue(), format);
            if (startDate.isValid() && endDate.isValid()) {
                let startTime = startDate.unix(); // First second of date
                let endTime = endDate.unix() + (3600 * 24) - 1; // Last second of date
                console.log("Intervall OK: " + startTime +
                            "(" + moment.unix(startTime).format("L LTS") + ") -- " +
                            endTime + "(" + moment.unix(endTime).format("L LTS") + ")"
                            );
                let all = await allTracks(startTime, endTime);
                navigator.clipboard.writeText(await createMarkdownTable(all));
            };
            
        });
  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}

