import { moment, App, MarkdownSectionInformation, ButtonComponent, TextComponent, TFile, TFolder, Notice } from "obsidian";
import { TimeTrackerSettings } from "./settings";
import { Tracker, Entry, TrackerRow } from "./types";
import {
    loadTracker, isRunning, getRunningEntry, getDuration, getTotalDuration,
    startNewEntry, startSubEntry, endRunningEntry, removeEntry,
    formatTimestamp, formatDuration, createTrackerTable, createCsv, flattenEntries,
} from "./model";
import { stopAll, readAll } from "./files";
import { allTracksFromSections, pickProjectFiles } from "./report";
import { findProjects, daySumSeconds, toName } from "./report-logic";
import { parseDate } from "./dateutil";
import { ConfirmModal } from "./confirm-modal";
import { onTick } from "./ticker";
import { renderTemplaterFile } from "./templater";
import { getMarkdownFilesInFolder, pickFile } from "./file-suggest-modal";
import type { InternalApi } from "./api";

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

// Wraps an async refresh function so rapid-fire calls (e.g. a burst of
// vault "modify" events from someone editing an unrelated note) collapse
// into a single run instead of each kicking off its own overlapping vault
// scan: waits delayMs of quiet before running, and if triggered again while
// still running, queues at most one more run rather than starting concurrently.
function debounced(fn: () => Promise<void>, delayMs: number): () => void {
    let timer: number = null;
    let running = false;
    let queued = false;

    async function run(): Promise<void> {
        if (running) {
            queued = true;
            return;
        }
        running = true;
        try {
            await fn();
        } finally {
            running = false;
            if (queued) {
                queued = false;
                run();
            }
        }
    }

    return () => {
        if (timer !== null)
            window.clearTimeout(timer);
        timer = window.setTimeout(() => {
            timer = null;
            run();
        }, delayMs);
    };
}

// Uses the configured Templater template if set, stashing this tracker's
// flattened rows via the plugin's api first (see api.ts's "stash and
// consume" methods) - falls back to the given built-in formatter on any
// failure (Templater missing, template missing, template throws), never
// leaving the user with an empty clipboard. If the setting points at a
// folder rather than a single file, prompts to pick which template file in
// it to use; returns null (rather than falling back) if that picker is
// cancelled, so the caller can leave the clipboard untouched instead of
// copying something the user didn't ask for.
async function buildTrackerOutput(tracker: Tracker, app: App, templatePath: string, fallback: () => string): Promise<string | null> {
    if (!templatePath)
        return fallback();

    try {
        let resolvedPath = templatePath;
        const abstractFile = app.vault.getAbstractFileByPath(templatePath);
        if (abstractFile instanceof TFolder) {
            const picked = await pickFile(app, getMarkdownFilesInFolder(abstractFile));
            if (!picked)
                return null;
            resolvedPath = picked.path;
        }

        const rows: TrackerRow[] = [];
        for (const entry of tracker.entries)
            rows.push(...flattenEntries(entry));
        const api = (app as any).plugins?.plugins?.["time-tracker"]?.api as InternalApi | undefined;
        api?.stashTrackerRows(rows);
        const rendered = await renderTemplaterFile(app, resolvedPath);
        if (rendered !== null)
            return rendered;
    } catch (e) {
        console.error("Time Tracker: tracker template failed", e);
    }
    new Notice(`Time Tracker: couldn't use the template ("${templatePath}") - falling back to the built-in format. Check that Templater is installed and the path is correct.`);
    return fallback();
}

// Rendered instead of an interactive tracker when loadTracker couldn't make
// sense of the block's JSON - read-only, on purpose: rendering the normal
// interactive UI here would let a stray button click (Start, Edit, ...) save
// straight over whatever the user's original (broken) text was.
export function displayParseError(element: HTMLElement): void {
    const box = element.createEl("div", { cls: "time-tracker-parse-error" });
    box.createEl("p", {
        text: "⚠ Couldn't read this time tracker: its data doesn't look valid (broken JSON, or a field like \"entries\" isn't the expected shape). Nothing has been changed - edit the block's raw text directly to fix it.",
    });
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

    // Compact/full view toggle - always visible regardless of the current
    // mode (unlike "Copy as table/CSV" below, which only exist in full view),
    // so it lives here rather than down in the entries-table section.
    let compact = tracker.dispType == "compact";
    let compactBtn = new ButtonComponent(td1)
        .setClass("clickable-icon")
        .setIcon(compact ? "lucide-chevron-down" : "lucide-chevron-up")
        .setTooltip(compact ? "Show entries table" : "Compact view")
        .onClick(async () => {
            tracker.dispType = compact ? "default" : "compact";
            await saveTracker(tracker, app, getSectionInfo());
        });
    compactBtn.buttonEl.addClass("time-tracker-btn");

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
            .onClick(async () => {
                const text = await buildTrackerOutput(
                    tracker, app, settings.trackerTableTemplatePath, () => createTrackerTable(tracker, settings));
                if (text !== null)
                    navigator.clipboard.writeText(text);
            });
        new ButtonComponent(buttons)
            .setButtonText("Copy as CSV")
            .onClick(async () => {
                const text = await buildTrackerOutput(
                    tracker, app, settings.trackerCsvTemplatePath, () => createCsv(tracker, settings));
                if (text !== null)
                    navigator.clipboard.writeText(text);
            });
    }

    setCountdownValues(tracker, current, total, currentDiv);
    // Purely local math against the already-in-memory tracker - no vault
    // scan involved - and Start/Stop/Edit/Remove already trigger a fresh
    // re-render via the note's own content changing, so a slower cadence
    // here only affects how smoothly the running duration ticks up between
    // clicks, not how quickly actions are reflected.
    // Check tbl (created fresh above, every render), not the outer element:
    // Obsidian can reuse that outer container across repeated re-invocations
    // of this code-block processor, so it never reports "disconnected" even
    // after main.ts's e.empty() has wiped this exact render's content out -
    // which would otherwise leak an ever-growing pile of stale tickers.
    onTick(tbl, () => setCountdownValues(tracker, current, total, currentDiv), { intervalMs: settings.timerUpdateSeconds * 1000 });
}

