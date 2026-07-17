// This plugin's public API surface, reachable externally at
// `app.plugins.plugins["time-tracker"].api` - e.g. from a Templater template
// (see templater.ts and design.md's "stash and consume" section). Data stays
// in raw seconds/numbers here, not pre-formatted strings - formatting is the
// template's job. formatDuration/the escaping helpers are exposed for
// convenience but never force-applied, since a template might target
// Markdown, CSV, or something else entirely.
import { App } from "obsidian";
import { Tracker, ReportData, TrackerRow } from "./types";
import { formatTimestamp, formatDuration, flattenEntries } from "./model";
import { buildReportData } from "./report-logic";
import { escapeMarkdownCell, escapeCsvField } from "./text-escape";
import { defaultSettings } from "./settings";
import { allTracks } from "./report";

export interface TimeTrackerApi {
    apiVersion: 1;
    getReportData(start: number, end: number): Promise<ReportData>;
    getTrackerRows(tracker: Tracker): TrackerRow[];
    formatTimestamp(ts: number, format?: string): string;
    formatDuration(totalMs: number): string;
    escapeMarkdownCell(v: string): string;
    escapeCsvField(v: string, delimiter?: string): string;
    consumeReportData(): ReportData | null;
    consumeTrackerRows(): TrackerRow[] | null;
}

// Extra methods used only by this plugin's own callers (report.ts, tracker.ts)
// to hand data to the api object immediately before invoking Templater - not
// part of the public TimeTrackerApi surface a template's own code sees.
// First-party callers reach these the same way an external template would
// (`app.plugins.plugins["time-tracker"].api`, cast to this wider type) so
// that reference stays the plugin's one shared api instance - see report.ts/
// tracker.ts for why this is a type-only import rather than a module import.
export interface InternalApi extends TimeTrackerApi {
    stashReportData(data: ReportData): void;
    stashTrackerRows(rows: TrackerRow[]): void;
}

export function createApi(app: App): InternalApi {
    let stashedReportData: ReportData | null = null;
    let stashedTrackerRows: TrackerRow[] | null = null;

    return {
        apiVersion: 1,

        async getReportData(start: number, end: number): Promise<ReportData> {
            const entries = await allTracks(app, start, end);
            return buildReportData(start, end, entries);
        },

        getTrackerRows(tracker: Tracker): TrackerRow[] {
            const rows: TrackerRow[] = [];
            for (const entry of tracker.entries ?? [])
                rows.push(...flattenEntries(entry));
            return rows;
        },

        formatTimestamp(ts: number, format?: string): string {
            return formatTimestamp(ts, format ?? defaultSettings.timestampFormat);
        },
        formatDuration,
        escapeMarkdownCell,
        escapeCsvField,

        stashReportData(data: ReportData): void {
            stashedReportData = data;
        },
        stashTrackerRows(rows: TrackerRow[]): void {
            stashedTrackerRows = rows;
        },
        consumeReportData(): ReportData | null {
            const data = stashedReportData;
            stashedReportData = null;
            return data;
        },
        consumeTrackerRows(): TrackerRow[] | null {
            const rows = stashedTrackerRows;
            stashedTrackerRows = null;
            return rows;
        },
    };
}
