import { App, Modal, ButtonComponent, TextComponent, TFile, TFolder, Notice } from "obsidian";
import { TimeTrackerSettings } from "./settings";
import { Entry } from "./types";
import { readAll, FileSection, stopAll, writeTrackerSection } from "./files";
import { isRunning, latestEntryTime, startNewEntry, getRunningEntry } from "./model";
import { isWithin, toName, createMarkdownTable, buildReportData } from "./report-logic";
import { parseDate } from "./dateutil";
import { renderTemplaterFile } from "./templater";
import { getMarkdownFilesInFolder, pickFile } from "./file-suggest-modal";
import type { InternalApi } from "./api";

export { findProjects, findDays, daySum, createMarkdownTable } from "./report-logic";

// Make a flat list of all time entries in sections overlapping [start, end],
// clipped to that range, and labeled with their project/client name (the
// entry's own task name is kept separately in `task`, for callers - like the
// invoice.md example template - that want to group/sum by task rather than
// just by project/client). Doesn't scan the vault itself - see
// allTracks/allTracksFromSections below.
function flattenTracks(sections: FileSection[], start: number, end: number): Entry[] {
    let ret: Entry[] = [];
    for (const section of sections) {
        if (!section.tracker.entries)
            continue;
        const name = toName(section.tracker.project, section.tracker.client);
        for (const entry of section.tracker.entries) {
            const leaves = entry.subEntries ?? [entry];
            for (const leaf of leaves) {
                if (isWithin(leaf.startTime, leaf.endTime, start, end)) {
                    const thisStart = Math.max(leaf.startTime, start);
                    const thisEnd = Math.min(leaf.endTime, end);
                    ret.push({ name, task: leaf.name, startTime: thisStart, endTime: thisEnd, subEntries: undefined });
                }
            }
        }
    }
    return ret;
}

// Make a flat list of all time entries in the vault overlapping [start, end],
// clipped to that range, and labeled with their project/client name.
export async function allTracks(app: App, start: number, end: number): Promise<Entry[]> {
    return flattenTracks(await readAll(app), start, end);
}

// Same as allTracks, but for a section list the caller already has in hand
// (e.g. from its own readAll(app) call), to avoid a second, redundant vault
// scan on top - see displayStatus/displayToday in tracker.ts.
export function allTracksFromSections(sections: FileSection[], start: number, end: number): Entry[] {
    return flattenTracks(sections, start, end);
}

// For each project/client name present in sections, pick the single section
// that best represents it: the one with a currently running timer, if any,
// otherwise whichever has the most recent (already-stopped) entry. Shared by
// pickProjectFiles (displayStatus/displayToday's note links) and
// pickProjectSection (startFavorite, below).
function bestSectionPerName(sections: FileSection[]): Map<string, FileSection> {
    const best = new Map<string, { section: FileSection; running: boolean; latest: number }>();

    for (const section of sections) {
        const name = toName(section.tracker.project, section.tracker.client);
        const running = isRunning(section.tracker);
        const latest = latestEntryTime(section.tracker.entries ?? []);
        const current = best.get(name);

        if (!current
            || (running && !current.running)
            || (running === current.running && latest > current.latest)) {
            best.set(name, { section, running, latest });
        }
    }

    const result = new Map<string, FileSection>();
    for (const [name, entry] of best)
        result.set(name, entry.section);
    return result;
}

// Takes an already-fetched section list rather than scanning the vault
// itself, since callers (displayStatus/displayToday) already have one from
// their own readAll(app) call and re-scanning again on top would be wasteful
// - they already tick every second.
export function pickProjectFiles(sections: FileSection[]): Map<string, TFile> {
    const result = new Map<string, TFile>();
    for (const [name, section] of bestSectionPerName(sections))
        result.set(name, section.file);
    return result;
}

export function pickProjectSection(sections: FileSection[], name: string): FileSection | undefined {
    return bestSectionPerName(sections).get(name);
}

