import { test } from "node:test";
import assert from "node:assert/strict";
import { favoriteCommandId, favoriteCommandName } from "../src/favorites";

test("favoriteCommandName combines project/client the same way toName does", () => {
    assert.equal(favoriteCommandName({ project: "Project 4", client: "Client 4" }), "Start Project 4/Client 4");
    assert.equal(favoriteCommandName({ project: "Project 4", client: "" }), "Start Project 4");
    assert.equal(favoriteCommandName({ project: "", client: "" }), "Start (no project)");
});

test("favoriteCommandId is a stable, URL/command-safe slug", () => {
    assert.equal(favoriteCommandId({ project: "Project 4", client: "Client 4" }), "start-project-4-client-4");
    // punctuation collapses to single hyphens, no leading/trailing hyphen
    assert.equal(favoriteCommandId({ project: "Acme, Inc.", client: "R&D!" }), "start-acme-inc-r-d");
});

test("favoriteCommandId is deterministic for the same input, regardless of list position", () => {
    const a = { project: "Project 1", client: "Client 1" };
    const b = { project: "Project 4", client: "Client 4" };
    assert.equal(favoriteCommandId(a), favoriteCommandId({ ...a }));
    assert.notEqual(favoriteCommandId(a), favoriteCommandId(b));
});
