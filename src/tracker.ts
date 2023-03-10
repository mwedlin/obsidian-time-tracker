import { moment, App, MarkdownSectionInformation, ButtonComponent, TextComponent, obsidianApp, MomentFormatComponent } from "obsidian";
import { TimeTrackerSettings } from "./settings";
import { stopAll, readAll, FileSection } from "./files"
import { allTracks, daySum, findProjects } from "./report"
// const nldatesPlugin = obsidianApp.plugins.getPlugin("nldates-obsidian");

export interface Tracker {
    dispType: string; // default, compact, legacy
    currTask: string;
    project: string;
    client: string;
    entries: Entry[];
}

export interface Entry {
    name: string;
    startTime: number;
    endTime: number;
    subEntries: Entry[];
}

export async function saveTracker(tracker: Tracker, app: App, section: MarkdownSectionInformation): Promise<void> {
    let file = app.workspace.getActiveFile();
    if (!file)
        return;
    let content = await app.vault.read(file);

    // figure out what part of the content we have to edit
    let lines = content.split("\n");
    let prev = lines.filter((_, i) => i <= section.lineStart).join("\n");
    let next = lines.filter((_, i) => i >= section.lineEnd).join("\n");
    // edit only the code block content, leave the rest untouched
    content = `${prev}\n${JSON.stringify(tracker)}\n${next}`;

    console.log("Modify file: " + file.path)
    await app.vault.modify(file, content);
}

export function loadTracker(json: string): Tracker {
    if (json) {
        try {
            return JSON.parse(json);
        } catch (e) {
            console.log(`Failed to parse Tracker from ${json}`);
        }
    }
    return { dispType: "default",
             currTask: undefined,
             project: undefined,
             client: undefined,
             entries: [] };
}

export function displayTracker(tracker: Tracker, element: HTMLElement, getSectionInfo: () => MarkdownSectionInformation, settings: TimeTrackerSettings): void {
    // add start/stop controls

    console.log("Startar displayTracker");

    if (tracker.dispType == undefined) {
        tracker.dispType = "default";
    }

    switch (tracker.dispType) {
        case "legacy":
            break;
        case "status":
            displayStatus(tracker, element, getSectionInfo, settings);
            break;
        case "today":
            console.log("Evaluating display type today.")
            displayToday(tracker, element, getSectionInfo, settings);
            break;
        default: // Also "default" and "compact"
            displayTrackerDefault(tracker, element, getSectionInfo, settings);
    }
}

