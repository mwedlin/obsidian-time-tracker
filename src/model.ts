// Pure tracker state machine + formatting logic: no "obsidian" import, so this
// can be unit-tested directly under plain Node (see tests/model.test.ts).

import moment from "moment";
import { Entry, Tracker } from "./types";
import { TimeTrackerSettings } from "./settings";
import { escapeCsvField, escapeMarkdownCell } from "./text-escape";

// An empty block (freshly inserted, nothing typed yet) is a normal, expected
// state and gets a blank tracker. Anything else that doesn't parse into a
// plausible Tracker shape - broken JSON, or a manually-edited "entries" that
// isn't an array - returns null rather than guessing: several places
// downstream (e.g. displayTrackerDefault's `tracker.entries.length`) assume
// entries is a real array and throw otherwise, and silently substituting a
// blank tracker risks the caller saving it straight back over the user's
// original text the moment they click any button. Returning null lets the
// caller show a read-only error instead, leaving that text untouched.
export function loadTracker(json: string): Tracker | null {
    if (!json) {
        return {
            dispType: "default",
            currTask: undefined,
            project: undefined,
            client: undefined,
            entries: [],
        };
    }

    let parsed: any;
    try {
        parsed = JSON.parse(json);
    } catch (e) {
        console.log(`Failed to parse Tracker from ${json}`);
        return null;
    }

    if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed))
        return null;
    if (parsed.entries === undefined || parsed.entries === null)
        parsed.entries = [];
    else if (!Array.isArray(parsed.entries))
        return null;

    return parsed as Tracker;
}

export function getRunningEntry(entries: Entry[]): Entry {
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

export function isRunning(tracker: Tracker): boolean {
    if (tracker.entries == undefined) return false;
    return !!getRunningEntry(tracker.entries);
}

export function getDuration(entry: Entry): number {
    if (entry.subEntries) {
        return getTotalDuration(entry.subEntries);
    } else {
        let endTime = entry.endTime ? moment.unix(entry.endTime) : moment();
        return endTime.diff(moment.unix(entry.startTime));
    }
}

export function getTotalDuration(entries: Entry[]): number {
    let ret = 0;
    for (let entry of entries)
        ret += getDuration(entry);
    return ret;
}

// The most recent endTime among an entry list's leaves (recursing into
// subEntries), ignoring still-running leaves (no endTime yet) - used to pick
// which of several notes logging the same project was most recently active.
export function latestEntryTime(entries: Entry[]): number {
    let latest = 0;
    for (let entry of entries) {
        if (entry.subEntries) {
            latest = Math.max(latest, latestEntryTime(entry.subEntries));
        } else if (entry.endTime) {
            latest = Math.max(latest, entry.endTime);
        }
    }
    return latest;
}

export function startNewEntry(tracker: Tracker, name: string, project: string, client: string): void {
    tracker.currTask = name;
    tracker.project = project;
    tracker.client = client;

    if (!name)
        name = `task ${tracker.entries.length + 1}`;
    let entry: Entry = { name: name, startTime: moment().unix(), endTime: null, subEntries: null };
    tracker.entries.push(entry);
}

export function startSubEntry(entry: Entry, name: string): void {
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

export function endRunningEntry(tracker: Tracker): void {
    let entry = getRunningEntry(tracker.entries);
    if (entry)
        entry.endTime = moment().unix();
}

export function removeEntry(entries: Entry[], toRemove: Entry): boolean {
    const idx = entries.indexOf(toRemove);
    if (idx !== -1) {
        entries.splice(idx, 1);
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

export function formatTimestamp(timestamp: number, format: string): string {
    return moment.unix(timestamp).format(format);
}

export function formatDuration(totalTime: number): string {
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
        ret += String(duration.minutes()).padStart(2, "0") + "m ";
    ret += String(duration.seconds()).padStart(2, "0") + "s";
    return ret;
}

export function createTableSection(entry: Entry, settings: TimeTrackerSettings): string[][] {
    let ret: string[][] = [[
        entry.name,
        entry.startTime ? formatTimestamp(entry.startTime, settings.timestampFormat) : "",
        entry.endTime ? formatTimestamp(entry.endTime, settings.timestampFormat) : "",
        entry.endTime || entry.subEntries ? formatDuration(getDuration(entry)) : ""]];
    if (entry.subEntries) {
        for (let sub of entry.subEntries)
            ret.push(...createTableSection(sub, settings));
    }
    return ret;
}

export function createCsv(tracker: Tracker, settings: TimeTrackerSettings): string {
    let ret = "";
    for (let entry of tracker.entries) {
        for (let row of createTableSection(entry, settings))
            ret += row.map(field => escapeCsvField(field, settings.csvDelimiter)).join(settings.csvDelimiter) + "\n";
    }
    return ret;
}

// Markdown table for a single tracker's own entries (as opposed to
// report-logic.ts's createMarkdownTable, which builds a vault-wide,
// date-range report across many trackers).
export function createTrackerTable(tracker: Tracker, settings: TimeTrackerSettings): string {
    let ret = "Task | Start time | End time | Duration\n---|---|---|---\n";
    for (let entry of tracker.entries) {
        for (let row of createTableSection(entry, settings))
            ret += row.map(escapeMarkdownCell).join(" | ") + "\n";
    }
    return ret;
}
