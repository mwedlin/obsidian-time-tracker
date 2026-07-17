import { App, Modal, ButtonComponent, TextComponent } from "obsidian";
import { TimeTrackerSettings } from "./settings";
import { Entry } from "./types";
import { readAll } from "./files";
import { isWithin, toName, createMarkdownTable } from "./report-logic";
import { parseDate } from "./dateutil";

export { findProjects, findDays, daySum, createMarkdownTable } from "./report-logic";

// Make a flat list of all time entries in the vault overlapping [start, end],
// clipped to that range, and labeled with their project/client name.
export async function allTracks(app: App, start: number, end: number): Promise<Entry[]> {
    let ret: Entry[] = [];
    const sections = await readAll(app);

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

    onOpen(): void {
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
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