//
// Display default and compact versions.
//
export function displayTrackerDefault(tracker: Tracker, element: HTMLElement, getSectionInfo: () => MarkdownSectionInformation, settings: TimeTrackerSettings): void {
    // add start/stop controls

    let running = isRunning(tracker);

    let tbl = element.createEl("table", { cls: "time-tracker-table" });
    let row1 = tbl.createEl("tr");
 
    // Start/Stop button
    let td1 = row1.createEl("td");
    let btn = new ButtonComponent(td1)
        .setClass("clickable-icon")
        .setIcon(`lucide-${running ? "stop" : "play"}-circle`)
        .setTooltip(running ? "End" : "Start")
        .onClick(async () => {
            if (running) {
                endRunningEntry(tracker);
            } else {
                await stopAll();
                startNewEntry(tracker, newTaskNameBox.getValue(), newProjectNameBox.getValue(), newClientNameBox.getValue());
            }
            await saveTracker(tracker, this.app, getSectionInfo());
        });
    btn.buttonEl.addClass("time-tracker-btn");

    // add timers
    let td2 = row1.createEl("td");
    let timer = td2.createDiv({ cls: "time-tracker-timers" });
    let currentDiv = timer.createEl("div", { cls: "time-tracker-timer" });
    let current = currentDiv.createEl("span", { cls: "time-tracker-timer-time" });
    currentDiv.createEl("span", { text: "Current" });
    let totalDiv = timer.createEl("div", { cls: "time-tracker-timer" });
    let total = totalDiv.createEl("span", { cls: "time-tracker-timer-time", text: "0s" });
    totalDiv.createEl("span", { text: "Total" });

    // Task name
    let td3 = row1.createEl("td");
    let newTaskDiv = td3.createEl("div", {cls: "time-tracker-txt"})
    newTask = newTaskDiv.createEl("span", { cls: "time-tracker-txt" });
    let newTaskNameBox = new TextComponent(newTask)
        .setPlaceholder("Task")
        .setDisabled(running);
    newTaskDiv.createEl("span", { text: "Task" });

        if (tracker.currTask != undefined) {
        newTaskNameBox.setValue(tracker.currTask);
    }
    // newTaskNameBox.inputEl.addClass("time-tracker-txt");

    // Project name
    let td4 = row1.createEl("td");
    let newProjectDiv = td4.createEl("div", {cls: "time-tracker-txt"})
    newProject = newProjectDiv.createEl("span", { cls: "time-tracker-txt" });
    let newProjectNameBox = new TextComponent(newProject)
        .setPlaceholder("Project")
        .setDisabled(running);
    newProjectDiv.createEl("span", { text: "Project" });
    if (tracker.project != undefined) {
        newProjectNameBox.setValue(tracker.project);
    }
    // newProjectNameBox.inputEl.addClass("time-tracker-txt");

    // Client name
    let td5 = row1.createEl("td");
    let newClientDiv = td5.createEl("div", {cls: "time-tracker-txt"})
    newClient = newClientDiv.createEl("span", { cls: "time-tracker-txt" });
    let newClientNameBox = new TextComponent(newClient)
        .setPlaceholder("Client")
        .setDisabled(running);
    newClientDiv.createEl("span", { text: "Client" });

        if (tracker.client != undefined) {
        newClientNameBox.setValue(tracker.client);
    }
    // newClientNameBox.inputEl.addClass("time-tracker-txt");

    if (tracker.entries.length > 0 && tracker.dispType != "compact") {
        // add table
        let table = element.createEl("table", { cls: "time-tracker-table" });
        table.createEl("tr").append(
            createEl("th", { text: "Task" }),
            createEl("th", { text: "Start time" }),
            createEl("th", { text: "End time" }),
            createEl("th", { text: "Duration" }),
            createEl("th"));

        for (let entry of tracker.entries)
            addEditableTableRow(tracker, entry, table, newTaskNameBox, running, getSectionInfo, settings, 0);

        // add copy buttons
        let buttons = element.createEl("div", { cls: "time-tracker-bottom" });
        new ButtonComponent(buttons)
            .setButtonText("Copy as table")
            .onClick(() => navigator.clipboard.writeText(createMarkdownTable(tracker, settings)));
        new ButtonComponent(buttons)
            .setButtonText("Copy as CSV")
            .onClick(() => navigator.clipboard.writeText(createCsv(tracker, settings)));
    }


    setCountdownValues(tracker, current, total, currentDiv);
    let intervalId = window.setInterval(() => {
        // we delete the interval timer when the element is removed
        if (!element.isConnected) {
            window.clearInterval(intervalId);
            return;
        }
        setCountdownValues(tracker, current, total, currentDiv);
    }, 1000);
}

