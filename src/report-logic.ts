// Pure reporting math: no "obsidian" import, so this can be unit-tested
// directly under plain Node (see tests/report-logic.test.ts). Everything here
// operates on an already-flattened list of Entry-like records; gathering that
// list from the vault (allTracks, in report.ts) is the only Obsidian-dependent
// part of reporting.

import moment from "moment";
import { Moment } from "moment";
import { Entry } from "./types";

// Construct a display name from project and client.
export function toName(project: string, client: string): string {
    if (project && client) return project + "/" + client;
    if (project) return project;
    if (client) return client;
    return "(no project)";
}

// Return true if a tracked interval overlaps the given duration.
export function isWithin(trStart: number, trEnd: number, durStart: number, durEnd: number): boolean {
    if (trEnd < durStart) return false; // Before duration
    if (trStart > durEnd) return false; // After duration
    return true;
}

// Return a list of all the distinct project/client names present in entries.
export function findProjects(entries: Entry[]): string[] {
    let str: string[] = [];

    for (let i = 0; i < entries.length; i++) {
        const found = str.find(element => element == entries[i].name);
        if (!found) str.push(entries[i].name);
    }
    return str.sort();
}

// Return an array of moments for the start of each day in the interval.
//
// Steps one calendar day at a time via moment's own DST-aware `.add(1, "day")`
// rather than raw unix-second arithmetic: incrementing by a fixed 3600*24
// would duplicate a calendar day across a "fall back" transition (a 25-hour
// day), since adding exactly 24h of raw seconds from that day's midnight
// lands short of the next midnight.
export function findDays(start: number, end: number): Moment[] {
    let r: Moment[] = [];
    let day = moment.unix(start).startOf("days");
    const lastDay = moment.unix(end).startOf("days");
    while (day.isSameOrBefore(lastDay)) {
        r.push(day.clone());
        day = day.clone().add(1, "day");
    }
    return r;
}

// Return the number of hours (as a "12.34"-style string) worked on a project on a specific day.
// If project is undefined, report a total sum of all projects this day.
// If day is undefined, report time of all days for the project.
export function daySum(project: string, day: Moment, entries: Entry[]): string {
    let sum = 0; // Seconds
    let doAll: boolean;
    let dayStart: number;
    let dayEnd: number;

    if (day == undefined) {
        doAll = true;
    } else {
        doAll = false;
        dayStart = day.clone().startOf("days").unix();
        dayEnd = day.clone().endOf("days").unix();
    }
    for (let i = 0; i < entries.length; i++) {
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
    return (sum / 3600).toFixed(2);
}

// Build a markdown table: rows = projects, columns = days + a Total column.
export function createMarkdownTable(start: number, end: number, entries: Entry[]): string {
    let days = findDays(start, end);
    let projects = findProjects(entries);

    let ret = "Project |";
    for (let i = 0; i < days.length; i++) { // First row
        ret += days[i].format(" dddd<br>YYYY-MM-DD |");
    }
    ret += " **Total**\n";
    for (let i = 0; i < days.length + 1; i++) { // add separators after first row
        ret += "---|";
    }
    ret += "---\n";
    for (let i = 0; i < projects.length; i++) { // Project sums
        ret += projects[i] + " |";
        for (let j = 0; j < days.length; j++) {
            ret += daySum(projects[i], days[j], entries) + " |";
        }
        ret += "**" + daySum(projects[i], undefined, entries) + "**\n";
    }
    ret += "**Total:** |";
    for (let i = 0; i < days.length; i++) { // Sum up the days.
        ret += "**" + daySum(undefined, days[i], entries) + "** |";
    }
    ret += "**" + daySum(undefined, undefined, entries) + "** \n";

    return ret;
}
