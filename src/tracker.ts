import { moment, App, MarkdownSectionInformation, ButtonComponent, TextComponent } from "obsidian";
import { TimeTrackerSettings } from "./settings";
import { Tracker, Entry } from "./types";
import {
    loadTracker, isRunning, getRunningEntry, getDuration, getTotalDuration,
    startNewEntry, startSubEntry, endRunningEntry, removeEntry,
    formatTimestamp, formatDuration, createTrackerTable, createCsv,
} from "./model";
import { stopAll, readAll } from "./files";
import { allTracks } from "./report";
import { findProjects, daySum, daySumSeconds } from "./report-logic";
import { parseDate } from "./dateutil";
import { ConfirmModal } from "./confirm-modal";
import { onTick } from "./ticker";

export { loadTracker };

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

    await app.vault.modify(file, content);
}

export function displayTracker(tracker: Tracker, element: HTMLElement, getSectionInfo: () => MarkdownSectionInformation, settings: TimeTrackerSettings, app: App): void {
    if (tracker.dispType == undefined) {
        tracker.dispType = "default";
    }

    switch (tracker.dispType) {
        case "status":
            displayStatus(tracker, element, getSectionInfo, settings, app);
            break;
        case "today":
            displayToday(tracker, element, getSectionInfo, settings, app);
            break;
        default: // "default" and "compact"
            displayTrackerDefault(tracker, element, getSectionInfo, settings, app);
    }
}

//
// Display default and compact versions.
//
export function displayTrackerDefault(tracker: Tracker, element: HTMLElement, getSectionInfo: () => MarkdownSectionInformation, settings: TimeTrackerSettings, app: App): void {
    // add start/stop controls

    let running = isRunning(tracker);

    let tbl = element.createEl("table", { cls: "time-tracker-table" });
    let row1 = tbl.createEl("tr");

    // Task name
    let td3 = row1.createEl("td");
    let newTaskDiv = td3.createEl("div", { cls: "time-tracker-txt" });
    let newTask = newTaskDiv.createEl("span", { cls: "time-tracker-txt" });
    let newTaskNameBox = new TextComponent(newTask)
        .setPlaceholder("Task")
        .setDisabled(running);
    newTaskDiv.createEl("span", { text: "Task" });
    if (tracker.currTask != undefined) {
        newTaskNameBox.setValue(tracker.currTask);
    }

    // Project name
    let td4 = row1.createEl("td");
    let newProjectDiv = td4.createEl("div", { cls: "time-tracker-txt" });
    let newProject = newProjectDiv.createEl("span", { cls: "time-tracker-txt" });
    let newProjectNameBox = new TextComponent(newProject)
        .setPlaceholder("Project")
        .setDisabled(running);
    newProjectDiv.createEl("span", { text: "Project" });
    if (tracker.project != undefined) {
        newProjectNameBox.setValue(tracker.project);
    }

    // Client name
    let td5 = row1.createEl("td");
    let newClientDiv = td5.createEl("div", { cls: "time-tracker-txt" });
    let newClient = newClientDiv.createEl("span", { cls: "time-tracker-txt" });
    let newClientNameBox = new TextComponent(newClient)
        .setPlaceholder("Client")
        .setDisabled(running);
    newClientDiv.createEl("span", { text: "Client" });
    if (tracker.client != undefined) {
        newClientNameBox.setValue(tracker.client);
    }

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
                await stopAll(app);
                startNewEntry(tracker, newTaskNameBox.getValue(), newProjectNameBox.getValue(), newClientNameBox.getValue());
            }
            await saveTracker(tracker, app, getSectionInfo());
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
            addEditableTableRow(tracker, entry, table, newTaskNameBox, running, getSectionInfo, settings, app, 0);

        // add copy buttons
        let buttons = element.createEl("div", { cls: "time-tracker-bottom" });
        new ButtonComponent(buttons)
            .setButtonText("Copy as table")
            .onClick(() => navigator.clipboard.writeText(createTrackerTable(tracker, settings)));
        new ButtonComponent(buttons)
            .setButtonText("Copy as CSV")
            .onClick(() => navigator.clipboard.writeText(createCsv(tracker, settings)));
    }

    setCountdownValues(tracker, current, total, currentDiv);
    onTick(element, () => setCountdownValues(tracker, current, total, currentDiv));
}