// View a short status of the time tracking system.
export async function displayStatus(tracker: Tracker, element: HTMLElement, getSectionInfo: () => MarkdownSectionInformation, settings: TimeTrackerSettings): void {
    console.log("Display status.");

    // Find first running entry.
    const sections = await readAll();
    var activeSection;

    for (let i = 0; i<sections.length; i++) {
        if (isRunning(sections[i].tracker)) {
            console.log("Found running section in file " + sections[i].file.path + " at " + sections[i].startPos);
            activeSection = sections[i];
            // const content = await this.app.vault.read(sections[i].file);
            break; // Have to reread all sections to get the positions right again
        } else {
            console.log(sections[i].file.path + " at " + sections[i].startPos + " is not running.");
        };
    };

    let tbl = element.createEl("table", { cls: "time-tracker-table" });
    let row1 = tbl.createEl("tr");
    if (activeSection) { // Found an active section.
        let t = "Active timer in note " + activeSection.file.path;
        // Start/Stop button
        let td1 = row1.createEl("td");
        let btn = new ButtonComponent(td1)
            .setClass("clickable-icon")
            .setIcon(`lucide-stop-circle`)
            .setTooltip("Stop all trackers")
            .onClick(async () => {
                await stopAll();
                td1 = createEl("span", {text: "No active trackers running.", color: "green"});
                // await saveTracker(tracker, this.app, getSectionInfo());
            });
        btn.buttonEl.addClass("time-tracker-btn");
        let td2 = row1.createEl("td").createEl("span", {text: t});
    } else {
        let td1 = row1.createEl("td").createEl("span", {text: "No active trackers running.", color: "green"});
    };
}

export async function displayToday(tracker: Tracker, element: HTMLElement, getSectionInfo: () => MarkdownSectionInformation, settings: TimeTrackerSettings): void {
    const format = settings.timestampFormat;

    let startTime = moment().startOf("day").unix(); // First second of today
    let endTime = moment().endOf("day").unix(); // Last second of today
    console.log("Intervall OK: " + startTime +
            "(" + moment.unix(startTime).format(format) + ") -- " +
            endTime + "(" + moment.unix(endTime).format(format) + ")"
            );
    let all = await allTracks(startTime, endTime);
    let proj = await findProjects(all);
    console.log("Projects: ", proj);
    let tbl = element.createEl("table", { cls: "time-tracker-table" });
    tbl.createEl("tr").append(
        createEl("th", { text: "Project" }),
        createEl("th", { text: "Duration (hours)" }));
    // navigator.clipboard.writeText(await createMarkdownTable(startTime, endTime, all));
    let sum: Number = 0;
    for (let i=0; i < proj.length; i++) {
        let ds = daySum(proj[i], moment(), all);
        sum += parseFloat(ds);
        let row1 = tbl.createEl("tr");
        let td1 = row1.createEl("td", { text: proj[i] });
        let td2 = row1.createEl("td", { text:  ds });
    };
    let row1 = tbl.createEl("tr");
    let td1 = row1.createEl("td", { text: "Total:" });
    let td2 = row1.createEl("td", { text:  sum });
};

function startSubEntry(entry: Entry, name: string) {
    // if this entry is not split yet, we add its time as a sub-entry instead
    if (!entry.subEntries) {
        entry.subEntries = [{ ...entry, name: `Part 1` }];
        entry.startTime = null;
        entry.endTime = null;
    }

    if (!name)
        name = `Part ${entry.subEntries.length + 1}`;
    entry.subEntries.push({ name: name, startTime: moment().unix(), endTime: null, subEntries: null });
}

function startNewEntry(tracker: Tracker, name: string, project: string, client: string): void {
    tracker.currTask = name;
    tracker.project = project;
    tracker.client = client;

    if (!name)
        name = `task ${tracker.entries.length + 1}`;
    let entry: Entry = { name: name, startTime: moment().unix(), endTime: null, subEntries: null };
    tracker.entries.push(entry);
};

export function endRunningEntry(tracker: Tracker): void {
    let entry = getRunningEntry(tracker.entries);
    entry.endTime = moment().unix();
}

function removeEntry(entries: Entry[], toRemove: Entry): boolean {
    if (entries.contains(toRemove)) {
        entries.remove(toRemove);
        return true;
    } else {
        for (let entry of entries) {
            if (entry.subEntries && removeEntry(entry.subEntries, toRemove)) {
                // if we only have one sub entry remaining, we can merge back into our main entry
                if (entry.subEntries.length == 1) {
                    let single = entry.subEntries[0];
                    entry.startTime = single.startTime;
                    entry.endTime = single.endTime;
                    entry.subEntries = null;
                }
                return true;
            }
        }
    }
    return false;
}

