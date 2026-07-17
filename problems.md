# Build/runtime problems found

**Status: all items below are fixed.** `npm run build` (`tsc -noEmit` + esbuild) is clean, and
`npm test` (14 unit tests over the now Obsidian-free `model.ts`/`report-logic.ts`) passes. See
`design.md` for the current architecture and the "Suggested improvements" section for what else
changed alongside these fixes (dead-code removal, shared ticker, confirm-before-remove, etc.).

Verified by running `npm install`, `npm run build` (`tsc -noEmit -skipLibCheck && node esbuild.config.mjs production`),
and `node esbuild.config.mjs production` on its own.

**Key finding:** `npm run dev` (esbuild only) *succeeds* and produces `main.js`, but that's misleading —
esbuild only transpiles, it does not type-check. `npm run build` fails with ~90 TypeScript errors. Several
of the underlying bugs would also throw at runtime inside Obsidian even though esbuild silently compiles them.

## 1. References to things that don't exist

- `obsidianApp` is imported from `"obsidian"` in `src/dateparser.ts`, `src/files.ts`, `src/tracker.ts`.
  It is **not a real export** of the Obsidian API (checked `node_modules/obsidian/obsidian.d.ts` — no such member).
  - `src/dateparser.ts` is built entirely around this global and is not imported by any other file — it's dead/broken code.
- Missing type imports (used but never imported from `"obsidian"` / `"moment"`):
  - `TFile` in `src/files.ts` (used as `FileSection.file: TFile`)
  - `Editor` in `src/main.ts` (used as `editorCallback: async (editor: Editor) => ...`)
  - `Moment` in `src/tracker.ts` and `src/report.ts` (used as return/param types)
- `src/main.ts:5` imports `fileSection` (lowercase) from `./files` — the real export is `FileSection`, and it isn't even used in the file.
- `src/settings-tab.ts:2,7` imports the default export of `./main` under the local name `SimpleTimeTrackerPlugin`,
  but then types a field as `TimeTrackerPlugin` (the actual class name in `main.ts`) — that name was never imported.
- `src/main.ts:7` — stray `import { BlockList } from "net"`, a Node.js API, unused and inappropriate for an
  Obsidian plugin running in the Electron renderer.
- `src/report.ts:2` — stray `import { setUncaughtExceptionCaptureCallback } from "process"`, unused Node.js API import.

## 2. Undeclared globals (implicit globals — will throw `ReferenceError` at runtime; esbuild does not catch this)

- `src/tracker.ts` — inside `displayTrackerDefault`: `newTask`, `newProject`, `newClient` are assigned
  (e.g. `newTask = newTaskDiv.createEl(...)`) without `let`/`const`/`var`.
- `src/report.ts` — loop variable `i` used without declaration:
  - `findProjects` (`for (i=0; i<entries.length; i++)`)
  - `createMarkdownTable`, twice (`for (i=0; i<days.length; i++)` appears twice)
  - the `ReportModal` "Append table at cursor" click handler (`for (i=0; i<days.length; i++)`)

## 3. `this.app` used inside plain functions, not class methods

In `src/files.ts` (`readAll`, `stopAll`) and `src/tracker.ts` (`displayTrackerDefault`, `addEditableTableRow`),
`this.app.vault...` / `this.app` is referenced from exported top-level functions, not class methods —
`this` is `undefined` in that context, so these calls will throw at runtime. These functions need `app: App`
passed in explicitly as a parameter instead of relying on `this`.

## 4. API misuse / wrong wiring

- `src/main.ts`:
  - `editorCallback` handlers are typed `(e, _) => {...}` with implicit `any` parameters.
  - The "Report" command's `editorCallback` only declares `(editor: Editor)`, but Obsidian always calls
    `editorCallback` with `(editor, view)` — 2 args expected, 1 declared.
  - The "debug" command uses `callback: async (e, _) => {...}`, but `callback` (as opposed to `editorCallback`)
    is invoked with **zero** arguments.
  - `new ReportModal(this.app).open()` (line ~74) — `ReportModal`'s constructor requires
    `(app, settings, onSubmit)`; only `app` is passed.
- `src/files.ts:59` — `if (!content.slice(sections[i].endPos+1, sections[i].endPos+4) == "---")`
  is an operator-precedence bug: `!x == y` evaluates `!x` (a boolean) and compares *that* to the string `"---"`,
  which is never true/behaves nothing like the intended `!==` check. Should be
  `content.slice(...) !== "---"`.
- `src/tracker.ts` / `src/report.ts` — a few `createEl(...)` calls pass a `color` property that isn't part of
  Obsidian's `DomElementInfo` type (e.g. `createEl("span", { text: "...", color: "green" })`), and in `displayStatus`
  a variable typed for a table cell (`td1`) gets reassigned to an `HTMLSpanElement`, so it no longer refers to
  anything actually attached to the DOM (the reassignment is a dead store — nothing is appended/rendered).
- `src/report.ts` — `allTracks`'s local `ret` is declared `let ret: Entry = []` (single `Entry`, should be `Entry[]`),
  and `toName` is annotated to return `String` (wrapper type) instead of `string`.

## 5. Wrapper types instead of primitives

`Number` / `String` / `Boolean` are used instead of `number` / `string` / `boolean` throughout `src/files.ts`,
`src/tracker.ts`, `src/report.ts` (e.g. `FileSection.startPos: Number`, `let sum: Number = 0`, `daySum(project: String, ...)`).
This isn't just style — TypeScript correctly rejects things like `Number += number` and comparisons that would
work fine with primitives, which is where several of the `tsc` errors come from.

## 6. Async functions with wrong return-type annotations

