import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeRelativePath } from "../src/zip-path-safety";

test("sanitizeRelativePath accepts normal flat and nested paths", () => {
    assert.equal(sanitizeRelativePath("report.md"), "report.md");
    assert.equal(sanitizeRelativePath("Reports/invoice.md"), "Reports/invoice.md");
    assert.equal(sanitizeRelativePath("Reports/Sub/invoice.md"), "Reports/Sub/invoice.md");
});

test("sanitizeRelativePath rejects a \"..\" segment anywhere in the path (zip slip)", () => {
    assert.equal(sanitizeRelativePath("../secret.md"), null);
    assert.equal(sanitizeRelativePath("../../secret.md"), null);
    assert.equal(sanitizeRelativePath("Reports/../../secret.md"), null);
    assert.equal(sanitizeRelativePath("Reports/../Sub/invoice.md"), null);
});

test("sanitizeRelativePath rejects absolute paths and Windows drive letters", () => {
    assert.equal(sanitizeRelativePath("/etc/passwd"), null);
    assert.equal(sanitizeRelativePath("\\Windows\\system.ini"), null);
    assert.equal(sanitizeRelativePath("C:\\Windows\\system.ini"), null);
    assert.equal(sanitizeRelativePath("C:/Windows/system.ini"), null);
});

test("sanitizeRelativePath strips empty and \".\" segments", () => {
    assert.equal(sanitizeRelativePath("Reports//./invoice.md"), "Reports/invoice.md");
    assert.equal(sanitizeRelativePath("./report.md"), "report.md");
});

test("sanitizeRelativePath rejects empty input", () => {
    assert.equal(sanitizeRelativePath(""), null);
    assert.equal(sanitizeRelativePath("."), null);
    assert.equal(sanitizeRelativePath("//"), null);
});