// Starts tracking a configured "favorite" project/client pair: stops
// whatever's running vault-wide (same invariant as the Start button), then
// finds the section that best represents this project/client (same
// running-wins/most-recent-wins strategy as pickProjectSection above) and
// starts a new entry in it. Used by main.ts's per-favorite commands, so a
// StreamDeck (or anything else driving Obsidian's command palette/REST API)
// can start a specific, already-existing tracker without opening its note.
// Deliberately doesn't create a new tracker block if none exists yet for this
// pair - there's no good place to insert one without a cursor position, so
// it surfaces a Notice instead of guessing.
export async function startFavorite(app: App, project: string, client: string): Promise<void> {
    const name = toName(project, client);
    await stopAll(app);
    const sections = await readAll(app);
    const section = pickProjectSection(sections, name);
    if (!section) {
        new Notice(`Time Tracker: no existing tracker found for "${name}"`);
        return;
    }
    startNewEntry(section.tracker, "", project, client);
    await writeTrackerSection(app, section);
}

// True if some section has a currently running entry whose elapsed time so
// far (its startTime through right now - it has no endTime yet) overlaps
// [start, end], the same way the status/today widgets treat a running
// entry's still-accumulating time as running "up to right now" for display
// purposes. Used by ReportModal to only warn about a running timer when it
// would actually affect the specific range being reported.
function hasRunningTimerWithin(sections: FileSection[], start: number, end: number): boolean {
    const now = Math.floor(Date.now() / 1000);
    return sections.some(s => {
        const running = getRunningEntry(s.tracker.entries ?? []);
        return running != null && isWithin(running.startTime, now, start, end);
    });
}

// Report modal: lets the user pick a date range and appends a markdown table
// of hours-per-project-per-day at the cursor.
export class ReportModal extends Modal {

    settings: TimeTrackerSettings;
    onSubmit: (text: string) => void;

    constructor(app: App, settings: TimeTrackerSettings, onSubmit: (text: string) => void) {
        super(app);
        this.settings = settings;
        this.onSubmit = onSubmit;
    }

