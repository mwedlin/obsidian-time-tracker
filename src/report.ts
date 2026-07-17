import { App, Modal, ButtonComponent, TextComponent, TFile } from "obsidian";
import { TimeTrackerSettings } from "./settings";
import { Entry } from "./types";
import { readAll, FileSection } from "./files";
import { isRunning, latestEntryTime } from "./model";
import { isWithin, toName, createMarkdownTable } from "./report-logic";
import { parseDate } from "./dateutil";

export { findProjects, findDays, daySum, createMarkdownTable } from "./report-logic";

// Make a flat list of all time entries in sections overlapping [start, end],
// clipped to that range, and labeled with their project/client name. Doesn't
// scan the vault itself - see allTracks/allTracksFromSections below.
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
                    ret.push({ name, startTime: thisStart, endTime: thisEnd, subEntries: undefined });
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

// For each project/client name present in sections, pick the single note
// that best represents it: the one with a currently running timer, if any,
// otherwise whichever has the most recent (already-stopped) entry. Takes an
// already-fetched section list rather than scanning the vault itself, since
// callers (displayStatus/displayToday) already have one from their own
// readAll(app) call and re-scanning again on top would be wasteful - they
// already tick every second.
export function pickProjectFiles(sections: FileSection[]): Map<string, TFile> {
    const best = new Map<string, { file: TFile; running: boolean; latest: number }>();

    for (const section of sections) {
        const name = toName(section.tracker.project, section.tracker.client);
        const running = isRunning(section.tracker);
        const latest = latestEntryTime(section.tracker.entries ?? []);
        const current = best.get(name);

        if (!current
            || (running && !current.running)
            || (running === current.running && latest > current.latest)) {
            best.set(name, { file: section.file, running, latest });
        }
    }

    const result = new Map<string, TFile>();
    for (const [name, entry] of best)
        result.set(name, entry.file);
    return result;
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
                    let all = await allTracks(this.app, startTime, endTime);
                    const text = createMarkdownTable(startTime, endTime, all);
                    this.close();
                    this.onSubmit(text);
                }
            });

        // Non-blocking heads-up rather than forcing a stop-or-continue choice:
        // generating a report and stopping your current timer are different
        // actions, and a running entry's elapsed time is invisible to the
        // report until it's actually stopped (see allTracks/isWithin).
        const sections = await readAll(this.app);
        if (sections.some(s => isRunning(s.tracker))) {
            contentEl.createEl("p", {
                text: "⚠ A timer is currently running and won't be included in the report until it's stopped.",
                cls: "time-tracker-running-warning",
            });
        }
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
