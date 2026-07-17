// Shared data model. Deliberately free of any "obsidian" import so it can be
// used from pure, Node-testable logic as well as from the plugin's UI code.

// A tracker's own entries store the task's name in `name` itself (the
// tracker UI's "Task" text field - see newTaskNameBox in tracker.ts - writes
// into this same field, which is why "Task" and "name" can read as
// synonyms). Only the Report pipeline's flattened, clipped entries
// (report.ts's flattenTracks) additionally set `task`: there, `name` gets
// overwritten with the combined "Project/Client" name for grouping, so the
// task's own name has to live somewhere else to stay available.
export interface Entry {
    name: string;
    startTime: number;
    endTime: number;
    subEntries: Entry[];
    task?: string;
}

export interface Tracker {
    dispType: string; // "default" | "compact" | "status" | "today"
    currTask: string;
    project: string;
    client: string;
    entries: Entry[];
}

// Precomputed data for the Report command's date-range table, exposed via the
// plugin's public API (see api.ts) for Templater templates to consume instead
// of the hardcoded createMarkdownTable rendering. Raw seconds/numbers only -
// formatting is the template's job.
export interface ReportData {
    days: string[];             // "YYYY-MM-DD"
    projects: string[];
    cellsSeconds: number[][];   // [projectIndex][dayIndex]
    projectTotalSeconds: number[];
    dayTotalSeconds: number[];
    grandTotalSeconds: number;
    entries: Entry[];           // raw escape hatch
}

// One flattened row of a single tracker's own entries (recursing into
// subEntries), exposed via the plugin's public API for Templater templates
// used by the per-tracker "Copy as table"/"Copy as CSV" buttons.
export interface TrackerRow {
    name: string;
    startTime: number | null;
    endTime: number | null;
    durationSeconds: number;
    depth: number; // subEntries nesting depth, 0 for a top-level entry
}
