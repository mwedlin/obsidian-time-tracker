import { test } from "node:test";
import assert from "node:assert/strict";
import {
    loadTracker, isRunning, getRunningEntry, getDuration, getTotalDuration,
    startNewEntry, startSubEntry, endRunningEntry, removeEntry, formatDuration,
} from "../src/model";
import { Entry, Tracker } from "../src/types";

test("loadTracker parses valid JSON", () => {
    const tracker = loadTracker('{"dispType":"default","currTask":"","project":"P","client":"C","entries":[]}');
    assert.equal(tracker.project, "P");
    assert.deepEqual(tracker.entries, []);
});

test("loadTracker falls back to an empty tracker on invalid/empty JSON", () => {
    assert.deepEqual(loadTracker("").entries, []);
    assert.deepEqual(loadTracker("not json").entries, []);
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

test("formatDuration renders hours/minutes/seconds", () => {
    assert.equal(formatDuration(1000), "1s");
    assert.equal(formatDuration(61_000), "1m 1s");
    assert.equal(formatDuration(3_661_000), "1h 1m 1s");
});
