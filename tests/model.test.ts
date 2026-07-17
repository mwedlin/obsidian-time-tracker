import { test } from "node:test";
import assert from "node:assert/strict";
import {
    loadTracker, isRunning, getRunningEntry, getDuration, getTotalDuration,
    startNewEntry, startSubEntry, endRunningEntry, removeEntry, formatDuration,
    latestEntryTime, flattenEntries, createTableSection,
} from "../src/model";
import { Entry, Tracker } from "../src/types";
import { TimeTrackerSettings } from "../src/settings";

test("loadTracker parses valid JSON", () => {
    const tracker = loadTracker('{"dispType":"default","currTask":"","project":"P","client":"C","entries":[]}');
    assert.equal(tracker.project, "P");
    assert.deepEqual(tracker.entries, []);
});

test("loadTracker returns an empty tracker for an empty block (a freshly inserted one)", () => {
    assert.deepEqual(loadTracker("").entries, []);
});

test("loadTracker returns null (not a guessed-at fallback) for broken JSON", () => {
    assert.equal(loadTracker("not json"), null);
    assert.equal(loadTracker('{"entries": [}'), null); // truncated/invalid syntax
});

test("loadTracker returns null for valid JSON with a malformed \"entries\" field", () => {
    assert.equal(loadTracker('{"entries": "oops"}'), null); // string, not an array
    assert.equal(loadTracker('{"entries": 5}'), null); // number, not an array
    assert.equal(loadTracker('{"entries": {}}'), null); // object, not an array
    assert.equal(loadTracker("[]"), null); // valid JSON, but not an object at all
});

test("loadTracker normalizes a missing/null \"entries\" field to an empty array rather than erroring", () => {
    // unlike a wrong-typed entries field, a missing one doesn't lose any
    // recoverable data - there was nothing there to begin with - so it's
    // healed instead of treated as an error.
    assert.deepEqual(loadTracker('{"project":"P"}').entries, []);
    assert.deepEqual(loadTracker('{"project":"P","entries":null}').entries, []);
});

test("isRunning is false with no entries, true with an open entry", () => {
    const tracker: Tracker = { dispType: "default", currTask: "", project: "", client: "", entries: [] };
    assert.equal(isRunning(tracker), false);

    startNewEntry(tracker, "task", "proj", "client");
    assert.equal(isRunning(tracker), true);

    endRunningEntry(tracker);
    assert.equal(isRunning(tracker), false);
});

test("getRunningEntry finds a running leaf nested inside subEntries", () => {
    const entries: Entry[] = [
        { name: "a", startTime: 1, endTime: 2, subEntries: null },
        {
            name: "b", startTime: null, endTime: null, subEntries: [
                { name: "Part 1", startTime: 10, endTime: 20, subEntries: null },
                { name: "Part 2", startTime: 20, endTime: null, subEntries: null },
            ]
        },
    ];
    const running = getRunningEntry(entries);
    assert.equal(running?.name, "Part 2");
});

test("startSubEntry splits a finished entry into Part 1 / Part 2", () => {
    const entry: Entry = { name: "task", startTime: 100, endTime: 200, subEntries: null };
    startSubEntry(entry, "");
    assert.equal(entry.startTime, null);
    assert.equal(entry.subEntries.length, 2);
    assert.equal(entry.subEntries[0].name, "Part 1");
    assert.equal(entry.subEntries[0].startTime, 100);
    assert.equal(entry.subEntries[0].endTime, 200);
    assert.equal(entry.subEntries[1].name, "Part 2");
    assert.equal(entry.subEntries[1].endTime, null);
});

test("getDuration/getTotalDuration sum across subEntries", () => {
    const entry: Entry = {
        name: "task", startTime: null, endTime: null, subEntries: [
            { name: "Part 1", startTime: 0, endTime: 10, subEntries: null },
            { name: "Part 2", startTime: 100, endTime: 130, subEntries: null },
        ]
    };
    // moment().diff() returns milliseconds
    assert.equal(getDuration(entry), 10_000 + 30_000);
    assert.equal(getTotalDuration([entry]), 40_000);
});

