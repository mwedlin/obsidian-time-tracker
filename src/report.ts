import { App, Modal, ButtonComponent, TextComponent, MomentFormatComponent } from "obsidian";
import { setUncaughtExceptionCaptureCallback } from "process";
import { TimeTrackerSettingsTab } from "./settings-tab";
import { TimeTrackerSettings } from "./settings";
import { parseDate, Entry } from "./tracker";
import { FileSection, readAll } from "./files";
import * as moment from "moment";

// Return a list of all the projects in 
function findProjects(entries: Entry[]):String[] {
    let str: String[] = [];

    for (i=0; i<entries.length; i++) {
        const found = str.find(element => element == entries[i].name);
        if (!found) str.push(entries[i].name);
    };
    return str.sort();
}

// Return an array of moments for days in the interval
function findDays(start, end): Moment[] {
    
    let r: Moment[] = [];
    console.log("Days: " + moment.unix(start).format("YYYY-MM-DD HH.mm.ss") + "(" + start + ") -> " + moment.unix(end).format("YYYY-MM-DD HH.mm.ss") + " (" + end + ")");
    for (let i = start; i <= end; i += (3600 * 24)) {
        const m = moment.unix(i).startOf("days");
        const nexti: number = i+(3600 * 24);
        console.log("    i: " + i + " (" + m.format("YYYY-MM-DD HH.mm.ss") + "), next: " + nexti)
        r.push(m);
    }
    return r;
}

// Return a string with the number hours worked on a project on a specific day.
// If project is undefined, report a total sum of all projects this day.
// If day = undefined, report time of all days in project.
function daySum(project: String, day: Moment, entries: Entry[]) {
    let sum = 0; // Seconds
    var doAll: Boolean;
    var dayStart: Number;
    var dayEnd: Number;

    if (day == undefined) {
        doAll = true;
    } else {
        doAll = false;
        dayStart = day.unix();
        dayEnd = day.clone().endOf("days").unix();
    };
    for (let i=0; i < entries.length; i++) {
        if (project == undefined || project == entries[i].name) {
            if (doAll) {
                sum += entries[i].endTime - entries[i].startTime;
            } else if (isWithin(entries[i].startTime, entries[i].endTime, dayStart, dayEnd)) {
                let start = entries[i].startTime;
                let end = entries[i].endTime;
                if (start < dayStart) start = dayStart;
                if (end > dayEnd) end = dayEnd;

                sum += end - start;
            }
        }
    }
    return (sum/3600).toLocaleString(undefined, { maximumFractionDigits: 2});
}

// Sum all times for a project.
// function sumProject(project: String, entries: Entry[]) {
//     let sum = 0; // Seconds

//     console.log("Project: ", project);
//     for (let i=0; i < entries.length; i++) {
//         if (project == entries[i].name) {
//                 console.log("    Adding " + moment.unix(entries[i].startTime).format("YYYY-MM-DD") + ": " +
//                 ((entries[i].endTime - entries[i].startTime)/3600).toLocaleString(undefined, { maximumFractionDigits: 2}));
//                 sum += entries[i].endTime - entries[i].startTime;
//         }
//     }
//     return (sum/3600).toLocaleString(undefined, { maximumFractionDigits: 2});
// }

async function createMarkdownTable(start, end, entries: Entry[]): string {
    console.log("Table with " + entries.length + " entries.")
    let days = await findDays(start, end);
    let projects = await await findProjects(entries);

    // let table = [["Project", "Start time", "End time", "Duration"]];
    // for (let entry of entries)
    //    await table.push(...createTableSection(entry));

    let ret = "Project |";
    // calculate the width every column needs to look neat when monospaced
    // let widths = Array.from(Array(4).keys()).map(i => Math.max(...table.map(a => a[i].length)));
    for (let i = 0; i < days.length; i++) { // First row
        ret += days[i].format(" dddd<br>YYYY-MM-DD |");
    };
    ret += " **Total**\n";
    for (let i = 0; i < days.length + 1; i++) { // add separators after first row
        ret += "---|";
    };
    ret += "---\n";
    for (let i = 0; i < projects.length; i++) { // Project sums
        ret += projects[i] + " |";
        for (let j=0; j<days.length; j++) {
            ret += daySum(projects[i], days[j], entries) + " |";
        };
        ret += "**" + daySum(projects[i], undefined, entries) + "**\n";
    };
    ret += "**Total:** |";
    for (i=0; i<days.length; i++) { // Sum up the days.
        // const startTime = days[i].clone().startOf("days").unix();
        // const endTime = days[i].clone().endOf("days").unix();
        ret += "**" + daySum(undefined, days[i], entries) + "** |";
    };
    ret += "**" + daySum(undefined, undefined, entries) + "**\n";

    return ret;
}

async function createListTable(entries: Entry[]): string {
    console.log("Table with " + entries.length + " entries.");

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
                let startTime = startDate.startOf("day").unix(); // First second of date
                let endTime = endDate.endOf("day").unix(); // Last second of date
                console.log("Intervall OK: " + startTime +
                            "(" + moment.unix(startTime).format(format + " HH.mm.ss") + ") -- " +
                            endTime + "(" + moment.unix(endTime).format(format + " HH.mm.ss") + ")"
                            );
                let all = await allTracks(startTime, endTime);
                let days = await findDays(startTime, endTime, all);
                console.log("Projects: ", await findProjects(all));
                console.log("Days: ")
                for (i=0; i<days.length; i++) {
                    console.log("  ", days[i].format("YYYY-MM-DD HH:mm:ss, dddd"));
                }
                navigator.clipboard.writeText(await createMarkdownTable(startTime, endTime, all));
            };
        });
  }

  onClose() {
    let { contentEl } = this;
    contentEl.empty();
  }
}