// View a short status of the time tracking system.
export async function displayStatus(tracker: Tracker, element: HTMLElement, getSectionInfo: () => MarkdownSectionInformation, settings: TimeTrackerSettings, app: App): Promise<void> {
    let tbl = element.createEl("table", { cls: "time-tracker-table" });
    let row1 = tbl.createEl("tr");

    // Re-checked on every tick (not just re-rendered once at load) so that
    // stopping/starting a timer elsewhere - another pane, or the "Stop all
    // timers" command - is picked up without having to reload the note. The
    // row is only rebuilt on an actual running/not-running (or active-file)
    // transition; otherwise just the live timer text is updated in place.
    let hasRendered = false;
    let renderedFilePath: string = undefined;
    let updateToday: (() => void) | null = null;

    async function refresh(): Promise<void> {
        const sections = await readAll(app);
        const activeSection = sections.find(s => isRunning(s.tracker));
        const activeFilePath = activeSection ? activeSection.file.path : undefined;

        if (hasRendered && activeFilePath === renderedFilePath) {
            updateToday?.();
            return;
        }
        hasRendered = true;
        renderedFilePath = activeFilePath;
        updateToday = null;
        row1.empty();

        if (!activeSection) {
            row1.createEl("td").createEl("span", { text: "No active trackers running." });
            return;
        }

        const runningEntry = getRunningEntry(activeSection.tracker.entries);

        // Seconds already logged today across ALL projects, excluding the
        // still-running entry (which has no endTime yet); its own elapsed
        // time is added live below, the same way the default view's timers work.
        const todayStart = moment().startOf("day").unix();
        const todayEnd = moment().endOf("day").unix();
        const allToday = await allTracks(app, todayStart, todayEnd);
        const loggedSecondsToday = daySumSeconds(undefined, moment(), allToday);

        let td1 = row1.createEl("td");
        row1.createEl("td").createEl("span", { text: "Active timer in note " + activeSection.file.path });

        let td2 = row1.createEl("td");
        let timer = td2.createDiv({ cls: "time-tracker-timers" });
        let todayDiv = timer.createEl("div", { cls: "time-tracker-timer" });
        let todayTime = todayDiv.createEl("span", { cls: "time-tracker-timer-time" });
        todayDiv.createEl("span", { text: "Today" });

        updateToday = () => {
            const runningStart = Math.max(runningEntry.startTime, todayStart);
            const now = Math.min(moment().unix(), todayEnd);
            const liveSeconds = Math.max(0, now - runningStart);
            todayTime.setText(formatDuration((loggedSecondsToday + liveSeconds) * 1000));
        };

        new ButtonComponent(td1)
            .setClass("clickable-icon")
            .setIcon(`lucide-stop-circle`)
            .setTooltip("Stop all trackers")
            .onClick(async () => {
                await stopAll(app);
                await refresh();
            })
            .buttonEl.addClass("time-tracker-btn");

        updateToday();
    }

    await refresh();
    onTick(element, refresh);
}

export async function displayToday(tracker: Tracker, element: HTMLElement, getSectionInfo: () => MarkdownSectionInformation, settings: TimeTrackerSettings, app: App): Promise<void> {
    const format = settings.timestampFormat;

    let startTime = moment().startOf("day").unix(); // First second of today
    let endTime = moment().endOf("day").unix(); // Last second of today
    let all = await allTracks(app, startTime, endTime);
    let proj = findProjects(all);

    let tbl = element.createEl("table", { cls: "time-tracker-table" });
    tbl.createEl("tr").append(
        createEl("th", { text: "Project" }),
        createEl("th", { text: "Duration (hours)" }));

    let sum = 0;
    for (let project of proj) {
        let ds = daySum(project, moment(), all);
        sum += parseFloat(ds);
        let row = tbl.createEl("tr");
        row.createEl("td", { text: project });
        row.createEl("td", { text: ds });
    }
    let row = tbl.createEl("tr");
    row.createEl("td", { text: "Total:" });
    row.createEl("td", { text: sum.toFixed(2) });
}

function setCountdownValues(tracker: Tracker, current: HTMLElement, total: HTMLElement, currentDiv: HTMLDivElement): void {
    let running = getRunningEntry(tracker.entries);
    if (running && !running.endTime) {
        current.setText(formatDuration(getDuration(running)));
        currentDiv.hidden = false;
    } else {
        currentDiv.hidden = true;
    }
    total.setText(formatDuration(getTotalDuration(tracker.entries)));
}

function addEditableTableRow(tracker: Tracker, entry: Entry, table: HTMLTableElement, newTaskNameBox: TextComponent, running: boolean, getSectionInfo: () => MarkdownSectionInformation, settings: TimeTrackerSettings, app: App, indent: number): void {
    let row = table.createEl("tr");

    let name = row.createEl("td");
    let namePar = name.createEl("span", { text: entry.name });
    namePar.style.marginLeft = `${indent}em`;
    let nameBox = new TextComponent(name).setValue(entry.name);
    nameBox.inputEl.hidden = true;

    let startTimeEntry = entry.startTime ? formatTimestamp(entry.startTime, settings.timestampFormat) : "";
    let startTime = row.createEl("td");
    let startPar = startTime.createEl("span", { text: startTimeEntry });
    startPar.style.marginLeft = `${indent}em`;
    let startBox = new TextComponent(startTime).setValue(startTimeEntry);
    startBox.inputEl.hidden = true;

    let endTimeEntry = entry.endTime ? formatTimestamp(entry.endTime, settings.timestampFormat) : "";
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
                await stopAll(app);
                startSubEntry(entry, newTaskNameBox.getValue());
                await saveTracker(tracker, app, getSectionInfo());
            });
    }
    let editButton = new ButtonComponent(entryButtons)
        .setClass("clickable-icon")
        .setTooltip("Edit")
        .setIcon("lucide-pencil")
        .onClick(async () => {
            const format = settings.timestampFormat;

            if (namePar.hidden) {
                namePar.hidden = false;
                startPar.hidden = false;
                endPar.hidden = false;
                nameBox.inputEl.hidden = true;
                startBox.inputEl.hidden = true;
                endBox.inputEl.hidden = true;
                editButton.setIcon("lucide-pencil");
                if (nameBox.getValue()) {
                    entry.name = nameBox.getValue();
                    namePar.setText(entry.name);
                }
                if (startBox.getValue()) {
                    const parsed = parseDate(app, startBox.getValue(), format);
                    if (parsed.isValid())
                        entry.startTime = parsed.unix();
                }
                if (endBox.getValue()) {
                    const parsed = parseDate(app, endBox.getValue(), format);
                    if (parsed.isValid())
                        entry.endTime = parsed.unix();
                }

                await saveTracker(tracker, app, getSectionInfo());
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
        .onClick(() => {
            new ConfirmModal(app, `Remove "${entry.name}"? This can't be undone.`, async () => {
                removeEntry(tracker.entries, entry);
                await saveTracker(tracker, app, getSectionInfo());
            }).open();
        });

    if (entry.subEntries) {
        for (let sub of entry.subEntries)
            addEditableTableRow(tracker, sub, table, newTaskNameBox, running, getSectionInfo, settings, app, indent + 1);
    }
}