test("removeEntry removes a leaf and merges a subEntries array back down to one leftover", () => {
    const toRemove: Entry = { name: "Part 1", startTime: 0, endTime: 10, subEntries: null };
    const keep: Entry = { name: "Part 2", startTime: 20, endTime: 30, subEntries: null };
    const parent: Entry = { name: "task", startTime: null, endTime: null, subEntries: [toRemove, keep] };
    const entries = [parent];

    assert.equal(removeEntry(entries, toRemove), true);
    // only one sub entry left -> merged back into the parent, subEntries cleared
    assert.equal(parent.subEntries, null);
    assert.equal(parent.startTime, 20);
    assert.equal(parent.endTime, 30);
});

test("removeEntry returns false for an entry that isn't present", () => {
    const entries: Entry[] = [{ name: "a", startTime: 1, endTime: 2, subEntries: null }];
    const notThere: Entry = { name: "ghost", startTime: 1, endTime: 2, subEntries: null };
    assert.equal(removeEntry(entries, notThere), false);
});

test("formatDuration renders hours/minutes/seconds, minutes and seconds zero-padded to 2 digits", () => {
    assert.equal(formatDuration(1000), "01s");
    assert.equal(formatDuration(61_000), "01m 01s");
    assert.equal(formatDuration(3_661_000), "1h 01m 01s");
    // double-digit minutes/seconds stay as-is, not further padded
    assert.equal(formatDuration((15 * 60 + 45) * 1000), "15m 45s");
});

test("latestEntryTime finds the max endTime across leaves and subEntries, ignoring still-running ones", () => {
    const entries: Entry[] = [
        { name: "a", startTime: 0, endTime: 100, subEntries: null },
        {
            name: "b", startTime: null, endTime: null, subEntries: [
                { name: "Part 1", startTime: 200, endTime: 300, subEntries: null },
                { name: "Part 2", startTime: 400, endTime: null, subEntries: null }, // still running
            ]
        },
    ];
    assert.equal(latestEntryTime(entries), 300);
});

test("latestEntryTime returns 0 when nothing has finished yet", () => {
    const entries: Entry[] = [{ name: "a", startTime: 0, endTime: null, subEntries: null }];
    assert.equal(latestEntryTime(entries), 0);
    assert.equal(latestEntryTime([]), 0);
});

test("flattenEntries returns a single depth-0 row for a plain leaf entry", () => {
    const entry: Entry = { name: "task", startTime: 100, endTime: 200, subEntries: null };
    const rows = flattenEntries(entry);
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { name: "task", startTime: 100, endTime: 200, durationSeconds: 100, depth: 0 });
});

test("flattenEntries recurses into subEntries, incrementing depth, parent duration is the sum", () => {
    const entry: Entry = {
        name: "task", startTime: null, endTime: null, subEntries: [
            { name: "Part 1", startTime: 0, endTime: 10, subEntries: null },
            { name: "Part 2", startTime: 100, endTime: 130, subEntries: null },
        ]
    };
    const rows = flattenEntries(entry);
    assert.equal(rows.length, 3);
    assert.equal(rows[0].name, "task");
    assert.equal(rows[0].depth, 0);
    assert.equal(rows[0].startTime, null);
    assert.equal(rows[0].durationSeconds, 40); // 10s + 30s
    assert.equal(rows[1].name, "Part 1");
    assert.equal(rows[1].depth, 1);
    assert.equal(rows[1].durationSeconds, 10);
    assert.equal(rows[2].name, "Part 2");
    assert.equal(rows[2].depth, 1);
    assert.equal(rows[2].durationSeconds, 30);
});

test("createTableSection hides the duration for a still-running leaf, shows it for a finished parent", () => {
    const settings = { timestampFormat: "YY-MM-DD hh:mm:ss" } as TimeTrackerSettings;

    const runningLeaf: Entry = { name: "task", startTime: 1000, endTime: null, subEntries: null };
    assert.equal(createTableSection(runningLeaf, settings)[0][3], "");

    const finishedParent: Entry = {
        name: "task", startTime: null, endTime: null, subEntries: [
            { name: "Part 1", startTime: 0, endTime: 10, subEntries: null },
        ]
    };
    assert.equal(createTableSection(finishedParent, settings)[0][3], "10s");
});