Under `isolatedModules` (enabled in `tsconfig.json`), an `async` function's declared return type must be
wrapped in `Promise<T>`. Many functions declare `async foo(): T` instead of `async foo(): Promise<T>`,
across `src/files.ts` (`readAll`, `stopAll`), `src/tracker.ts` (`displayStatus`, `displayToday`), and
`src/report.ts` (`createMarkdownTable`, `createListTable`, `allTracks`).

## Suggested fix order

1. Remove/neutralize `dateparser.ts` and all `obsidianApp` references (it's unused dead code built on a
   nonexistent API).
2. Fix imports across all files (`TFile`, `Editor`, `Moment`, `FileSection`, `TimeTrackerPlugin`, drop `net`/`process` imports).
3. Add missing `let`/`const` for `newTask`/`newProject`/`newClient` and all bare `i` loop variables.
4. Thread `app: App` through the functions in `files.ts`/`tracker.ts` that currently rely on `this.app`.
5. Fix the `main.ts` command wiring (`editorCallback` signatures, `ReportModal` constructor call).
6. Fix the `files.ts:59` operator-precedence bug.
7. Swap wrapper types (`Number`/`String`/`Boolean`) for primitives, and fix async return-type annotations.
8. Re-run `npm run build` to confirm `tsc -noEmit` is clean and esbuild output is unchanged in behavior.

---

# Pre-publish security review

Done after the fixes above landed, ahead of publishing the plugin publicly. Scope: `src/*`, the
generated `main.js` bundle's dependency surface, `test-vault/` contents (notes, PDF exports, plugin
`data.json`/`.obsidian` config), and full git history (not just the current tree).

## Fixed

1. **CSV/formula injection and Markdown/table injection via free-text names.** `entry.name` (task name)
   and `tracker.project`/`tracker.client` are all free text the user types into the Task/Project/Client
   boxes, and were interpolated unescaped into generated output:
   - **CSV export** ("Copy as CSV") — a field starting with `=`, `+`, `-`, or `@` is interpreted as a
     formula by Excel/Google Sheets when the CSV is opened later (a well-known "CSV/formula injection"
     attack class for anything that exports user text to CSV).
   - **Markdown table generation** ("Copy as table" and the `Report` command's table, which is inserted
     directly into a note via `editor.replaceSelection`) — a `|` in a name broke the table's column
     structure, and raw `<`/`>` became literal HTML embedded in the note, which Obsidian's reading view
     renders as HTML (Obsidian sanitizes genuinely dangerous constructs like `onerror`/`<script>`, so this
     wasn't remote-code-execution, but free text still shouldn't be able to inject unescaped markup).

   Fixed with a new `src/text-escape.ts` (`escapeCsvField`, `escapeMarkdownCell`), wired into
   `model.ts`'s `createCsv`/`createTrackerTable` and `report-logic.ts`'s `createMarkdownTable`. Covered
   by `tests/text-escape.test.ts` (CSV quoting/formula-neutralizing, Markdown pipe/HTML escaping).

2. **Stale fork branding in the settings UI.** The settings tab still read "Super Simple Time Tracker
   Settings" (the original forked plugin's name). Fixed to "Time Tracker Settings" in
   `src/settings-tab.ts`.

## Reviewed, no code issue found

- **No `innerHTML`/`outerHTML`/`eval`/`new Function`/`document.write`** anywhere in `src/`.
- **No network calls** (`fetch`, `XMLHttpRequest`, `requestUrl`) anywhere in `src/`.
- **No Node built-ins** (`fs`, `child_process`, `net`, `http`, `os`, etc.) imported anywhere in `src/`
  — consistent with `manifest.json`'s `isDesktopOnly: false`.
- **Personal data in `test-vault/`**: notes, PDF exports (`test-vault/Exports/*.pdf`), and plugin
  `data.json`/`.obsidian` config all use the anonymized placeholders already in place (`Project 1..5`,
  `Client 1..5`, generic task names) — the PDFs match the `.md` sources exactly, nothing unredacted
  leaked through export. No emails, real names, or addresses found beyond the repo's own git author
  identity.
- **Secrets/API keys/tokens**: none found across the full git history (`git log --all -p`, including
  already-removed content).

## Reviewed, accepted as-is (author decision)

- **`"CUAS"` in git history.** Was the hardcoded default project name in `main.ts` prior to this
  session's fixes (introduced in `0afddb2`, removed in the build/bugfix commit). Since this repo is now
  public, that string is permanently visible in history unless it's rewritten (`git filter-repo` +
  force-push) — author confirmed the string is harmless, so no history rewrite was done.
- **`npm audit` (11 vulnerabilities, 5 moderate/6 high).** All in transitive devDependencies
  (`esbuild-plugin-copy`'s `micromatch`/`picomatch`/`semver`, `electron`'s toolchain). `package.json` has
  no `"dependencies"` section — everything is a devDependency, and esbuild marks `obsidian`/`electron` as
  `external`, so none of this reaches `main.js` or plugin users. Accepted as-is; only relevant to anyone
  building from source.

## Branding: author's own contact info added

- `manifest.json`'s `authorUrl` and `package.json`'s `author` now point to `mwe@wewid.se` (previously
  empty/plain `"mwe"` with no contact info at all — these were never Ellpeck's, just unpopulated).
- `src/settings-tab.ts`'s "support the developer" link + remote image (previously loaded live from
  `ellpeck.de` on every settings-tab render, pointing to the original forked plugin's author) is replaced
  with a plain `mailto:mwe@wewid.se` contact link. The now-unused `.time-tracker-support` CSS rule was
  removed from `styles.css`.

## Deferred (author's own branding pass, not done in this session)

- **`README.md`'s Ellpeck acknowledgement text** — left untouched; author is handling the rest of the
  branding/copy pass separately.