    async onOpen(): Promise<void> {
        const { contentEl } = this;
        contentEl.createEl("h2", { text: "Report as table" });
        let tbl = contentEl.createEl("table", { cls: "time-tracker-table" });
        let row1 = tbl.createEl("tr");

        // Start time
        let td1 = row1.createEl("td");
        let newStartDiv = td1.createEl("div", { cls: "time-tracker-txt" });
        let newStart = newStartDiv.createEl("span", { cls: "time-tracker-txt" });
        let newStartNameBox = new TextComponent(newStart)
            .setPlaceholder("From time");
        newStartDiv.createEl("span", { text: "From" });

        // End time
        let td2 = row1.createEl("td");
        let newEndDiv = td2.createEl("div", { cls: "time-tracker-txt" });
        let newEnd = newEndDiv.createEl("span", { cls: "time-tracker-txt" });
        let newEndNameBox = new TextComponent(newEnd)
            .setPlaceholder("To time");
        newEndDiv.createEl("span", { text: "To" });

        // add Calculate buttons
        let buttons = contentEl.createEl("div", { cls: "time-tracker-bottom" });

        new ButtonComponent(buttons)
            .setButtonText("Check dates")
            .onClick(() => {
                const format = this.settings.timestampFormat;

                let startDate = parseDate(this.app, newStartNameBox.getValue(), format);
                let endDate = parseDate(this.app, newEndNameBox.getValue(), format);
                if (startDate.isValid())
                    newStartNameBox.setValue(startDate.format(format));
                if (endDate.isValid())
                    newEndNameBox.setValue(endDate.format(format));
                updateWarning();
            });

        new ButtonComponent(buttons)
            .setButtonText("Append table at cursor")
            .onClick(async () => {
                const format = this.settings.timestampFormat;

                let startDate = parseDate(this.app, newStartNameBox.getValue(), format);
                let endDate = parseDate(this.app, newEndNameBox.getValue(), format);
                if (startDate.isValid() && endDate.isValid()) {
                    let startTime = startDate.startOf("day").unix(); // First second of date
                    let endTime = endDate.endOf("day").unix(); // Last second of date
                    // Closed before resolving the template (rather than
                    // after): if the configured template path is a folder,
                    // buildReportText opens its own file-picker modal, which
                    // would otherwise stack on top of this still-open dialog
                    // and, once dismissed, make it look like this dialog
                    // "reappeared" instead of having already done its job.
                    this.close();
                    let all = await allTracks(this.app, startTime, endTime);
                    const text = await this.buildReportText(startTime, endTime, all);
                    if (text === null) {
                        new Notice("Time Tracker: report cancelled.");
                        return;
                    }
                    this.onSubmit(text);
                }
            });

        // Non-blocking heads-up rather than forcing a stop-or-continue choice:
        // generating a report and stopping your current timer are different
        // actions, and a running entry's elapsed time is invisible to the
        // report until it's actually stopped (see allTracks/isWithin). Only
        // shown once both dates parse validly, and only if a running timer's
        // elapsed-so-far window actually overlaps the chosen range - not for
        // just any running timer anywhere in the vault, since one outside the
        // reported period wouldn't be affected either way.
        const sections = await readAll(this.app);
        let warningEl: HTMLElement | null = null;

        const updateWarning = () => {
            const format = this.settings.timestampFormat;
            const startDate = parseDate(this.app, newStartNameBox.getValue(), format);
            const endDate = parseDate(this.app, newEndNameBox.getValue(), format);
            const show = startDate.isValid() && endDate.isValid()
                && hasRunningTimerWithin(sections, startDate.startOf("day").unix(), endDate.endOf("day").unix());

            if (show && !warningEl) {
                warningEl = contentEl.createEl("p", {
                    text: "⚠ A timer is currently running within this period and won't be included in the report until it's stopped.",
                    cls: "time-tracker-running-warning",
                });
            } else if (!show && warningEl) {
                warningEl.remove();
                warningEl = null;
            }
        };

        newStartNameBox.onChange(() => updateWarning());
        newEndNameBox.onChange(() => updateWarning());
        updateWarning();
    }

    onClose(): void {
        this.contentEl.empty();
    }

    // Uses the configured Templater template if set, stashing the computed
    // data via the plugin's api first (see api.ts's "stash and consume"
    // methods) - falls back to the built-in createMarkdownTable format on any
    // failure (Templater missing, template missing, template throws), never
    // leaving the user with nothing inserted. If the setting points at a
    // folder rather than a single file, prompts to pick which template file
    // in it to use; returns null (rather than falling back) if that picker
    // is cancelled, so the caller can leave the dialog open instead of
    // inserting something the user didn't ask for.
    private async buildReportText(start: number, end: number, entries: Entry[]): Promise<string | null> {
        const templatePath = this.settings.reportTemplatePath;
        if (!templatePath)
            return createMarkdownTable(start, end, entries);

        try {
            let resolvedPath = templatePath;
            const abstractFile = this.app.vault.getAbstractFileByPath(templatePath);
            if (abstractFile instanceof TFolder) {
                const picked = await pickFile(this.app, getMarkdownFilesInFolder(abstractFile));
                if (!picked)
                    return null;
                resolvedPath = picked.path;
            }

            const data = buildReportData(start, end, entries);
            const api = (this.app as any).plugins?.plugins?.["time-tracker"]?.api as InternalApi | undefined;
            api?.stashReportData(data);
            const rendered = await renderTemplaterFile(this.app, resolvedPath);
            if (rendered !== null)
                return rendered;
        } catch (e) {
            console.error("Time Tracker: report template failed", e);
        }
        new Notice(`Time Tracker: couldn't use the report template ("${templatePath}") - falling back to the built-in format. Check that Templater is installed and the path is correct.`);
        return createMarkdownTable(start, end, entries);
    }
}
