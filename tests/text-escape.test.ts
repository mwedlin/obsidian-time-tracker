import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeMarkdownCell, escapeCsvField } from "../src/text-escape";

test("escapeMarkdownCell neutralizes pipes and HTML so table structure and rendering can't be hijacked", () => {
    assert.equal(escapeMarkdownCell("a | b"), "a \\| b");
    assert.equal(escapeMarkdownCell("<img src=x onerror=alert(1)>"), "&lt;img src=x onerror=alert(1)&gt;");
    assert.equal(escapeMarkdownCell("Q&A"), "Q&amp;A");
    assert.equal(escapeMarkdownCell("line1\nline2"), "line1 line2");
    assert.equal(escapeMarkdownCell("plain task"), "plain task");
});

test("escapeCsvField quotes fields containing the delimiter/quote/newline", () => {
    assert.equal(escapeCsvField("plain", ","), "plain");
    assert.equal(escapeCsvField("a,b", ","), '"a,b"');
    assert.equal(escapeCsvField('say "hi"', ","), '"say ""hi"""');
    assert.equal(escapeCsvField("a;b", ";"), '"a;b"');
    assert.equal(escapeCsvField("line1\nline2", ","), '"line1\nline2"');
});

test("escapeCsvField neutralizes leading formula-trigger characters (CSV/formula injection)", () => {
    assert.equal(escapeCsvField("=SUM(A1:A9)", ","), "'=SUM(A1:A9)");
    assert.equal(escapeCsvField("+1", ","), "'+1");
    assert.equal(escapeCsvField("-1", ","), "'-1");
    assert.equal(escapeCsvField("@cmd", ","), "'@cmd");
    assert.equal(escapeCsvField("normal task", ","), "normal task");
});
