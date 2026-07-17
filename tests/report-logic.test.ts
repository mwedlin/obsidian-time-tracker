// Force a DST-observing zone so the findDays test below actually exercises a
// fall-back transition, regardless of the machine running the tests.
process.env.TZ = "America/New_York";

import { test } from "node:test";
import assert from "node:assert/strict";
import moment from "moment";
import { toName, isWithin, findProjects, findDays, daySum, daySumSeconds } from "../src/report-logic";
import { Entry } from "../src/types";

test("toName combines project and client, falling back sensibly", () => {
    assert.equal(toName("Proj", "Client"), "Proj/Client");
    assert.equal(toName("Proj", undefined), "Proj");
    assert.equal(toName(undefined, "Client"), "Client");
    assert.equal(toName(undefined, undefined), "(no project)");
});

test("isWithin detects overlap of a tracked interval with a duration", () => {
    assert.equal(isWithin(100, 200, 150, 300), true); // overlaps
    assert.equal(isWithin(100, 200, 201, 300), false); // entirely before
    assert.equal(isWithin(301, 400, 150, 300), false); // entirely after
});

test("findProjects returns a sorted, de-duplicated list of names", () => {
    const entries = [
        { name: "B" }, { name: "A" }, { name: "B" },
    ] as Entry[];
    assert.deepEqual(findProjects(entries), ["A", "B"]);
});

test("findDays does not duplicate a calendar day across a fall-back DST transition", () => {
    // 2024-11-03 is when US Eastern clocks fall back (a 25-hour day).
    const start = moment("2024-11-01", "YYYY-MM-DD").startOf("day").unix();
    const end = moment("2024-11-05", "YYYY-MM-DD").endOf("day").unix();

    const days = findDays(start, end);
    const labels = days.map(d => d.format("YYYY-MM-DD"));

    assert.deepEqual(labels, ["2024-11-01", "2024-11-02", "2024-11-03", "2024-11-04", "2024-11-05"]);
});

test("daySum sums only entries overlapping the given day, clipped to day boundaries", () => {
    const day = moment("2024-06-15", "YYYY-MM-DD");
    const dayStart = day.clone().startOf("day").unix();
    const dayEnd = day.clone().endOf("day").unix();

    const entries: Entry[] = [
        // fully inside the day: 1 hour
        { name: "P", startTime: dayStart + 3600, endTime: dayStart + 7200, subEntries: null },
        // spills over the end of the day by 1 hour -> should be clipped to the day boundary
        { name: "P", startTime: dayEnd - 1800, endTime: dayEnd + 1800, subEntries: null },
        // a different project, should be excluded when filtering by "P"
        { name: "Q", startTime: dayStart, endTime: dayStart + 3600, subEntries: null },
    ];

    // 1h + 0.5h clipped = 1.5h
    assert.equal(daySum("P", day, entries), "1.50");
    // undefined day -> sum across everything regardless of boundaries
    assert.equal(daySum("P", undefined, entries), (2 * 3600 / 3600).toFixed(2));
});

test("daySumSeconds returns the raw, unrounded seconds behind daySum's hours string", () => {
    const day = moment("2024-06-15", "YYYY-MM-DD");
    const dayStart = day.clone().startOf("day").unix();

    const entries: Entry[] = [
        { name: "P", startTime: dayStart, endTime: dayStart + 1800, subEntries: null }, // 30 min
    ];

    assert.equal(daySumSeconds("P", day, entries), 1800);
    assert.equal(daySum("P", day, entries), (1800 / 3600).toFixed(2));
});