export function isRunning(tracker: Tracker): boolean {
    if (tracker.entries == undefined) return false;
    return !!getRunningEntry(tracker.entries);
}

function getRunningEntry(entries: Entry[]): Entry {
    for (let entry of entries) {
        // if this entry has sub entries, check if one of them is running
        if (entry.subEntries) {
            let running = getRunningEntry(entry.subEntries);
            if (running)
                return running;
        } else {
            // if this entry has no sub entries and no end time, it's running
            if (!entry.endTime)
                return entry;
        }
    }
    return null;
}

function getDuration(entry: Entry) {
    if (entry.subEntries) {
        return getTotalDuration(entry.subEntries);
    } else {
        let endTime = entry.endTime ? moment.unix(entry.endTime) : moment();
        return endTime.diff(moment.unix(entry.startTime));
    }
}

function getTotalDuration(entries: Entry[]): number {
    let ret = 0;
    for (let entry of entries)
        ret += getDuration(entry);
    return ret;
}

function setCountdownValues(tracker: Tracker, current: HTMLElement, total: HTMLElement, currentDiv: HTMLDivElement) {
    let running = getRunningEntry(tracker.entries);
    if (running && !running.endTime) {
        current.setText(formatDuration(getDuration(running)));
        currentDiv.hidden = false;
    } else {
        currentDiv.hidden = true;
    }
    total.setText(formatDuration(getTotalDuration(tracker.entries)));
}

function formatTimestamp(timestamp: number, settings: TimeTrackerSettings): string {
    return moment.unix(timestamp).format(settings.timestampFormat);
}

function formatDuration(totalTime: number): string {
    let duration = moment.duration(totalTime);
    let ret = "";
	if (duration.years() > 0)
		ret += duration.years() + "y ";
	if (duration.months() > 0)
		ret += duration.months() + "m ";
	if (duration.days() > 0)
		ret += duration.days() + "d ";
    if (duration.hours() > 0)
        ret += duration.hours() + "h ";
    if (duration.minutes() > 0)
        ret += duration.minutes() + "m ";
    ret += duration.seconds() + "s";
    return ret;
}

// Parse a date
export function parseDate(dt: String, format: String): Moment {
    let nldatesPlugin = this.app.plugins.getPlugin('nldates-obsidian'); // Get the Natural Language Dates plugin.    chrono.parse('An appointment on Sep 12-13');
    var res: Moment;

    // console.log("Value to parse: " + dt);

    // console.log("Trying moment with format '" + format + "'")
    res = moment(dt, format, true); // First try strict mode with the format from settings
    // console.log("Result was: " + res.format(format));
    if (!res.isValid()) {  // Strict parsing failed.
        res = nldatesPlugin.parse(dt).moment; // Be more relaxed if possible
        // console.log("Parsed with nldates: " + res);
    };
    return res;
}

function createCsv(tracker: Tracker, settings: TimeTrackerSettings): string {
    let ret = "";
    for (let entry of tracker.entries) {
        for (let row of createTableSection(entry, settings))
            ret += row.join(settings.csvDelimiter) + "\n";
    }
    return ret;
}

function createTableSection(entry: Entry, settings: TimeTrackerSettings): string[][] {
    let ret: string[][] = [[
        entry.name,
        entry.startTime ? formatTimestamp(entry.startTime, settings) : "",
        entry.endTime ? formatTimestamp(entry.endTime, settings) : "",
        entry.endTime || entry.subEntries ? formatDuration(getDuration(entry)) : ""]];
    if (entry.subEntries) {
        for (let sub of entry.subEntries)
            ret.push(...createTableSection(sub, settings));
    }
    return ret;
}