// View a short status of the time tracking system.
export async function displayStatus(tracker: Tracker, element: HTMLElement, getSectionInfo: () => MarkdownSectionInformation, settings: TimeTrackerSettings, app: App): Promise<void> {
    let tbl = element.createEl("table", { cls: "time-tracker-table" });
    let row1 = tbl.createEl("tr");

    // Re-checked on every vault change (not just re-rendered once at load) so
    // that stopping/starting a timer elsewhere - another pane, or the "Stop
    // all timers" command - is picked up without having to reload the note.
    // The row is only rebuilt on an actual running/not-running (or
    // active-file) transition; otherwise nothing needs to happen here at all,
    // since the live "Today" number is ticked separately below without a scan.
    let hasRendered = false;
    let renderedFilePath: string = undefined;
    let updateToday: (() => void) | null = null;

    async function refresh(): Promise<void> {
        const sections = await readAll(app);
        const activeSection = sections.find(s => isRunning(s.tracker));
        const activeFilePath = activeSection ? activeSection.file.path : undefined;

        if (hasRendered && activeFilePath === renderedFilePath)
            return;
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
        // From the sections already fetched above - not another allTracks(app, ...)
        // call, which would scan the whole vault a second time on every transition.
        const allToday = allTracksFromSections(sections, todayStart, todayEnd);
        const loggedSecondsToday = daySumSeconds(undefined, moment(), allToday);

        let td1 = row1.createEl("td");
        let msgCell = row1.createEl("td");
        msgCell.createSpan({ text: "Active timer in note " });
        createNoteLink(msgCell, activeSection.file.path, activeSection.file, app);

        let td2 = row1.createEl("td");
        let timer = td2.createDiv({ cls: "time-tracker-timers" });
        let todayDiv = timer.createEl("div", { cls: "time-tracker-timer" });
        let todayTime = todayDiv.createEl("span", { cls: "time-tracker-timer-time" });
        todayDiv.createEl("span", { text: "Today" });

        updateToday = () => {
            const runningStartMs = Math.max(runningEntry.startTime, todayStart) * 1000;
            // Millisecond precision throughout, rounded to the nearest second
            // only at the very end - not moment().unix()'s floor - so that
            // sampling still reliably lands on the correct value even with a
            // few hundred ms of ordinary JS timer jitter, instead of needing
            // to land exactly on the true second boundary to avoid visibly
            // skipping one.
            const nowMs = Math.min(Date.now(), todayEnd * 1000);
            const liveSeconds = Math.max(0, Math.round((nowMs - runningStartMs) / 1000));
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

    // Ticks the live "Today" number every second using already-known state -
    // no vault scan, just moment() math - while the running/not-running check
    // itself is event-driven, not polled: it only costs a readAll() when a
    // note actually changes (Start/Stop/Edit, from anywhere), instead of once
    // a second regardless of whether anything happened. Debounced so a burst
    // of saves elsewhere in the vault collapses into one scan rather than
    // several overlapping ones competing with the tick above for the main
    // thread (a likely source of the "Today" number occasionally skipping a
    // visible second).
    const triggerRefresh = debounced(refresh, 300);
    const eventRef = app.vault.on("modify", () => triggerRefresh());
    // tbl, not element - see displayTrackerDefault's onTick call for why.
    onTick(tbl, () => updateToday?.(), { intervalMs: settings.statusUpdateSeconds * 1000, onDisconnect: () => app.vault.offref(eventRef) });
}

export async function displayToday(tracker: Tracker, element: HTMLElement, getSectionInfo: () => MarkdownSectionInformation, settings: TimeTrackerSettings, app: App): Promise<void> {
    let tbl = element.createEl("table", { cls: "time-tracker-table" });

    // Event-driven, same pattern as displayStatus: rebuilds the table only on
    // an actual running/not-running (or active-file) transition, triggered by
    // a vault change rather than polled; the live numbers tick separately
    // below (every 30s - precision here matters less than in displayStatus),
    // so a running timer's elapsed-today time is still reflected without
    // waiting for it to be stopped.
    let hasRendered = false;
    let renderedFilePath: string = undefined;
    let updateLive: (() => void) | null = null;

    async function refresh(): Promise<void> {
        const sections = await readAll(app);
        const activeSection = sections.find(s => isRunning(s.tracker));
        const activeFilePath = activeSection ? activeSection.file.path : undefined;

        if (hasRendered && activeFilePath === renderedFilePath)
            return;
        hasRendered = true;
        renderedFilePath = activeFilePath;
        updateLive = null;
        tbl.empty();

        const todayStart = moment().startOf("day").unix();
        const todayEnd = moment().endOf("day").unix();
        // From the sections already fetched above - see displayStatus for why.
        const all = allTracksFromSections(sections, todayStart, todayEnd);

        const activeProject = activeSection
            ? toName(activeSection.tracker.project, activeSection.tracker.client)
            : undefined;
        const runningEntry = activeSection ? getRunningEntry(activeSection.tracker.entries) : undefined;

        // include the running entry's project even if it has no completed
        // entries logged today yet, so its live time still gets a row
        let proj = findProjects(all);
        if (activeProject && !proj.includes(activeProject))
            proj = [...proj, activeProject].sort();

        // Pick which note to link each project's row to: the section list is
        // already in hand from readAll above, so this is free - no extra scan.
        const projectFiles = pickProjectFiles(sections);

        tbl.createEl("tr").append(
            createEl("th", { text: "Project" }),
            createEl("th", { text: "Duration (hours)" }));

        // activeCell holds only the numeric value, as its own span, so the
        // "active" marker next to it survives updateLive()'s per-tick
        // setText() calls instead of being wiped out along with it.
        let activeCell: HTMLElement = null;
        let staticTotalSeconds = 0;
        let activeBaseSeconds = 0;

        for (let project of proj) {
            const loggedSeconds = daySumSeconds(project, moment(), all);
            staticTotalSeconds += loggedSeconds;

            let row = tbl.createEl("tr");
            let nameCell = row.createEl("td");
            const file = projectFiles.get(project);
            if (file)
                createNoteLink(nameCell, project, file, app);
            else
                nameCell.setText(project);
            let cell = row.createEl("td");
            let valueSpan = cell.createSpan({ text: (loggedSeconds / 3600).toFixed(2) });
            if (project === activeProject) {
                activeCell = valueSpan;
                activeBaseSeconds = loggedSeconds;
                cell.createSpan({ text: "active", cls: "time-tracker-active-marker" });
            }
        }

        let totalRow = tbl.createEl("tr");
        totalRow.createEl("td", { text: "Total:" });
        let totalCell = totalRow.createEl("td", { text: (staticTotalSeconds / 3600).toFixed(2) });

        if (runningEntry) {
            updateLive = () => {
                const runningStartMs = Math.max(runningEntry.startTime, todayStart) * 1000;
                // See displayStatus's updateToday for why round(ms) rather
                // than moment().unix()'s floor.
                const nowMs = Math.min(Date.now(), todayEnd * 1000);
                const liveSeconds = Math.max(0, Math.round((nowMs - runningStartMs) / 1000));
                if (activeCell)
                    activeCell.setText(((activeBaseSeconds + liveSeconds) / 3600).toFixed(2));
                totalCell.setText(((staticTotalSeconds + liveSeconds) / 3600).toFixed(2));
            };
            updateLive();
        }
    }

    await refresh();

    // Same split as displayStatus: a cheap local tick keeps the live numbers
    // moving (every 30s here - this widget doesn't need per-second precision),
    // while the vault-wide running/not-running check is event-driven, only
    // costing a readAll() when a note actually changes - debounced for the
    // same reason as displayStatus (see there).
    const triggerRefresh = debounced(refresh, 300);
    const eventRef = app.vault.on("modify", () => triggerRefresh());
    // tbl, not element - see displayTrackerDefault's onTick call for why.
    onTick(tbl, () => updateLive?.(), { intervalMs: settings.todayUpdateSeconds * 1000, onDisconnect: () => app.vault.offref(eventRef) });
}

// A clickable link to one of the vault's notes, styled/behaving like a
// normal internal link (including working with Obsidian's Page Preview
// hover, since that keys off the "internal-link" class + href).
function createNoteLink(parent: HTMLElement, text: string, file: TFile, app: App): HTMLElement {
    const link = parent.createEl("a", { text, cls: "internal-link", href: file.path });
    link.addEventListener("click", (evt: MouseEvent) => {
        evt.preventDefault();
        app.workspace.getLeaf(evt.ctrlKey || evt.metaKey).openFile(file);
    });
    return link;
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