function addEditableTableRow(tracker: Tracker, entry: Entry, table: HTMLTableElement, newTaskNameBox: TextComponent, running: boolean, getSectionInfo: () => MarkdownSectionInformation, settings: TimeTrackerSettings, indent: number) {
    let row = table.createEl("tr");

    let name = row.createEl("td");
    let namePar = name.createEl("span", { text: entry.name });
    namePar.style.marginLeft = `${indent}em`;
    let nameBox = new TextComponent(name).setValue(entry.name);
    nameBox.inputEl.hidden = true;

    // row.createEl("td", { text: entry.startTime ? formatTimestamp(entry.startTime, settings) : "" });
    let startTimeEntry;
    if (entry.startTime) {
        startTimeEntry = formatTimestamp(entry.startTime, settings);
    } else {
        startTimeEntry = "";
    };
    let startTime = row.createEl("td");
    let startPar = startTime.createEl("span", { text: startTimeEntry });
    startPar.style.marginLeft = `${indent}em`;
    let startBox = new TextComponent(startTime).setValue(startTimeEntry);
    startBox.inputEl.hidden = true;


    // row.createEl("td", { text: entry.endTime ? formatTimestamp(entry.endTime, settings) : "" });
    let endTimeEntry;
    if (entry.endTime) {
        endTimeEntry = formatTimestamp(entry.endTime, settings);
    } else {
        endTimeEntry = "";
    }
    let endTime = row.createEl("td");
    let endPar = endTime.createEl("span", { text: endTimeEntry });
    endPar.style.marginLeft = `${indent}em`;
    let endBox = new TextComponent(endTime).setValue(endTimeEntry);
    endBox.inputEl.hidden = true;
    
    row.createEl("td", { text: entry.endTime || entry.subEntries ? formatDuration(getDuration(entry)) : "" });

    let entryButtons = row.createEl("td");
    if (!running) {
        new ButtonComponent(entryButtons)
            .setClass("clickable-icon")
            .setIcon(`lucide-play`)
            .setTooltip("Continue")
            .onClick(async () => {
                await stopAll();
                startSubEntry(entry, newTaskNameBox.getValue());
                await saveTracker(tracker, this.app, getSectionInfo());
            });
    }
    let editButton = new ButtonComponent(entryButtons)
        .setClass("clickable-icon")
        .setTooltip("Edit")
        .setIcon("lucide-pencil")
        .onClick(async () => {
            var format = settings.timestampFormat;
            console.log("Format: " + format)
        
            if (namePar.hidden) {
                namePar.hidden = false;
                startPar.hidden = false;
                endPar.hidden= false;
                nameBox.inputEl.hidden = true;
                startBox.inputEl.hidden = true;
                endBox.inputEl.hidden = true;
                editButton.setIcon("lucide-pencil");
                if (nameBox.getValue()) {
                    entry.name = nameBox.getValue();
                    namePar.setText(entry.name);
                }
                if (startBox.getValue()) {
                    entry.startTime = await parseDate(startBox.getValue(), format).unix();
                }
                if (endBox.getValue()) {
                    entry.endTime = await parseDate(endBox.getValue(), format).unix();
                }
                
                await saveTracker(tracker, this.app, getSectionInfo());
            } else {
                namePar.hidden = true;
                startPar.hidden = true;
                endPar.hidden = true;
                nameBox.inputEl.hidden = false;
                startBox.inputEl.hidden = false;
                endBox.inputEl.hidden = false;
                nameBox.setValue(entry.name);
                startBox.setValue(startTimeEntry);
                endBox.setValue(endTimeEntry);
                editButton.setIcon("lucide-check");
            }
        });
    new ButtonComponent(entryButtons)
        .setClass("clickable-icon")
        .setTooltip("Remove")
        .setIcon("lucide-trash")
        .onClick(async () => {
            removeEntry(tracker.entries, entry);
            await saveTracker(tracker, this.app, getSectionInfo());
        });

    if (entry.subEntries) {
        for (let sub of entry.subEntries)
            addEditableTableRow(tracker, sub, table, newTaskNameBox, running, getSectionInfo, settings, indent + 1);
    }
}
